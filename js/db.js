// Stockage local IndexedDB : source de vérité de l'appareil.
// Magasins : produits, ventes, mouvements (journal de stock, ajout seul), config (clé/valeur),
// clients, outbox (file d'attente des écritures à envoyer au Google Sheet).

import { calculerStocks } from './stock.js';

const NOM_BASE = 'miel-enghien';
const VERSION = 3;

/** Valeurs par défaut de la configuration. Aucun IBAN ici : il se saisit dans Réglages. */
export const CONFIG_DEFAUT = {
  beneficiaire: '',
  iban: '',
  bic: '',
  consigne_cents: 50,
  prefixe: 'J',
  compteur_ticket: 0,
  device_id: '',
  canal: 'marche',
  lieu: '',
  lieux: '', // endroits prédéfinis, un par ligne
  catalogue_initialise: false,
  // Ticket de caisse
  ticket_vendeur: '',
  ticket_pied: '',
  // Synchronisation (propre à chaque appareil)
  sync_url: '',
  sync_secret: '',
  sync_cursor: '',
  sync_derniere: '',
  sync_initialisee: false,
};

/** Catalogue de départ, repris de l'ancienne page HTML (modifiable ensuite dans l'appli). */
const PRODUITS_INITIAUX = [
  { categorie: 'miel', nom_fr: 'Miel de printemps (Marcq)', lot: 'M02', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été", lot: 'M03', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été (tilleul)", lot: 'M04', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: 'Miel de printemps', lot: 'ME', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été", lot: 'ME', prix_cents: 1000 },
  { categorie: 'hydromel', nom_fr: 'Hydromel nature', lot: '', prix_cents: 1500 },
  { categorie: 'hydromel', nom_fr: 'Hydromel cerise', lot: '', prix_cents: 1500 },
];

/** Nom de l'onglet du Sheet -> magasin local. */
const MAGASIN = { Produits: 'produits', Ventes: 'ventes', MouvementsStock: 'mouvements', Clients: 'clients' };

let basePromise;
let idAppareil = '';

function ouvrir() {
  basePromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NOM_BASE, VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        db.createObjectStore('produits', { keyPath: 'id' });
        db.createObjectStore('ventes', { keyPath: 'id' }).createIndex('date_heure', 'date_heure');
        db.createObjectStore('mouvements', { keyPath: 'id' }).createIndex('produit_id', 'produit_id');
        db.createObjectStore('config', { keyPath: 'cle' });
      }
      if (e.oldVersion < 2) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'cle' });
        // Tout ce qui existait avant la synchro (lot 1) est mis en file d'attente.
        for (const [table, magasin] of [['Produits', 'produits'], ['Ventes', 'ventes'], ['MouvementsStock', 'mouvements']]) {
          req.transaction.objectStore(magasin).getAllKeys().onsuccess = (ev) => {
            for (const id of ev.target.result) outbox.put(entreeOutbox(table, id));
          };
        }
      }
      if (e.oldVersion < 3) db.createObjectStore('clients', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Une version plus récente de l'appli veut mettre la base à niveau : on lui laisse la place.
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("l'application est ouverte dans un autre onglet avec une ancienne version : ferme-le puis recharge"));
  });
  return basePromise;
}

const attendre = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finTransaction = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
  });

export const maintenant = () => new Date().toISOString();

/** `n` change à chaque écriture : un envoi en cours n'acquitte pas une modification plus récente. */
function entreeOutbox(table, id) {
  return { cle: `${table}:${id}`, table, id, n: `${Date.now()}-${Math.random()}` };
}

export async function tout(magasin) {
  const db = await ouvrir();
  return attendre(db.transaction(magasin).objectStore(magasin).getAll());
}

export async function lireConfig() {
  const lignes = await tout('config');
  const config = { ...CONFIG_DEFAUT };
  for (const l of lignes) config[l.cle] = l.valeur;
  return config;
}

export async function ecrireConfig(partiel) {
  const db = await ouvrir();
  const tx = db.transaction('config', 'readwrite');
  for (const [cle, valeur] of Object.entries(partiel)) tx.objectStore('config').put({ cle, valeur });
  await finTransaction(tx);
}

/** Premier lancement : identifiant d'appareil + catalogue de départ. */
export async function initialiser() {
  let config = await lireConfig();
  const ajout = {};
  if (!config.device_id) ajout.device_id = crypto.randomUUID();
  idAppareil = config.device_id || ajout.device_id;
  if (!config.catalogue_initialise) {
    await ecrireProduits(PRODUITS_INITIAUX.map((p, i) => ({
      id: crypto.randomUUID(),
      nom_nl: '',
      format: '',
      prix_magasin_cents: null,
      consigne: p.categorie === 'miel',
      date_recolte: '',
      actif: true,
      archive: false,
      ordre: i + 1,
      seuil_alerte: null,
      // Produit de départ jamais modifié : remplacé par le catalogue du Sheet s'il en existe un.
      initial: true,
      ...p,
    })), { initial: true });
    ajout.catalogue_initialise = true;
  }
  if (Object.keys(ajout).length) {
    await ecrireConfig(ajout);
    config = { ...config, ...ajout };
  }
  // Demande au navigateur de ne jamais purger ces données (sans effet si déjà accordé).
  navigator.storage?.persist?.().catch(() => {});
  return config;
}

export async function produits() {
  return (await tout('produits')).sort((a, b) => a.ordre - b.ordre);
}

async function ecrireProduits(liste, { initial = false } = {}) {
  const db = await ouvrir();
  const tx = db.transaction(['produits', 'outbox'], 'readwrite');
  for (const p of liste) {
    tx.objectStore('produits').put({ ...p, initial, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Produits', p.id));
  }
  await finTransaction(tx);
}

export const enregistrerProduit = (produit) => ecrireProduits([produit]);
export const enregistrerProduits = (liste) => ecrireProduits(liste);

/**
 * Valide une vente : la vente, ses mouvements de stock, le compteur de tickets et la file
 * d'attente de synchro sont écrits dans UNE transaction — tout est enregistré, ou rien.
 */
export async function enregistrerVente(vente, mouvements, compteurTicket) {
  const db = await ouvrir();
  const tx = db.transaction(['ventes', 'mouvements', 'config', 'outbox'], 'readwrite');
  tx.objectStore('ventes').put(vente);
  tx.objectStore('outbox').put(entreeOutbox('Ventes', vente.id));
  for (const m of mouvements) {
    tx.objectStore('mouvements').put(m);
    tx.objectStore('outbox').put(entreeOutbox('MouvementsStock', m.id));
  }
  tx.objectStore('config').put({ cle: 'compteur_ticket', valeur: compteurTicket });
  await finTransaction(tx);
}

/** Ventes dont la date est comprise entre deux instants ISO, de la plus récente à la plus ancienne. */
export async function ventesEntre(debutIso, finIso) {
  const db = await ouvrir();
  const index = db.transaction('ventes').objectStore('ventes').index('date_heure');
  const liste = await attendre(index.getAll(IDBKeyRange.bound(debutIso, finIso)));
  return liste.reverse();
}

/** Stock de chaque produit (et des pots vides), recalculé depuis le journal de mouvements. */
export async function stocks() {
  return calculerStocks(await tout('mouvements'));
}

/** Journal des mouvements d'un produit, du plus récent au plus ancien. */
export async function mouvementsDe(produitId) {
  const db = await ouvrir();
  const index = db.transaction('mouvements').objectStore('mouvements').index('produit_id');
  const liste = await attendre(index.getAll(produitId));
  return liste.sort((a, b) => String(b.date_heure).localeCompare(String(a.date_heure)));
}

/** Construit un mouvement de stock complet à partir de l'essentiel. */
export function nouveauMouvement({ produit_id, delta, motif, note = '', vente_id = '' }) {
  return { id: crypto.randomUUID(), date_heure: maintenant(), produit_id, delta, motif, vente_id, note, device_id: idAppareil };
}

/**
 * Enregistre des mouvements de stock et, s'il est fourni, le produit qui va avec (nouveau lot),
 * dans une seule transaction.
 */
export async function enregistrerMouvements(mouvements, produit = null) {
  const db = await ouvrir();
  const tx = db.transaction(['produits', 'mouvements', 'outbox'], 'readwrite');
  if (produit) {
    tx.objectStore('produits').put({ ...produit, initial: false, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Produits', produit.id));
  }
  for (const m of mouvements) {
    tx.objectStore('mouvements').put(m);
    tx.objectStore('outbox').put(entreeOutbox('MouvementsStock', m.id));
  }
  await finTransaction(tx);
}

/** Nombre de ventes enregistrées sur l'appareil. */
export async function nombreVentes() {
  const db = await ouvrir();
  return attendre(db.transaction('ventes').objectStore('ventes').count());
}

/**
 * Efface toutes les ventes de CET appareil et les mouvements de stock qu'elles ont générés
 * (y compris ceux qui attendaient d'être envoyés), et remet le compteur de tickets à zéro.
 * Les entrées de stock, inventaires, le catalogue, les réglages et le Google Sheet ne sont
 * pas touchés. Irréversible.
 */
export async function effacerVentes() {
  const db = await ouvrir();
  const tx = db.transaction(['ventes', 'mouvements', 'config', 'outbox'], 'readwrite');
  const outbox = tx.objectStore('outbox');
  const mouvements = tx.objectStore('mouvements');
  tx.objectStore('ventes').getAllKeys().onsuccess = (e) => {
    for (const id of e.target.result) outbox.delete(`Ventes:${id}`);
    tx.objectStore('ventes').clear();
  };
  mouvements.getAll().onsuccess = (e) => {
    for (const m of e.target.result) {
      if (!m.vente_id) continue; // entrée de stock, inventaire… : conservé
      mouvements.delete(m.id);
      outbox.delete(`MouvementsStock:${m.id}`);
    }
  };
  tx.objectStore('config').put({ cle: 'compteur_ticket', valeur: 0 });
  await finTransaction(tx);
}

/** Copie complète de la base, pour la sauvegarde manuelle (sans le secret de synchro). */
export async function exporterTout() {
  const [prods, ventes, mouvements, config, listeClients] = await Promise.all([
    tout('produits'), tout('ventes'), tout('mouvements'), tout('config'), tout('clients'),
  ]);
  return {
    format: 'miel-enghien-sauvegarde',
    version: VERSION,
    exporte_le: maintenant(),
    produits: prods,
    ventes,
    mouvements,
    clients: listeClients,
    config: config.filter((c) => c.cle !== 'sync_secret'),
  };
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

export async function compterOutbox() {
  const db = await ouvrir();
  return attendre(db.transaction('outbox').objectStore('outbox').count());
}

/** Les `limite` premières écritures en attente. */
export async function lireOutbox(limite) {
  const db = await ouvrir();
  return attendre(db.transaction('outbox').objectStore('outbox').getAll(null, limite));
}

/**
 * Transforme des entrées de la file d'attente en lignes à envoyer au Sheet.
 * Une vente donne une ligne « Ventes » et une ligne « LignesVente » par article.
 * @returns {Promise<Array<{table: string, row: object}>>}
 */
export async function materialiser(entrees) {
  const db = await ouvrir();
  const tx = db.transaction(['produits', 'ventes', 'mouvements', 'clients']);
  const ops = [];
  for (const e of entrees) {
    const row = await attendre(tx.objectStore(MAGASIN[e.table]).get(e.id));
    if (!row) continue; // effacé entre-temps : rien à envoyer
    if (e.table === 'Ventes') {
      const { lignes = [], ...entete } = row;
      ops.push({ table: 'Ventes', row: entete });
      for (const l of lignes) ops.push({ table: 'LignesVente', row: { ...l, vente_id: row.id, device_id: row.device_id } });
    } else if (e.table === 'Produits') {
      const { initial, ...produit } = row;
      ops.push({ table: 'Produits', row: produit });
    } else {
      ops.push({ table: e.table, row });
    }
  }
  return ops;
}

/** Retire de la file les entrées envoyées, sauf celles modifiées de nouveau pendant l'envoi. */
export async function acquitter(entrees) {
  const db = await ouvrir();
  const tx = db.transaction('outbox', 'readwrite');
  const outbox = tx.objectStore('outbox');
  for (const e of entrees) {
    const actuelle = await attendre(outbox.get(e.cle));
    if (actuelle && actuelle.n === e.n) outbox.delete(e.cle);
  }
  await finTransaction(tx);
}

/** Supprime les produits de départ jamais modifiés (le Sheet fournit déjà un catalogue). */
export async function supprimerProduitsInitiaux() {
  const db = await ouvrir();
  const tx = db.transaction(['produits', 'outbox'], 'readwrite');
  const magasin = tx.objectStore('produits');
  for (const p of await attendre(magasin.getAll())) {
    if (p.initial) {
      magasin.delete(p.id);
      tx.objectStore('outbox').delete(`Produits:${p.id}`);
    }
  }
  await finTransaction(tx);
}

/** Une cellule vide du Sheet vaut '' : on la ramène à null pour les champs numériques. */
const nombreOuNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * Fusionne les lignes reçues du Sheet dans la base locale, sans les remettre en file d'attente.
 * Produits et ventes : la version au `updated_at` le plus récent gagne.
 * Mouvements de stock : ajout seul.
 * @returns {Promise<{produits: number, ventes: number, mouvements: number}>} lignes appliquées
 */
export async function fusionner(changements) {
  const db = await ouvrir();
  const tx = db.transaction(['produits', 'ventes', 'mouvements', 'clients'], 'readwrite');
  const bilan = { produits: 0, ventes: 0, mouvements: 0, clients: 0 };
  const plusRecent = (distant, local) => !local || String(distant.updated_at) > String(local.updated_at);

  for (const { synced_at, ...p } of changements.Produits || []) {
    const magasin = tx.objectStore('produits');
    if (!plusRecent(p, await attendre(magasin.get(p.id)))) continue;
    magasin.put({
      ...p,
      prix_cents: Number(p.prix_cents) || 0,
      prix_magasin_cents: nombreOuNull(p.prix_magasin_cents),
      seuil_alerte: nombreOuNull(p.seuil_alerte),
      ordre: Number(p.ordre) || 0,
      consigne: p.consigne === true,
      actif: p.actif === true,
      archive: p.archive === true,
      initial: false,
    });
    bilan.produits += 1;
  }

  const lignesParVente = {};
  for (const { synced_at, device_id, ...l } of changements.LignesVente || []) {
    (lignesParVente[l.vente_id] ??= []).push(l);
  }
  for (const { synced_at, ...v } of changements.Ventes || []) {
    const magasin = tx.objectStore('ventes');
    const locale = await attendre(magasin.get(v.id));
    if (!plusRecent(v, locale)) continue;
    magasin.put({ ...v, client_id: v.client_id || null, lignes: lignesParVente[v.id] || locale?.lignes || [] });
    bilan.ventes += 1;
  }

  for (const { synced_at, ...m } of changements.MouvementsStock || []) {
    const magasin = tx.objectStore('mouvements');
    if (await attendre(magasin.get(m.id))) continue;
    magasin.put(m);
    bilan.mouvements += 1;
  }

  for (const { synced_at, ...c } of changements.Clients || []) {
    const magasin = tx.objectStore('clients');
    if (!plusRecent(c, await attendre(magasin.get(c.id)))) continue;
    magasin.put({ ...c, consentement_contact: c.consentement_contact === true, supprime: c.supprime === true });
    bilan.clients += 1;
  }

  await finTransaction(tx);
  return bilan;
}

/** Plus grand numéro de séquence parmi les tickets commençant par ce préfixe (ex. "J26-"). */
export async function plusGrandNumero(debut) {
  let max = 0;
  for (const v of await tout('ventes')) {
    if (String(v.numero).startsWith(debut)) max = Math.max(max, parseInt(String(v.numero).slice(debut.length), 10) || 0);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function clients() {
  return tout('clients');
}

export async function toutesLesVentes() {
  return tout('ventes');
}

export async function enregistrerClients(liste) {
  const db = await ouvrir();
  const tx = db.transaction(['clients', 'outbox'], 'readwrite');
  for (const c of liste) {
    tx.objectStore('clients').put({ ...c, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Clients', c.id));
  }
  await finTransaction(tx);
}

export const enregistrerClient = (client) => enregistrerClients([client]);

/**
 * Fusion de deux fiches : les ventes de `ancienId` sont rattachées à `nouveauId` et la fiche
 * `ancienId` est marquée comme fusionnée, dans une seule transaction.
 */
export async function fusionnerClients(ancienId, nouveauId) {
  const db = await ouvrir();
  const tx = db.transaction(['clients', 'ventes', 'outbox'], 'readwrite');
  const ventes = tx.objectStore('ventes');
  for (const v of await attendre(ventes.getAll())) {
    if (v.client_id !== ancienId) continue;
    ventes.put({ ...v, client_id: nouveauId, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Ventes', v.id));
  }
  const ancien = await attendre(tx.objectStore('clients').get(ancienId));
  if (ancien) {
    tx.objectStore('clients').put({ ...ancien, fusionne_dans: nouveauId, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Clients', ancienId));
  }
  await finTransaction(tx);
}

/** Note la date d'envoi des tickets confirmée par le serveur (sans remise en file d'attente). */
export async function marquerTickets(tickets) {
  const db = await ouvrir();
  const tx = db.transaction('ventes', 'readwrite');
  const ventes = tx.objectStore('ventes');
  for (const t of tickets) {
    const v = await attendre(ventes.get(t.vente_id));
    if (v) ventes.put({ ...v, ticket_envoye_le: t.envoye_le, ticket_a_renvoyer: false });
  }
  await finTransaction(tx);
}

// ---------------------------------------------------------------------------
// Modification de ventes existantes (annulation, mode de paiement, client, Smart)
// ---------------------------------------------------------------------------

/**
 * Enregistre des ventes modifiées et, le cas échéant, les mouvements de stock qui vont avec
 * (annulation), dans une seule transaction. Les lignes d'une vente ne changent jamais.
 */
export async function modifierVentes(ventes, mouvements = []) {
  const db = await ouvrir();
  const tx = db.transaction(['ventes', 'mouvements', 'outbox'], 'readwrite');
  for (const v of ventes) {
    tx.objectStore('ventes').put({ ...v, updated_at: maintenant(), device_id: idAppareil });
    tx.objectStore('outbox').put(entreeOutbox('Ventes', v.id));
  }
  for (const m of mouvements) {
    tx.objectStore('mouvements').put(m);
    tx.objectStore('outbox').put(entreeOutbox('MouvementsStock', m.id));
  }
  await finTransaction(tx);
}
