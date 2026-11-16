// État en mémoire partagé par les écrans, et petits utilitaires d'interface.

/** À incrémenter en même temps que VERSION dans sw.js à chaque publication. */
export const VERSION_APP = '1.1.0';

export const CATEGORIES = { miel: 'Miel', hydromel: 'Hydromel', autre: 'Autres' };
export const CANAUX = { marche: 'Marché', domicile: 'Domicile', autre: 'Autre' };
export const MODES = { qr: 'QR virement', liquide: 'Liquide' };

export function panierVide() {
  return { quantites: {}, consignes: 0, divers: [], remise: '' };
}

export const etat = {
  config: {},
  produits: [],
  panier: panierVide(),
  onglet: 'vente',
  /** Paiement en cours (null = pas de paiement) : { calcul, numero, etape } */
  paiement: null,
  /** Produit en cours d'édition dans le catalogue (null = liste) */
  edition: null,
};

/** Échappe un texte avant insertion dans du HTML. */
export function esc(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let fonctionRendu = () => {};
export function definirRendu(f) { fonctionRendu = f; }
/** Redessine l'écran courant. */
export function rafraichir() { fonctionRendu(); }

let minuterieToast;
/** Message bref en bas d'écran, jamais bloquant. */
export function toast(message, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast visible ${type}`;
  clearTimeout(minuterieToast);
  minuterieToast = setTimeout(() => { el.className = 'toast'; }, 3000);
}

/** Numéro du prochain ticket, ex. "J26-0042". Le compteur n'avance qu'à la validation. */
export function prochainNumero() {
  const annee = String(new Date().getFullYear()).slice(-2);
  const sequence = String((etat.config.compteur_ticket || 0) + 1).padStart(4, '0');
  return `${etat.config.prefixe || 'J'}${annee}-${sequence}`;
}
