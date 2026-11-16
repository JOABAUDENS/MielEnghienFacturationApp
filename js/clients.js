// Clients : recherche, détection de doublons, statistiques d'achat.
// Module pur, testé dans tests/tests.html.

/** Minuscules, sans accents, espaces réduits : base de toutes les comparaisons. */
export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

export function emailValide(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

/** Fiches utilisables : ni supprimées, ni fusionnées dans une autre. */
export function visibles(clients) {
  return clients.filter((c) => !c.supprime && !c.fusionne_dans);
}

/**
 * Recherche à la frappe sur le nom et l'e-mail (dès 2 caractères), insensible à la casse et
 * aux accents. Les clients ayant acheté le plus récemment sortent en premier.
 * @param {Record<string, {dernier: string}>} [stats]
 */
export function rechercher(clients, saisie, stats = {}, limite = 8) {
  const q = normaliser(saisie);
  if (q.length < 2) return [];
  return visibles(clients)
    .filter((c) => normaliser(c.nom).includes(q) || normaliser(c.email).includes(q))
    .sort((a, b) => String(stats[b.id]?.dernier || '').localeCompare(String(stats[a.id]?.dernier || ''))
      || normaliser(a.nom).localeCompare(normaliser(b.nom)))
    .slice(0, limite);
}

/** Distance d'édition (Levenshtein) entre deux textes. */
export function distance(a, b) {
  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const courante = [i];
    for (let j = 1; j <= b.length; j++) {
      courante[j] = Math.min(
        precedente[j] + 1,
        courante[j - 1] + 1,
        precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    precedente = courante;
  }
  return precedente[b.length];
}

/**
 * Cherche les fiches qui pourraient être la même personne.
 * @returns {{parEmail: object|null, parNom: object[]}}
 *   parEmail : même e-mail (c'est la même personne) ; parNom : nom identique ou très proche
 */
export function trouverDoublons(clients, { id, nom, email }) {
  const autres = visibles(clients).filter((c) => c.id !== id);
  const e = normaliser(email);
  const n = normaliser(nom);
  const parEmail = e ? autres.find((c) => normaliser(c.email) === e) || null : null;
  const parNom = n.length < 3 ? [] : autres.filter((c) => {
    if (parEmail && c.id === parEmail.id) return false;
    const autre = normaliser(c.nom);
    if (!autre) return false;
    if (autre === n) return true;
    // Une ou deux fautes de frappe, sur des noms assez longs pour que ce soit significatif.
    return Math.min(autre.length, n.length) >= 5 && distance(autre, n) <= 2;
  });
  return { parEmail, parNom };
}

/**
 * Statistiques d'achat par client, hors ventes annulées.
 * @returns {Record<string, {nb: number, total_cents: number, dernier: string}>}
 */
export function statsClients(ventes) {
  const stats = {};
  for (const v of ventes) {
    if (!v.client_id || v.statut === 'annulee') continue;
    const s = (stats[v.client_id] ??= { nb: 0, total_cents: 0, dernier: '' });
    s.nb += 1;
    s.total_cents += Number(v.total_cents) || 0;
    if (String(v.date_heure) > s.dernier) s.dernier = String(v.date_heure);
  }
  return stats;
}
