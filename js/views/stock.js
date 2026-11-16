// Onglet Stock : stock par produit, produits du jour, nouveau lot, mouvements, inventaire,
// pots vides, et gestion du catalogue.
import { etat, esc, rafraichir, toast, CATEGORIES, MOTIFS } from '../etat.js';
import { formatEuro, toCents, centsToInput } from '../money.js';
import { POTS_VIDES, niveauStock, ecartInventaire } from '../stock.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

/** Mouvements manuels proposés : motif -> sens (+1 entrée, −1 sortie). */
const TYPES_PRODUIT = { recolte: 1, don: -1, casse: -1, perso: -1 };
const TYPES_POTS = { achat_pots: 1, mise_en_pot: -1, casse: -1 };

const quantiteDe = (id) => etat.stocks[id]?.quantite ?? 0;

/** Pastille de stock d'un produit. */
export function pastilleStock(produit, dansPanier = 0) {
  const stock = etat.stocks[produit.id];
  const niveau = niveauStock(stock, produit.seuil_alerte, dansPanier);
  if (niveau === 'inconnu') return `<span class="stock inconnu" title="Stock jamais saisi">—</span>`;
  const titres = { rupture: 'Stock épuisé ou insuffisant', bas: 'Stock bas', ok: 'En stock' };
  return `<span class="stock ${niveau}" title="${titres[niveau]}">${stock.quantite}</span>`;
}

function entier(saisie) {
  const s = String(saisie ?? '').trim();
  return /^-?\d+$/.test(s) ? parseInt(s, 10) : null;
}

/** Recharge produits et stocks après une écriture, lance la synchro, redessine. */
async function apresEcriture(message) {
  etat.produits = await db.produits();
  etat.stocks = await db.stocks();
  sync.apresEcriture();
  if (message) toast(message);
  rafraichir();
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

function liste(el) {
  const visibles = etat.produits.filter((p) => !p.archive);
  const archives = etat.produits.filter((p) => p.archive);
  const ligne = (p) => `
    <div class="ligne">
      <label class="interrupteur" title="En vente aujourd'hui">
        <input type="checkbox" data-action="actif" data-id="${p.id}" ${p.actif ? 'checked' : ''}>
        <span></span>
      </label>
      <button class="ligne-info lien" data-action="detail" data-id="${p.id}">
        <div class="ligne-nom">${esc(p.nom_fr)} ${p.lot ? `<span class="lot">${esc(p.lot)}</span>` : ''}</div>
        <div class="ligne-prix">${formatEuro(p.prix_cents)}${p.format ? ` · ${esc(p.format)}` : ''}</div>
      </button>
      ${pastilleStock(p)}
    </div>`;

  el.innerHTML = `
    <div class="barre">
      <button class="btn-principal" data-action="lot">+ Nouveau lot</button>
    </div>
    <div class="barre">
      <button class="btn-secondaire" data-action="tous" data-valeur="1">Tout activer</button>
      <button class="btn-secondaire" data-action="tous" data-valeur="0">Tout désactiver</button>
    </div>
    <p class="aide">L'interrupteur indique si le produit est en vente aujourd'hui. Touche un produit pour voir son stock, saisir une entrée ou un inventaire.</p>

    ${Object.entries(CATEGORIES).map(([cle, titre]) => {
      const groupe = visibles.filter((p) => p.categorie === cle);
      return groupe.length ? `<h2>${titre}</h2>${groupe.map(ligne).join('')}` : '';
    }).join('') || '<p class="vide">Aucun produit.</p>'}

    <h2>Consignes</h2>
    <div class="ligne">
      <button class="ligne-info lien" data-action="detail" data-id="${POTS_VIDES}">
        <div class="ligne-nom">Pots vides</div>
        <div class="ligne-prix">Consignes rendues et pots achetés</div>
      </button>
      <span class="stock ${quantiteDe(POTS_VIDES) < 0 ? 'rupture' : 'ok'}">${quantiteDe(POTS_VIDES)}</span>
    </div>

    ${archives.length ? `
      <details class="recap">
        <summary>${archives.length} produit(s) archivé(s)</summary>
        ${archives.map((p) => `
          <div class="ligne">
            <div class="ligne-info"><div class="ligne-nom">${esc(p.nom_fr)} ${p.lot ? `<span class="lot">${esc(p.lot)}</span>` : ''}</div></div>
            <button class="btn-secondaire" data-action="desarchiver" data-id="${p.id}">Restaurer</button>
          </div>`).join('')}
      </details>` : ''}`;

  el.onchange = async (e) => {
    if (e.target.dataset.action !== 'actif') return;
    const p = etat.produits.find((x) => x.id === e.target.dataset.id);
    p.actif = e.target.checked;
    await db.enregistrerProduit(p);
    sync.apresEcriture();
  };

  el.onclick = async (e) => {
    const bouton = e.target.closest('button[data-action]');
    if (!bouton) return;
    const { action, id } = bouton.dataset;
    if (action === 'lot') etat.edition = { mode: 'lot', produit: produitVierge() };
    else if (action === 'detail') etat.edition = { mode: 'detail', id };
    else if (action === 'tous') {
      const actif = bouton.dataset.valeur === '1';
      const cibles = etat.produits.filter((p) => !p.archive);
      cibles.forEach((p) => { p.actif = actif; });
      await db.enregistrerProduits(cibles);
      sync.apresEcriture();
    } else if (action === 'desarchiver') {
      const p = etat.produits.find((x) => x.id === id);
      await db.enregistrerProduit({ ...p, archive: false });
      await apresEcriture('Produit restauré');
      return;
    }
    window.scrollTo(0, 0);
    rafraichir();
  };
  el.oninput = null;
}

// ---------------------------------------------------------------------------
// Détail d'un produit (ou des pots vides) : mouvements et inventaire
// ---------------------------------------------------------------------------

async function detail(el) {
  const id = etat.edition.id;
  const pots = id === POTS_VIDES;
  const produit = pots ? { id, nom_fr: 'Pots vides', lot: '' } : etat.produits.find((p) => p.id === id);
  if (!produit) { etat.edition = null; liste(el); return; }
  const types = pots ? TYPES_POTS : TYPES_PRODUIT;
  const stock = etat.stocks[id];
  const quantite = quantiteDe(id);
  const journal = await db.mouvementsDe(id);
  const jamaisSaisi = !pots && !stock?.initialise;

  el.innerHTML = `
    <button class="btn-discret" data-action="retour">← Stock</button>
    <h2>${esc(produit.nom_fr)} ${produit.lot ? `<span class="lot">${esc(produit.lot)}</span>` : ''}</h2>
    <p class="montant-geant">${quantite}</p>
    <p class="centre aide">${jamaisSaisi
      ? 'Stock jamais saisi : fais un inventaire ci-dessous pour démarrer le décompte.'
      : `en stock${produit.seuil_alerte !== null && produit.seuil_alerte !== undefined && !pots ? ` · alerte à ${produit.seuil_alerte}` : ''}`}</p>

    <h2>Inventaire</h2>
    <form id="form-inventaire" class="ligne-saisie">
      <label for="compte">Compté</label>
      <input id="compte" name="compte" type="text" inputmode="numeric" placeholder="nombre réel" class="court" required>
      <button type="submit" class="btn-secondaire">Corriger le stock</button>
    </form>

    <h2>Entrée ou sortie</h2>
    <form id="form-mouvement" class="formulaire">
      <div class="ligne-saisie">
        <select name="motif" aria-label="Type de mouvement">
          ${Object.entries(types).map(([motif, sens]) => `<option value="${motif}">${sens > 0 ? '＋' : '－'} ${MOTIFS[motif]}</option>`).join('')}
        </select>
        <input name="quantite" type="text" inputmode="numeric" placeholder="Qté" class="court" required aria-label="Quantité">
      </div>
      <div class="ligne-saisie">
        <input name="note" type="text" placeholder="Note (facultatif)" aria-label="Note">
        <button type="submit" class="btn-principal">Enregistrer</button>
      </div>
    </form>

    ${pots ? '' : `<button class="btn-secondaire large" data-action="modifier">Modifier le produit</button>`}

    <h2>Journal</h2>
    ${journal.map((m) => `
      <div class="recap-ligne">
        <span>${new Date(m.date_heure).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })} · ${esc(MOTIFS[m.motif] || m.motif)}${m.note ? ` — ${esc(m.note)}` : ''}</span>
        <strong>${m.delta > 0 ? '+' : ''}${m.delta}</strong>
      </div>`).join('') || '<p class="vide">Aucun mouvement.</p>'}`;

  el.querySelector('#form-inventaire').onsubmit = async (e) => {
    e.preventDefault();
    const compte = entier(new FormData(e.target).get('compte'));
    if (compte === null || compte < 0) { toast('Nombre compté invalide', 'erreur'); return; }
    const ecart = ecartInventaire(compte, quantite);
    if (ecart === 0 && !jamaisSaisi) { toast('Le stock est déjà à ' + compte); return; }
    await db.enregistrerMouvements([db.nouveauMouvement({ produit_id: id, delta: ecart, motif: 'inventaire', note: `compté ${compte}` })]);
    await apresEcriture(`Stock corrigé à ${compte} (${ecart >= 0 ? '+' : ''}${ecart})`);
  };

  el.querySelector('#form-mouvement').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const n = entier(f.get('quantite'));
    if (n === null || n <= 0) { toast('Quantité invalide', 'erreur'); return; }
    const motif = f.get('motif');
    await db.enregistrerMouvements([db.nouveauMouvement({ produit_id: id, delta: n * types[motif], motif, note: f.get('note').trim() })]);
    await apresEcriture(`${MOTIFS[motif]} : ${types[motif] > 0 ? '+' : '−'}${n}`);
  };

  el.onclick = (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'retour') etat.edition = null;
    else if (action === 'modifier') etat.edition = { mode: 'produit', produit: { ...produit }, retour: id };
    else return;
    window.scrollTo(0, 0);
    rafraichir();
  };
  el.onchange = el.oninput = null;
}

// ---------------------------------------------------------------------------
// Formulaire : nouveau lot ou modification d'un produit
// ---------------------------------------------------------------------------

function produitVierge() {
  return {
    id: crypto.randomUUID(),
    categorie: 'miel',
    nom_fr: '',
    nom_nl: '',
    lot: '',
    format: '',
    prix_cents: 1000,
    prix_magasin_cents: null,
    consigne: true,
    date_recolte: '',
    actif: true,
    archive: false,
    ordre: Math.max(0, ...etat.produits.map((p) => p.ordre || 0)) + 1,
    seuil_alerte: null,
  };
}

function formulaire(el) {
  const { mode, produit: p } = etat.edition;
  const lot = mode === 'lot';
  const modeles = etat.produits.filter((x) => !x.archive);

  el.innerHTML = `
    <button class="btn-discret" data-action="annuler">← Retour</button>
    <h2>${lot ? 'Nouveau lot' : 'Modifier le produit'}</h2>
    <form id="form-produit" class="formulaire">
      ${lot && modeles.length ? `
        <label>Partir d'un produit existant
          <select name="modele">
            <option value="">— aucun —</option>
            ${modeles.map((m) => `<option value="${m.id}" ${etat.edition.modele === m.id ? 'selected' : ''}>${esc(m.nom_fr)} ${esc(m.lot)}</option>`).join('')}
          </select>
        </label>` : ''}
      <label>Catégorie
        <select name="categorie">
          ${Object.entries(CATEGORIES).map(([cle, nom]) => `<option value="${cle}" ${p.categorie === cle ? 'selected' : ''}>${nom}</option>`).join('')}
        </select>
      </label>
      <label>Nom <input name="nom_fr" type="text" required value="${esc(p.nom_fr)}" placeholder="Miel de printemps"></label>
      <label>Nom en néerlandais (facultatif) <input name="nom_nl" type="text" value="${esc(p.nom_nl)}" placeholder="Lentehoning"></label>
      <label>Lot <input name="lot" type="text" value="${esc(p.lot)}" placeholder="M07" autocapitalize="characters"></label>
      <label>Format <input name="format" type="text" value="${esc(p.format)}" placeholder="500 g"></label>
      <label>Prix (€) <input name="prix" type="text" inputmode="decimal" required value="${centsToInput(p.prix_cents)}"></label>
      <label>Alerte de stock bas à (facultatif) <input name="seuil" type="text" inputmode="numeric" value="${p.seuil_alerte ?? ''}" placeholder="5"></label>
      <label class="case"><input name="consigne" type="checkbox" ${p.consigne ? 'checked' : ''}> Pot consigné</label>
      ${lot ? `
        <h2>Stock de départ</h2>
        <label>Nombre de pots <input name="pots" type="text" inputmode="numeric" placeholder="40"></label>
        <label class="case"><input name="deduire" type="checkbox" ${quantiteDe(POTS_VIDES) > 0 ? 'checked' : ''}> Déduire ces pots du stock de pots vides (${quantiteDe(POTS_VIDES)} en stock)</label>` : ''}
      <div class="barre">
        <button type="button" class="btn-secondaire" data-action="annuler">Annuler</button>
        <button type="submit" class="btn-principal">${lot ? 'Créer le lot' : 'Enregistrer'}</button>
      </div>
      ${lot ? '' : `<button type="button" class="btn-danger" data-action="archiver">Archiver ce produit (lot épuisé)</button>`}
    </form>`;

  const retour = () => { etat.edition = etat.edition.retour ? { mode: 'detail', id: etat.edition.retour } : null; };

  el.onchange = (e) => {
    // Pré-remplissage depuis un produit existant : tout sauf le lot et le stock.
    if (e.target.name !== 'modele') return;
    const modele = etat.produits.find((x) => x.id === e.target.value);
    const { id, ordre } = p;
    etat.edition.modele = e.target.value;
    etat.edition.produit = modele ? { ...modele, id, ordre, lot: '', actif: true, archive: false, date_recolte: '' } : produitVierge();
    rafraichir();
  };

  el.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'annuler') { retour(); rafraichir(); }
    if (action === 'archiver') {
      await db.enregistrerProduit({ ...p, archive: true, actif: false });
      etat.edition = null;
      await apresEcriture('Produit archivé');
    }
  };

  el.querySelector('#form-produit').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const prix = toCents(f.get('prix'));
    if (prix === null || prix < 0) { toast('Prix invalide', 'erreur'); return; }
    const seuilSaisi = String(f.get('seuil')).trim();
    const seuil = seuilSaisi === '' ? null : entier(seuilSaisi);
    if (seuilSaisi !== '' && (seuil === null || seuil < 0)) { toast("Seuil d'alerte invalide", 'erreur'); return; }
    const produit = {
      ...p,
      categorie: f.get('categorie'),
      nom_fr: f.get('nom_fr').trim(),
      nom_nl: f.get('nom_nl').trim(),
      lot: f.get('lot').trim().toUpperCase(),
      format: f.get('format').trim(),
      prix_cents: prix,
      seuil_alerte: seuil,
      consigne: f.get('consigne') === 'on',
    };
    const doublon = produit.lot && etat.produits.some((x) => x.id !== produit.id && !x.archive && x.lot === produit.lot && x.nom_fr === produit.nom_fr);

    if (lot) {
      const potsSaisis = String(f.get('pots')).trim();
      const pots = potsSaisis === '' ? 0 : entier(potsSaisis);
      if (pots === null || pots < 0) { toast('Nombre de pots invalide', 'erreur'); return; }
      const mouvements = [];
      if (pots > 0) {
        mouvements.push(db.nouveauMouvement({ produit_id: produit.id, delta: pots, motif: 'recolte', note: `lot ${produit.lot}`.trim() }));
        if (f.get('deduire') === 'on') {
          mouvements.push(db.nouveauMouvement({ produit_id: POTS_VIDES, delta: -pots, motif: 'mise_en_pot', note: `${produit.nom_fr} ${produit.lot}`.trim() }));
        }
      }
      produit.date_recolte = new Date().toISOString().slice(0, 10);
      await db.enregistrerMouvements(mouvements, produit);
      etat.edition = null;
    } else {
      await db.enregistrerProduit(produit);
      retour();
    }
    await apresEcriture(doublon ? 'Enregistré — attention, un produit identique existe déjà' : (lot ? 'Lot créé' : 'Produit enregistré'));
  };
  el.oninput = null;
}

export async function rendre(el) {
  const mode = etat.edition?.mode;
  if (mode === 'detail') await detail(el);
  else if (mode === 'lot' || mode === 'produit') formulaire(el);
  else liste(el);
}
