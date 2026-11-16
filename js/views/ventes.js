// Ventes du jour : totaux par mode de paiement et liste des tickets (lecture seule en V1 lot 1).
import { etat, esc, toast, MODES } from '../etat.js';
import { construireTicket } from '../ticket.js';
import { formatEuro } from '../money.js';
import * as db from '../db.js';

function nomClient(vente) {
  const client = etat.clients.find((c) => c.id === vente.client_id);
  return client ? (client.nom || client.email) : '';
}

export async function rendre(el) {
  const debut = new Date(); debut.setHours(0, 0, 0, 0);
  const fin = new Date(); fin.setHours(23, 59, 59, 999);
  const ventes = (await db.ventesEntre(debut.toISOString(), fin.toISOString())).filter((v) => v.statut !== 'annulee');

  const total = ventes.reduce((s, v) => s + v.total_cents, 0);
  const parMode = {};
  const parProduit = {};
  for (const v of ventes) {
    parMode[v.mode_paiement] = (parMode[v.mode_paiement] || 0) + v.total_cents;
    for (const l of v.lignes) {
      const cle = `${l.libelle}${l.lot ? ` ${l.lot}` : ''}`;
      parProduit[cle] = (parProduit[cle] || 0) + l.quantite;
    }
  }

  el.innerHTML = `
    <h2>Aujourd'hui</h2>
    <div class="tuiles">
      <div class="tuile"><div class="tuile-valeur">${ventes.length}</div><div>vente(s)</div></div>
      <div class="tuile"><div class="tuile-valeur">${formatEuro(total)}</div><div>total</div></div>
      ${Object.entries(parMode).map(([mode, cents]) => `<div class="tuile"><div class="tuile-valeur">${formatEuro(cents)}</div><div>${esc(MODES[mode] || mode)}</div></div>`).join('')}
    </div>
    ${Object.keys(parProduit).length ? `
      <h2>Par produit</h2>
      ${Object.entries(parProduit).map(([nom, q]) => `<div class="recap-ligne"><span>${esc(nom)}</span><span>${q}</span></div>`).join('')}` : ''}
    <h2>Tickets</h2>
    ${ventes.map((v) => `
      <details class="recap">
        <summary>
          <span>${new Date(v.date_heure).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })} · ${esc(v.numero)} · ${esc(MODES[v.mode_paiement] || v.mode_paiement)}</span>
          <strong>${formatEuro(v.total_cents)}</strong>
        </summary>
        ${v.lignes.map((l) => `<div class="recap-ligne"><span>${l.quantite} × ${esc(l.libelle)} ${esc(l.lot)}</span><span>${formatEuro(l.total_cents)}</span></div>`).join('')}
        ${v.remise_cents ? `<div class="recap-ligne"><span>Remise ${esc(v.remise_libelle)}</span><span>−${formatEuro(v.remise_cents)}</span></div>` : ''}
        ${nomClient(v) ? `<div class="recap-ligne"><span>Client</span><span>${esc(nomClient(v))}</span></div>` : ''}
        ${v.ticket_email ? `<div class="recap-ligne"><span>Ticket par e-mail</span><span>${v.ticket_envoye_le ? 'envoyé' : 'en attente d\'envoi'}</span></div>` : ''}
        <button class="btn-secondaire large" data-action="partager" data-id="${v.id}">Partager le ticket</button>
      </details>`).join('') || '<p class="vide">Aucune vente aujourd\'hui.</p>'}`;
  // Partage du ticket en texte (WhatsApp, SMS…) ; à défaut, copie dans le presse-papiers.
  el.onclick = async (e) => {
    const bouton = e.target.closest('[data-action="partager"]');
    if (!bouton) return;
    const vente = ventes.find((v) => v.id === bouton.dataset.id);
    const nomsNl = Object.fromEntries(etat.produits.filter((p) => p.nom_nl).map((p) => [p.id, p.nom_nl]));
    const { sujet, texte } = construireTicket(vente, etat.config, nomsNl);
    try {
      if (navigator.share) await navigator.share({ title: sujet, text: texte });
      else { await navigator.clipboard.writeText(texte); toast('Ticket copié'); }
    } catch (erreur) {
      if (erreur.name !== 'AbortError') toast('Partage impossible', 'erreur');
    }
  };
  el.oninput = el.onchange = el.onsubmit = null;
}
