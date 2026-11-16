// Écran de vente : produits du jour, panier, total, bouton Encaisser.
import { etat, esc, rafraichir, toast, prochainNumero, CATEGORIES, CANAUX } from '../etat.js';
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
    else if (action === 'vider') etat.panier = { quantites: {}, consignes: 0, divers: [], remise: '' };
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
    }
  };

  el.onchange = async (e) => {
    if (e.target.id === 'canal' || e.target.id === 'lieu') {
      const maj = { [e.target.id]: e.target.value.trim() };
      Object.assign(etat.config, maj);
      await db.ecrireConfig(maj);
    }
  };
}
