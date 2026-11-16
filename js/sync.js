// Synchronisation avec le Google Sheet : envoi de la file d'attente (push) puis récupération
// des écritures des autres appareils (pull). Ne bloque jamais l'interface.
import { etat, rafraichir } from './etat.js';
import * as db from './db.js';

const TAILLE_LOT = 100;
const DELAI_REQUETE_MS = 45000;
const REESSAI_MIN_MS = 30000;
const REESSAI_MAX_MS = 600000;

/** État affiché par la pastille de l'en-tête et par Réglages. */
export const statut = { enCours: false, enAttente: 0, erreur: '' };

const ecouteurs = new Set();
/** S'abonne aux changements de statut. */
export function surChangement(f) { ecouteurs.add(f); }
function notifier() { ecouteurs.forEach((f) => f(statut)); }

export function configuree() {
  return Boolean(etat.config.sync_url && etat.config.sync_secret);
}

/** Recompte les écritures en attente (à appeler après chaque écriture locale). */
export async function actualiserCompteur() {
  statut.enAttente = await db.compterOutbox();
  notifier();
}

async function appeler(corps) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), DELAI_REQUETE_MS);
  try {
    // text/plain : requête « simple », sans pré-requête CORS que Apps Script ne gère pas.
    const reponse = await fetch(etat.config.sync_url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: etat.config.sync_secret, device_id: etat.config.device_id, ...corps }),
      redirect: 'follow',
      signal: controleur.signal,
    });
    if (!reponse.ok) throw new Error(`Réponse HTTP ${reponse.status}`);
    let json;
    try { json = await reponse.json(); } catch { throw new Error("Réponse illisible : vérifie l'URL du script"); }
    if (!json.ok) throw new Error(json.error || 'Refus du serveur');
    return json;
  } catch (erreur) {
    if (erreur.name === 'AbortError') throw new Error('Délai dépassé');
    if (erreur instanceof TypeError) throw new Error('Pas de connexion au serveur');
    throw erreur;
  } finally {
    clearTimeout(minuterie);
  }
}

async function memoriser(partiel) {
  Object.assign(etat.config, partiel);
  await db.ecrireConfig(partiel);
}

/** Applique les lignes reçues et met à jour l'écran si le catalogue ou les ventes ont changé. */
async function appliquer(reponse) {
  const bilan = await db.fusionner(reponse.changes || {});
  await memoriser({ sync_cursor: reponse.cursor, sync_derniere: db.maintenant() });
  if (bilan.ventes) {
    // Après une restauration, la numérotation repart après le dernier ticket connu.
    const annee = String(new Date().getFullYear()).slice(-2);
    const max = await db.plusGrandNumero(`${etat.config.prefixe}${annee}-`);
    if (max > (etat.config.compteur_ticket || 0)) await memoriser({ compteur_ticket: max });
  }
  if (bilan.produits) etat.produits = await db.produits();
  // On ne redessine pas pendant un paiement ou une saisie de produit.
  if ((bilan.produits || bilan.ventes) && !etat.paiement && !etat.edition && etat.onglet !== 'reglages') rafraichir();
  return bilan;
}

let enCours = null;
let minuterieReessai = null;
let delaiReessai = REESSAI_MIN_MS;

async function executer(complet) {
  if (complet) await memoriser({ sync_cursor: '' });

  // Première synchro de cet appareil : on regarde d'abord ce que contient le Sheet. S'il a
  // déjà un catalogue, les produits de départ jamais modifiés sont retirés pour éviter les doublons.
  if (!etat.config.sync_initialisee) {
    const reponse = await appeler({ full: true, ops: [] });
    if ((reponse.changes?.Produits || []).length) await db.supprimerProduitsInitiaux();
    await appliquer(reponse);
    etat.produits = await db.produits();
    await memoriser({ sync_initialisee: true });
  }

  let premier = true;
  for (;;) {
    const entrees = await db.lireOutbox(TAILLE_LOT);
    if (!entrees.length && !premier && !complet) break;
    const ops = await db.materialiser(entrees);
    const reponse = await appeler({ cursor: etat.config.sync_cursor, full: complet && premier, ops });
    await db.acquitter(entrees);
    await appliquer(reponse);
    await actualiserCompteur();
    premier = false;
    complet = false;
    if (entrees.length < TAILLE_LOT) break;
  }
}

/**
 * Lance une synchronisation (une seule à la fois). Ne lève jamais d'erreur : le résultat est
 * dans `statut`. @param {{complet?: boolean}} [options] complet = tout rapatrier depuis le Sheet
 * @returns {Promise<boolean>} true si la synchro a réussi
 */
export function synchroniser({ complet = false } = {}) {
  if (!configuree()) return Promise.resolve(false);
  if (enCours) return enCours;
  clearTimeout(minuterieReessai);
  statut.enCours = true;
  notifier();
  enCours = executer(complet)
    .then(() => {
      statut.erreur = '';
      delaiReessai = REESSAI_MIN_MS;
      return true;
    })
    .catch((erreur) => {
      console.warn('Synchronisation', erreur);
      statut.erreur = erreur.message || String(erreur);
      // Nouvel essai automatique, de plus en plus espacé ; rien n'est perdu entre-temps.
      minuterieReessai = setTimeout(() => synchroniser(), delaiReessai);
      delaiReessai = Math.min(delaiReessai * 2, REESSAI_MAX_MS);
      return false;
    })
    .finally(async () => {
      enCours = null;
      statut.enCours = false;
      await actualiserCompteur().catch(() => {});
    });
  return enCours;
}

/** À appeler après chaque écriture locale : met la pastille à jour et tente l'envoi. */
export function apresEcriture() {
  actualiserCompteur().catch(() => {});
  synchroniser();
}

/** Résumé lisible du statut, pour la pastille et l'écran Réglages. */
export function decrire() {
  if (!configuree()) return { icone: '', texte: 'Synchronisation non configurée.' };
  const attente = statut.enAttente ? `${statut.enAttente} écriture(s) en attente d'envoi` : 'Tout est envoyé';
  const derniere = etat.config.sync_derniere
    ? `dernière synchro réussie le ${new Date(etat.config.sync_derniere).toLocaleString('fr-BE', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'aucune synchro réussie pour le moment';
  if (statut.enCours) return { icone: '↻', texte: `Synchronisation en cours… ${attente}.` };
  if (statut.erreur) return { icone: `⚠ ${statut.enAttente || ''}`.trim(), texte: `Erreur : ${statut.erreur}. ${attente} ; ${derniere}. Nouvel essai automatique.` };
  if (statut.enAttente) return { icone: `⏳ ${statut.enAttente}`, texte: `${attente} ; ${derniere}.` };
  return { icone: '✓', texte: `${attente} ; ${derniere}.` };
}

/** À appeler une fois au démarrage : synchronise à l'ouverture, au retour du réseau et au premier plan. */
export function demarrer() {
  window.addEventListener('online', () => synchroniser());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') synchroniser();
  });
  actualiserCompteur();
  synchroniser();
}
