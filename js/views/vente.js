// Écran de vente : produits du jour, panier, total, bouton Encaisser.
import { etat, esc, rafraichir, toast, prochainNumero, panierVide, CATEGORIES, CANAUX } from '../etat.js';
import { rechercher, trouverDoublons, emailValide } from '../clients.js';
import { rechargerClients } from '../chargement.js';
import * as sync from '../sync.js';
import { calculerPanier } from '../panier.js';
import { formatEuro, toCents } from '../money.js';
import * as db from '../db.js';
import { pastilleStock } from './stock.js';

function calcul() {
  return calculerPanier({
    produits: etat.produits,
    quantites: etat.panier.quantites,
    consignes: etat.panier.consignes,
    consigneCents: etat.config.consigne_cents,
    divers: etat.panier.divers,
    remise: etat.panier.remise,
  });
}

function ligneProduit(p) {
  const q = etat.panier.quantites[p.id] || 0;
  return `
    <div class="ligne ${q ? 'choisie' : ''}">
      <div class="ligne-info">
        <div class="ligne-nom">${esc(p.nom_fr)} ${p.lot ? `<span class="lot">${esc(p.lot)}</span>` : ''}</div>
        <div class="ligne-prix">${formatEuro(p.prix_cents)}${p.format ? ` · ${esc(p.format)}` : ''}</div>
      </div>
      ${pastilleStock(p, q)}
      <div class="quantite">
        <button class="btn-qte" data-action="moins" data-id="${p.id}" aria-label="Retirer">−</button>
        <span class="qte">${q}</span>
        <button class="btn-qte" data-action="plus" data-id="${p.id}" aria-label="Ajouter">+</button>
      </div>
    </div>`;
}

// --- Client : état propre à cet écran -------------------------------------------------
let recherche = '';
/** Création en cours : { nom, email, langue, consentement, doublons } ou null */
let creation = null;

function resultatsHtml() {
  const q = recherche.trim();
  if (q.length < 2) return '';
  const trouves = rechercher(etat.clients, q, etat.statsClients);
  return `
    ${trouves.map((c) => `
      <button class="resultat" data-action="client-choisir" data-id="${c.id}">
        <strong>${esc(c.nom || c.email)}</strong>
        <span>${esc(c.nom ? c.email : '')}${etat.statsClients[c.id] ? ` · ${etat.statsClients[c.id].nb} achat(s)` : ''}</span>
      </button>`).join('')}
    <button class="resultat creer" data-action="client-nouveau">＋ Nouveau client « ${esc(q)} »</button>`;
}

function blocClient() {
  const client = etat.clients.find((c) => c.id === etat.panier.client_id);
  if (client) {
    const manque = !client.email ? "pas d'e-mail sur la fiche"
      : !etat.config.ticket_vendeur ? 'renseigne le vendeur dans Réglages → Ticket'
        : !sync.configuree() ? 'synchronisation non configurée' : '';
    if (manque) etat.panier.ticket = false;
    return `
      <div class="ligne choisie">
        <div class="ligne-info">
          <div class="ligne-nom">${esc(client.nom || client.email)}</div>
          <div class="ligne-prix">${esc(client.nom ? client.email : '')}${etat.statsClients[client.id] ? ` · ${etat.statsClients[client.id].nb} achat(s)` : ''}</div>
        </div>
        <button class="btn-discret" data-action="client-retirer" aria-label="Retirer le client">✕</button>
      </div>
      <label class="case">
        <input id="ticket" type="checkbox" ${etat.panier.ticket ? 'checked' : ''} ${manque ? 'disabled' : ''}>
        Envoyer le ticket par e-mail${manque ? ` <span class="aide">(${manque})</span>` : ''}
      </label>`;
  }
  if (creation) {
    return `
      <form id="form-client" class="formulaire encadre">
        <label>Nom <input name="nom" type="text" value="${esc(creation.nom)}" autocomplete="off"></label>
        <label>E-mail <input name="email" type="text" inputmode="email" value="${esc(creation.email)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label>Langue
          <select name="langue">
            <option value="fr" ${creation.langue === 'fr' ? 'selected' : ''}>Français</option>
            <option value="nl" ${creation.langue === 'nl' ? 'selected' : ''}>Nederlands</option>
          </select>
        </label>
        <label class="case"><input name="consentement" type="checkbox" ${creation.consentement ? 'checked' : ''}> Accepte d'être recontacté</label>
        ${creation.doublons?.length ? `
          <p class="alerte">Est-ce la même personne ?</p>
          ${creation.doublons.map((c) => `
            <button type="button" class="resultat" data-action="client-choisir" data-id="${c.id}">
              <strong>${esc(c.nom)}</strong><span>${esc(c.email)} · choisir cette fiche</span>
            </button>`).join('')}` : ''}
        <div class="barre">
          <button type="button" class="btn-secondaire" data-action="client-annuler">Annuler</button>
          <button type="submit" class="btn-principal">${creation.doublons?.length ? 'Non, créer quand même' : 'Créer'}</button>
        </div>
      </form>`;
  }
  return `
    <input id="client-recherche" type="text" placeholder="Nom ou e-mail" value="${esc(recherche)}" autocomplete="off" autocapitalize="none" spellcheck="false">
    <div id="client-resultats">${resultatsHtml()}</div>`;
}

async function creerClient(formulaire) {
  const f = new FormData(formulaire);
  const saisie = {
    nom: f.get('nom').trim(),
    email: f.get('email').trim().toLowerCase(),
    langue: f.get('langue'),
    consentement: f.get('consentement') === 'on',
  };
  if (!saisie.nom && !saisie.email) { toast('Saisis un nom ou un e-mail', 'erreur'); return; }
  if (saisie.email && !emailValide(saisie.email)) { toast('E-mail invalide', 'erreur'); return; }
  const { parEmail, parNom } = trouverDoublons(etat.clients, saisie);
  if (parEmail) {
    // Même e-mail : c'est forcément la même personne, on ne crée rien.
    etat.panier.client_id = parEmail.id;
    creation = null; recherche = '';
    toast(`Client déjà connu : ${parEmail.nom || parEmail.email}`);
    return;
  }
  if (parNom.length && !creation.doublons?.length) {
    creation = { ...saisie, doublons: parNom }; // on demande confirmation avant de créer
    return;
  }
  const client = {
    id: crypto.randomUUID(),
    type: 'particulier',
    nom: saisie.nom,
    email: saisie.email,
    telephone: '',
    langue: saisie.langue,
    consentement_contact: saisie.consentement,
    consentement_le: saisie.consentement ? db.maintenant() : '',
    note: '',
    fusionne_dans: '',
    supprime: false,
  };
  await db.enregistrerClient(client);
  await rechargerClients();
  sync.apresEcriture();
  etat.panier.client_id = client.id;
  creation = null; recherche = '';
  toast('Client créé');
}

function piedHtml(c) {
  const vide = c.lignes.length === 0;
  return `
    ${c.remiseCents ? `<div class="pied-detail">Sous-total ${formatEuro(c.sousTotalCents)} · remise −${formatEuro(c.remiseCents)}</div>` : ''}
    <div class="pied-ligne">
      <div class="total">Total <strong>${formatEuro(c.totalCents)}</strong></div>
      <button class="btn-principal" data-action="encaisser" ${vide ? 'disabled' : ''}>Encaisser</button>
    </div>`;
}

export function rendre(el) {
  const actifs = etat.produits.filter((p) => p.actif && !p.archive);
  const c = calcul();
  const groupes = Object.entries(CATEGORIES)
    .map(([cle, titre]) => {
      const liste = actifs.filter((p) => p.categorie === cle);
      return liste.length ? `<h2>${titre}</h2>${liste.map(ligneProduit).join('')}` : '';
    })
    .join('');

  el.innerHTML = `
    <div class="contexte">
      <select id="canal" aria-label="Canal de vente">
        ${Object.entries(CANAUX).map(([cle, nom]) => `<option value="${cle}" ${etat.config.canal === cle ? 'selected' : ''}>${nom}</option>`).join('')}
      </select>
      <input id="lieu" type="text" placeholder="Lieu (ex. Marché d'Enghien)" value="${esc(etat.config.lieu)}" aria-label="Lieu">
    </div>

    ${groupes || `<p class="vide">Aucun produit actif. Active des produits dans l'onglet Stock.</p>`}

    <h2>Autres</h2>
    <div class="ligne ${etat.panier.consignes ? 'choisie' : ''}">
      <div class="ligne-info">
        <div class="ligne-nom">Retour consigne (pot vide)</div>
        <div class="ligne-prix">−${formatEuro(etat.config.consigne_cents)}</div>
      </div>
      <div class="quantite">
        <button class="btn-qte" data-action="consigne-moins" aria-label="Retirer">−</button>
        <span class="qte">${etat.panier.consignes}</span>
        <button class="btn-qte" data-action="consigne-plus" aria-label="Ajouter">+</button>
      </div>
    </div>
    ${etat.panier.divers.map((d, i) => `
      <div class="ligne choisie">
        <div class="ligne-info">
          <div class="ligne-nom">${esc(d.libelle)}</div>
          <div class="ligne-prix">${formatEuro(d.cents)}</div>
        </div>
        <button class="btn-discret" data-action="divers-suppr" data-index="${i}" aria-label="Supprimer">✕</button>
      </div>`).join('')}
    <div class="ligne-saisie">
      <input id="divers-libelle" type="text" placeholder="Montant libre : libellé">
      <input id="divers-montant" type="text" inputmode="decimal" placeholder="€" class="court">
      <button class="btn-secondaire" data-action="divers-ajout">Ajouter</button>
    </div>
    <h2>Client (facultatif)</h2>
    ${blocClient()}

    <h2>Remise</h2>
    <div class="ligne-saisie">
      <label for="remise">Remise</label>
      <input id="remise" type="text" inputmode="decimal" placeholder="10% ou 2,50" value="${esc(etat.panier.remise)}" class="court">
      ${c.lignes.length ? `<button class="btn-discret" data-action="vider">Vider le panier</button>` : ''}
    </div>

    <div class="pied" id="pied">${piedHtml(c)}</div>`;

  el.onclick = (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const { action, id, index } = bouton.dataset;
    const q = etat.panier.quantites;
    if (action === 'plus') q[id] = (q[id] || 0) + 1;
    else if (action === 'moins') q[id] = Math.max(0, (q[id] || 0) - 1);
    else if (action === 'consigne-plus') etat.panier.consignes += 1;
    else if (action === 'consigne-moins') etat.panier.consignes = Math.max(0, etat.panier.consignes - 1);
    else if (action === 'divers-suppr') etat.panier.divers.splice(Number(index), 1);
    else if (action === 'vider') { etat.panier = panierVide(); recherche = ''; creation = null; }
    else if (action === 'client-choisir') { etat.panier.client_id = id; creation = null; recherche = ''; }
    else if (action === 'client-retirer') { etat.panier.client_id = null; etat.panier.ticket = false; }
    else if (action === 'client-annuler') creation = null;
    else if (action === 'client-nouveau') {
      const q = recherche.trim();
      creation = { nom: q.includes('@') ? '' : q, email: q.includes('@') ? q : '', langue: 'fr', consentement: false };
    }
    else if (action === 'divers-ajout') {
      const cents = toCents(el.querySelector('#divers-montant').value);
      if (cents === null || cents === 0) { toast('Montant invalide', 'erreur'); return; }
      etat.panier.divers.push({ libelle: el.querySelector('#divers-libelle').value.trim() || 'Divers', cents });
    } else if (action === 'encaisser') {
      const resultat = calcul();
      if (!resultat.lignes.length) return;
      etat.paiement = { calcul: resultat, numero: prochainNumero(), etape: 'choix' };
    }
    rafraichir();
  };

  // La remise se saisit au clavier : on ne redessine que le pied pour garder le focus.
  el.oninput = (e) => {
    if (e.target.id === 'remise') {
      etat.panier.remise = e.target.value;
      el.querySelector('#pied').innerHTML = piedHtml(calcul());
    } else if (e.target.id === 'client-recherche') {
      recherche = e.target.value;
      el.querySelector('#client-resultats').innerHTML = resultatsHtml();
    }
  };

  el.onsubmit = async (e) => {
    if (e.target.id !== 'form-client') return;
    e.preventDefault();
    await creerClient(e.target);
    rafraichir();
  };

  el.onchange = async (e) => {
    if (e.target.id === 'ticket') { etat.panier.ticket = e.target.checked; return; }
    if (e.target.id === 'canal' || e.target.id === 'lieu') {
      const maj = { [e.target.id]: e.target.value.trim() };
      Object.assign(etat.config, maj);
      await db.ecrireConfig(maj);
    }
  };
}
