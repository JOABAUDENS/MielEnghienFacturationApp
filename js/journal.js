// Journal Smart : regroupement des encaissements à ressaisir dans Smart, par jour ou par mois.
// Module pur, testé dans tests/tests.html.
import { centsToInput } from './money.js';

/** Date locale d'une vente : "2026-11-17" (jour) ou "2026-11" (mois). */
export function clePeriode(dateIso, regroupement) {
  const d = new Date(dateIso);
  const mois = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return regroupement === 'mois' ? mois : `${mois}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-11-17" -> "lundi 17/11/2026" ; "2026-11" -> "novembre 2026". */
export function libellePeriode(cle) {
  const [a, m, j] = cle.split('-').map(Number);
  if (!j) return new Date(a, m - 1, 1).toLocaleDateString('fr-BE', { month: 'long', year: 'numeric' });
  return new Date(a, m - 1, j).toLocaleDateString('fr-BE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Encaissements sans facturation à déclarer dans Smart : ventes payées par QR ou en liquide,
 * hors magasins (facturés à part), hors dons et hors ventes annulées.
 */
export function encaissements(ventes) {
  return ventes.filter((v) => v.statut === 'payee' && v.canal !== 'magasin' && (v.mode_paiement === 'qr' || v.mode_paiement === 'liquide'));
}

/** Livraisons magasin dont la facture Smart reste à faire. */
export function livraisonsAFacturer(ventes) {
  return ventes.filter((v) => v.statut === 'en_attente' && v.mode_paiement === 'facture_smart');
}

/**
 * @param {object[]} ventes
 * @param {'jour'|'mois'} regroupement
 * @returns {Array<{cle: string, libelle: string, ids: string[], nb: number, total_cents: number,
 *   parMode: Record<string, number>, parProduit: Record<string, number>}>} du plus récent au plus ancien
 */
export function regrouper(ventes, regroupement) {
  const groupes = {};
  for (const v of ventes) {
    const cle = clePeriode(v.date_heure, regroupement);
    const g = (groupes[cle] ??= { cle, libelle: libellePeriode(cle), ids: [], nb: 0, total_cents: 0, parMode: {}, parProduit: {} });
    g.ids.push(v.id);
    g.nb += 1;
    g.total_cents += v.total_cents;
    g.parMode[v.mode_paiement] = (g.parMode[v.mode_paiement] || 0) + v.total_cents;
    for (const l of v.lignes || []) {
      const nom = `${l.libelle}${l.lot ? ` ${l.lot}` : ''}`;
      g.parProduit[nom] = (g.parProduit[nom] || 0) + l.quantite;
    }
  }
  return Object.values(groupes).sort((a, b) => b.cle.localeCompare(a.cle));
}

const detailProduits = (g) => Object.entries(g.parProduit).map(([nom, q]) => `${q} × ${nom}`).join(', ');

/** Texte à coller (un paragraphe par période). */
export function versTexte(groupes) {
  return groupes.map((g) => [
    `${g.libelle} — ${g.nb} vente(s) — ${centsToInput(g.total_cents)} €`,
    `  Virement : ${centsToInput(g.parMode.qr || 0)} € · Liquide : ${centsToInput(g.parMode.liquide || 0)} €`,
    `  ${detailProduits(g)}`,
  ].join('\n')).join('\n\n');
}

/** CSV pour Excel en français : séparateur point-virgule, virgule décimale. */
export function versCsv(groupes) {
  const champ = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lignes = [['periode', 'nb_ventes', 'total', 'virement', 'liquide', 'detail']];
  for (const g of groupes) {
    lignes.push([g.cle, g.nb, centsToInput(g.total_cents), centsToInput(g.parMode.qr || 0), centsToInput(g.parMode.liquide || 0), detailProduits(g)]);
  }
  return lignes.map((l) => l.map(champ).join(';')).join('\r\n');
}
