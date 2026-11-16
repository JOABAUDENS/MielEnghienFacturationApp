// Calcul du stock à partir du journal de mouvements. Module pur, testé dans tests/tests.html.
// Le stock d'un produit est la somme de ses mouvements : on ne réécrit jamais le passé.

/** Identifiant de l'article « pots vides » (consignes rendues, pots achetés). */
export const POTS_VIDES = 'POTS_VIDES';

/** Mouvements qui ne prouvent pas qu'un stock a été saisi (ils viennent des ventes). */
const MOTIFS_DE_VENTE = ['vente', 'annulation_vente'];

/**
 * @param {Array<{produit_id: string, delta: number, motif: string}>} mouvements
 * @returns {Record<string, {quantite: number, initialise: boolean}>}
 *   initialise = au moins une entrée, sortie manuelle ou inventaire a été saisie
 */
export function calculerStocks(mouvements) {
  const stocks = {};
  for (const m of mouvements) {
    const s = (stocks[m.produit_id] ??= { quantite: 0, initialise: false });
    s.quantite += Number(m.delta) || 0;
    if (!MOTIFS_DE_VENTE.includes(m.motif)) s.initialise = true;
  }
  return stocks;
}

/**
 * Niveau d'alerte d'un produit.
 * @param {{quantite: number, initialise: boolean}|undefined} stock
 * @param {number|null} seuil seuil d'alerte « stock bas » (null = pas d'alerte)
 * @param {number} [dansPanier] quantité déjà dans le panier en cours
 * @returns {'inconnu'|'rupture'|'bas'|'ok'}
 */
export function niveauStock(stock, seuil, dansPanier = 0) {
  if (!stock || !stock.initialise) return 'inconnu';
  const reste = stock.quantite - dansPanier;
  if (reste < 0 || stock.quantite <= 0) return 'rupture';
  if (seuil !== null && seuil !== undefined && seuil !== '' && stock.quantite <= Number(seuil)) return 'bas';
  return 'ok';
}

/** Écart à enregistrer pour qu'un stock théorique devienne le stock réellement compté. */
export function ecartInventaire(compte, theorique) {
  return compte - theorique;
}
