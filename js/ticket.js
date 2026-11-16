// Ticket de caisse en français ou en néerlandais : version texte (partage) et HTML (e-mail).
// Module pur, testé dans tests/tests.html. Le ticket n'est pas une facture.
import { formatEuro } from './money.js';

const TEXTES = {
  fr: {
    sujet: 'Votre ticket',
    ticket: 'Ticket',
    lot: 'lot',
    remise: 'Remise',
    total: 'Total',
    paiement: { qr: 'Payé par virement', liquide: 'Payé en espèces', facture_smart: 'Sur facture', offert: 'Offert' },
    consigne: 'Retour consigne',
    vendeur: 'Vendeur',
    pasFacture: "Ce document n'est pas une facture.",
    locale: 'fr-BE',
  },
  nl: {
    sujet: 'Uw ticket',
    ticket: 'Ticket',
    lot: 'lot',
    remise: 'Korting',
    total: 'Totaal',
    paiement: { qr: 'Betaald via overschrijving', liquide: 'Contant betaald', facture_smart: 'Op factuur', offert: 'Gratis' },
    consigne: 'Statiegeld terug',
    vendeur: 'Verkoper',
    pasFacture: 'Dit document is geen factuur.',
    locale: 'nl-BE',
  },
};

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * @param {object} vente vente avec ses `lignes`
 * @param {{ticket_vendeur?: string, ticket_pied?: string}} config
 * @param {Record<string, string>} [nomsNl] produit_id -> nom néerlandais
 * @returns {{sujet: string, texte: string, html: string}}
 */
export function construireTicket(vente, config, nomsNl = {}) {
  const langue = vente.langue === 'nl' ? 'nl' : 'fr';
  const t = TEXTES[langue];
  const date = new Date(vente.date_heure).toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'short' });

  const lignes = (vente.lignes || []).map((l) => {
    let nom = l.libelle;
    if (l.produit_id === 'RETOUR_CONSIGNE') nom = t.consigne;
    else if (langue === 'nl' && nomsNl[l.produit_id]) nom = nomsNl[l.produit_id];
    if (l.lot) nom += ` (${t.lot} ${l.lot})`;
    return { gauche: `${l.quantite} × ${nom}`, droite: formatEuro(l.total_cents) };
  });
  if (vente.remise_cents) {
    lignes.push({ gauche: `${t.remise}${vente.remise_libelle && vente.remise_libelle !== 'Remise' ? ` ${vente.remise_libelle}` : ''}`, droite: `-${formatEuro(vente.remise_cents)}` });
  }

  const titre = "Miel d'Enghien";
  const entete = `${t.ticket} ${vente.numero} — ${date}`;
  const paiement = t.paiement[vente.mode_paiement] || '';
  const vendeur = String(config.ticket_vendeur || '').trim();
  const pied = String(config.ticket_pied || '').trim();

  const texte = [
    titre,
    entete,
    '',
    ...lignes.map((l) => `${l.gauche} : ${l.droite}`),
    '',
    `${t.total} : ${formatEuro(vente.total_cents)}`,
    paiement,
    '',
    vendeur ? `${t.vendeur} : ${vendeur.replace(/\s*\n\s*/g, ', ')}` : '',
    t.pasFacture,
    pied,
  ].filter((ligne, i, tout) => ligne !== '' || (i > 0 && tout[i - 1] !== '')).join('\n').trim();

  const html = `
<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;color:#451a03">
  <h2 style="margin:0 0 4px;color:#b45309">🐝 ${esc(titre)}</h2>
  <p style="margin:0 0 16px;color:#92400e">${esc(entete)}</p>
  <table style="width:100%;border-collapse:collapse">
    ${lignes.map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #fde68a">${esc(l.gauche)}</td><td style="padding:6px 0;border-bottom:1px solid #fde68a;text-align:right;white-space:nowrap">${esc(l.droite)}</td></tr>`).join('')}
    <tr><td style="padding:10px 0;font-weight:bold;font-size:18px">${esc(t.total)}</td><td style="padding:10px 0;font-weight:bold;font-size:18px;text-align:right;white-space:nowrap">${esc(formatEuro(vente.total_cents))}</td></tr>
  </table>
  <p style="margin:4px 0 16px">${esc(paiement)}</p>
  <p style="margin:0;font-size:12px;color:#78716c">
    ${vendeur ? `${esc(t.vendeur)} : ${esc(vendeur).replace(/\s*\n\s*/g, ', ')}<br>` : ''}${esc(t.pasFacture)}
  </p>
  ${pied ? `<p style="margin:16px 0 0">${esc(pied)}</p>` : ''}
</div>`.trim();

  return { sujet: `${t.sujet} ${titre} ${vente.numero}`, texte, html };
}
