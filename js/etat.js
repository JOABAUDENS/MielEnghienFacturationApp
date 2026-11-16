// État en mémoire partagé par les écrans, et petits utilitaires d'interface.

/** À incrémenter en même temps que VERSION dans sw.js à chaque publication. */
export const VERSION_APP = '1.3.0';

export const CATEGORIES = { miel: 'Miel', hydromel: 'Hydromel', autre: 'Autres' };
export const CANAUX = { marche: 'Marché', domicile: 'Domicile', autre: 'Autre' };
export const MODES = { qr: 'QR virement', liquide: 'Liquide' };

/** Libellés des motifs de mouvement de stock. */
export const MOTIFS = {
  recolte: 'Entrée de stock',
  vente: 'Vente',
  annulation_vente: 'Vente annulée',
  livraison_magasin: 'Livraison magasin',
  don: 'Don',
  casse: 'Casse',
  perso: 'Consommation perso',
  retour_consigne: 'Retour de consigne',
  achat_pots: 'Achat de pots',
  mise_en_pot: 'Mise en pot',
  inventaire: 'Inventaire',
};

export function panierVide() {
  return { quantites: {}, consignes: 0, divers: [], remise: '', client_id: null, ticket: false };
}

export const etat = {
  config: {},
  produits: [],
  /** produit_id -> { quantite, initialise } ; recalculé après chaque mouvement */
  stocks: {},
  clients: [],
  /** client_id -> { nb, total_cents, dernier } */
  statsClients: {},
  panier: panierVide(),
  onglet: 'vente',
  /** Paiement en cours (null = pas de paiement) : { calcul, numero, etape } */
  paiement: null,
  /** Sous-écran des onglets Stock et Clients (null = liste) : { mode: 'detail'|'produit'|'lot'|'client', … } */
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
