// Catalogue : activer les produits du jour, créer, modifier, archiver.
import { etat, esc, rafraichir, toast, CATEGORIES } from '../etat.js';
import { formatEuro, toCents, centsToInput } from '../money.js';
import * as db from '../db.js';

function nouveauProduit() {
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
    device_id: etat.config.device_id,
    nouveau: true,
  };
}

function liste(el) {
  const visibles = etat.produits.filter((p) => !p.archive);
  const archives = etat.produits.filter((p) => p.archive);
  const ligne = (p) => `
    <div class="ligne">
      <label class="interrupteur" title="En vente aujourd'hui">
        <input type="checkbox" data-action="actif" data-id="${p.id}" ${p.actif ? 'checked' : ''}>
        <span></span>
      </label>
      <div class="ligne-info">
        <div class="ligne-nom">${esc(p.nom_fr)} ${p.lot ? `<span class="lot">${esc(p.lot)}</span>` : ''}</div>
        <div class="ligne-prix">${CATEGORIES[p.categorie] || ''} · ${formatEuro(p.prix_cents)}${p.format ? ` · ${esc(p.format)}` : ''}</div>
      </div>
      <button class="btn-secondaire" data-action="modifier" data-id="${p.id}">Modifier</button>
    </div>`;

  el.innerHTML = `
    <p class="aide">L'interrupteur indique si le produit apparaît sur l'écran de vente aujourd'hui.</p>
    <div class="barre">
      <button class="btn-secondaire" data-action="tous" data-valeur="1">Tout activer</button>
      <button class="btn-secondaire" data-action="tous" data-valeur="0">Tout désactiver</button>
      <button class="btn-principal" data-action="nouveau">+ Produit</button>
    </div>
    ${visibles.map(ligne).join('') || '<p class="vide">Aucun produit.</p>'}
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
  };

  el.onclick = async (e) => {
    const bouton = e.target.closest('button[data-action]');
    if (!bouton) return;
    const { action, id } = bouton.dataset;
    if (action === 'nouveau') etat.edition = nouveauProduit();
    else if (action === 'modifier') etat.edition = { ...etat.produits.find((p) => p.id === id) };
    else if (action === 'tous') {
      const actif = bouton.dataset.valeur === '1';
      const cibles = etat.produits.filter((p) => !p.archive);
      cibles.forEach((p) => { p.actif = actif; });
      await db.enregistrerProduits(cibles);
    } else if (action === 'desarchiver') {
      const p = etat.produits.find((x) => x.id === id);
      p.archive = false;
      await db.enregistrerProduit(p);
    }
    rafraichir();
  };
  el.oninput = null;
}

function formulaire(el) {
  const p = etat.edition;
  el.innerHTML = `
    <h2>${p.nouveau ? 'Nouveau produit' : 'Modifier le produit'}</h2>
    <form id="form-produit" class="formulaire">
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
      <label class="case"><input name="consigne" type="checkbox" ${p.consigne ? 'checked' : ''}> Pot consigné</label>
      <div class="barre">
        <button type="button" class="btn-secondaire" data-action="annuler">Annuler</button>
        <button type="submit" class="btn-principal">Enregistrer</button>
      </div>
      ${p.nouveau ? '' : `<button type="button" class="btn-danger" data-action="archiver">Archiver ce produit (lot épuisé)</button>`}
    </form>`;

  el.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'annuler') { etat.edition = null; rafraichir(); }
    if (action === 'archiver') {
      const { nouveau, ...produit } = p;
      await db.enregistrerProduit({ ...produit, archive: true, actif: false });
      etat.produits = await db.produits();
      etat.edition = null;
      toast('Produit archivé');
      rafraichir();
    }
  };

  el.querySelector('#form-produit').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const prix = toCents(f.get('prix'));
    if (prix === null || prix < 0) { toast('Prix invalide', 'erreur'); return; }
    const { nouveau, ...produit } = p;
    Object.assign(produit, {
      categorie: f.get('categorie'),
      nom_fr: f.get('nom_fr').trim(),
      nom_nl: f.get('nom_nl').trim(),
      lot: f.get('lot').trim().toUpperCase(),
      format: f.get('format').trim(),
      prix_cents: prix,
      consigne: f.get('consigne') === 'on',
    });
    const doublon = produit.lot && etat.produits.some((x) => x.id !== produit.id && !x.archive && x.lot === produit.lot && x.nom_fr === produit.nom_fr);
    await db.enregistrerProduit(produit);
    etat.produits = await db.produits();
    etat.edition = null;
    toast(doublon ? 'Enregistré — attention, un produit identique existe déjà' : 'Produit enregistré', doublon ? 'erreur' : 'ok');
    rafraichir();
  };
  el.onchange = null;
  el.oninput = null;
}

export function rendre(el) {
  if (etat.edition) formulaire(el);
  else liste(el);
}
