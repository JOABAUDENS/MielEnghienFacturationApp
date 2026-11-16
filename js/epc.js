// Construction du payload d'un QR code de virement SEPA (norme EPC069-12).
// Module pur : aucune dépendance au DOM, testé dans tests/tests.html.
import { centsToEpc } from './money.js';

/**
 * Nettoie un texte pour les applis bancaires les plus strictes :
 * sans accents, uniquement lettres, chiffres, espaces et - . , / + : ( )
 */
export function nettoyer(texte, longueurMax) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 \-.,/+:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, longueurMax)
    .trim();
}

/** Retire les espaces et met en majuscules. */
export function normaliserIban(iban) {
  return String(iban ?? '').replace(/\s+/g, '').toUpperCase();
}

/** Validation IBAN par modulo 97 (ISO 13616). */
export function ibanValide(iban) {
  const s = normaliserIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const reordonne = s.slice(4) + s.slice(0, 4);
  let reste = 0;
  for (const c of reordonne) {
    const valeur = c >= 'A' ? String(c.charCodeAt(0) - 55) : c;
    for (const chiffre of valeur) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

/** "BE68539007547034" -> "BE68 5390 0754 7034" (affichage). */
export function formaterIban(iban) {
  return normaliserIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Lignes du payload EPC :
 *  1 BCD · 2 version · 3 jeu de caractères (1 = UTF-8) · 4 SCT · 5 BIC · 6 bénéficiaire
 *  7 IBAN · 8 montant · 9 purpose · 10 communication STRUCTURÉE · 11 communication LIBRE
 * Le libellé va en ligne 11. La ligne 10 reste vide : y mettre du texte libre fait
 * rejeter le QR par les applis bancaires strictes (bogue de l'ancienne page HTML).
 *
 * @param {{bic?: string, nom: string, iban: string, montantCents: number, communication?: string}} p
 * @returns {string}
 */
export function buildEpcPayload({ bic = '', nom, iban, montantCents, communication = '' }) {
  const ibanPropre = normaliserIban(iban);
  const nomPropre = nettoyer(nom, 70);
  if (!ibanValide(ibanPropre)) throw new Error('IBAN invalide');
  if (!nomPropre) throw new Error('Nom du bénéficiaire manquant');
  if (!Number.isInteger(montantCents) || montantCents < 1 || montantCents > 99999999999) {
    throw new Error('Montant invalide');
  }
  const lignes = [
    'BCD',
    '002',
    '1',
    'SCT',
    String(bic).replace(/\s+/g, '').toUpperCase(),
    nomPropre,
    ibanPropre,
    'EUR' + centsToEpc(montantCents),
    '', // 9 : purpose
    '', // 10 : communication structurée — toujours vide
    nettoyer(communication, 140), // 11 : communication libre
  ];
  while (lignes[lignes.length - 1] === '') lignes.pop(); // lignes vides finales omises
  const payload = lignes.join('\n');
  if (new TextEncoder().encode(payload).length > 331) throw new Error('Payload EPC trop long');
  return payload;
}
