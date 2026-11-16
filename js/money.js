// Montants : toujours des centimes entiers en interne (jamais de flottants).

/**
 * Convertit une saisie ("12,50", "12.5", "-0,50", "10 €") en centimes.
 * @param {string|number} saisie
 * @returns {number|null} centimes, ou null si la saisie est invalide
 */
export function toCents(saisie) {
  const s = String(saisie ?? '').replace(/[€\s]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  const negatif = s.startsWith('-');
  const [euros, cents = ''] = s.replace('-', '').split('.');
  const valeur = parseInt(euros, 10) * 100 + parseInt(cents.padEnd(2, '0') || '0', 10);
  return negatif ? -valeur : valeur;
}

/** 1250 -> "12,50" (pour pré-remplir un champ de saisie). */
export function centsToInput(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** 1250 -> "12,50 €" (format belge). */
export function formatEuro(cents) {
  return `${centsToInput(cents)} €`;
}

/** 1250 -> "12.50" (format imposé par le QR EPC : point décimal). */
export function centsToEpc(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
