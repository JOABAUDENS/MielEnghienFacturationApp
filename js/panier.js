// Calcul du panier. Module pur, testé dans tests/tests.html.
import { toCents } from './money.js';

/**
 * Interprète une remise saisie : "10%" (pourcentage) ou "2,50" (montant).
 * @param {string} saisie
 * @param {number} baseCents montant sur lequel porte la remise
 * @returns {{cents: number, libelle: string}} cents est borné entre 0 et la base
 */
export function parseRemise(saisie, baseCents) {
  const s = String(saisie ?? '').trim();
  if (!s || baseCents <= 0) return { cents: 0, libelle: '' };
  const pct = s.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  let cents;
  let libelle;
  if (pct) {
    const taux = Math.min(100, parseFloat(pct[1].replace(',', '.')));
    cents = Math.round((baseCents * taux) / 100);
    libelle = `${String(taux).replace('.', ',')} %`;
  } else {
    cents = toCents(s);
    if (cents === null || cents <= 0) return { cents: 0, libelle: '' };
    libelle = 'Remise';
  }
  return { cents: Math.min(cents, baseCents), libelle };
}

/**
 * @param {object} p
 * @param {Array<{id:string, nom_fr:string, lot?:string, prix_cents:number}>} p.produits
 * @param {Record<string, number>} p.quantites  produit_id -> quantité
 * @param {number} p.consignes                  nombre de pots vides rendus
 * @param {number} p.consigneCents              valeur d'une consigne (positive)
 * @param {Array<{libelle:string, cents:number}>} p.divers lignes à montant libre
 * @param {string} p.remise                     saisie brute
 * @returns {{lignes: Array, sousTotalCents: number, remiseCents: number, remiseLibelle: string, totalCents: number, nbArticles: number}}
 */
export function calculerPanier({ produits, quantites, consignes = 0, consigneCents = 50, divers = [], remise = '' }) {
  const lignes = [];
  for (const p of produits) {
    const q = quantites[p.id] || 0;
    if (q > 0) {
      lignes.push({
        produit_id: p.id,
        libelle: p.nom_fr,
        lot: p.lot || '',
        quantite: q,
        prix_unitaire_cents: p.prix_cents,
        total_cents: q * p.prix_cents,
      });
    }
  }
  for (const d of divers) {
    lignes.push({
      produit_id: 'DIVERS',
      libelle: d.libelle || 'Divers',
      lot: '',
      quantite: 1,
      prix_unitaire_cents: d.cents,
      total_cents: d.cents,
    });
  }
  // La remise porte sur les articles vendus, pas sur le remboursement des consignes.
  const baseRemise = lignes.reduce((s, l) => s + Math.max(0, l.total_cents), 0);
  const nbArticles = lignes.reduce((s, l) => s + l.quantite, 0);
  if (consignes > 0) {
    lignes.push({
      produit_id: 'RETOUR_CONSIGNE',
      libelle: 'Retour consigne',
      lot: '',
      quantite: consignes,
      prix_unitaire_cents: -consigneCents,
      total_cents: -consignes * consigneCents,
    });
  }
  const sousTotalCents = lignes.reduce((s, l) => s + l.total_cents, 0);
  const { cents: remiseCents, libelle: remiseLibelle } = parseRemise(remise, baseRemise);
  return {
    lignes,
    sousTotalCents,
    remiseCents,
    remiseLibelle,
    totalCents: sousTotalCents - remiseCents,
    nbArticles,
  };
}

/**
 * Mouvements de stock générés par une vente validée.
 * @returns {Array<{produit_id:string, delta:number, motif:string}>}
 */
export function mouvementsDeVente(lignes) {
  const mouvements = [];
  for (const l of lignes) {
    if (l.produit_id === 'DIVERS') continue;
    if (l.produit_id === 'RETOUR_CONSIGNE') {
      mouvements.push({ produit_id: 'POTS_VIDES', delta: l.quantite, motif: 'retour_consigne' });
    } else {
      mouvements.push({ produit_id: l.produit_id, delta: -l.quantite, motif: 'vente' });
    }
  }
  return mouvements;
}
