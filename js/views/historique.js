// Onglet Historique : ventes par période, actions sur une vente (annuler, changer le mode de
// paiement, associer un client, ticket), et journal Smart (encaissements à ressaisir).
import { etat, esc, rafraichir, toast, MODES, CANAUX, champLieu, choisirLieu } from '../etat.js';
import { construireTicket } from '../ticket.js';
import { mouvementsAnnulation } from '../panier.js';
import { visibles, normaliser } from '../clients.js';
import { encaissements, livraisonsAFacturer, regrouper, versTexte, versCsv } from '../journal.js';
import { rechargerClients } from '../chargement.js';
import { formatEuro } from '../money.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

const PERIODES = { jour: "Aujourd'hui", hier: 'Hier', semaine: '7 derniers jours', mois: 'Ce mois', moisPrecedent: 'Mois précédent', annee: 'Cette année', tout: 'Tout' };

// État propre à cet écran
let vue = 'ventes'; // 'ventes' | 'smart'
let periode = 'jour';
let canal = '';
let regroupement = 'jour';
let dejaSaisis = false;
let selection = new Set();

function bornes() {
  const debut = new Date(); debut.setHours(0, 0, 0, 0);
  const fin = new Date(); fin.setHours(23, 59, 59, 999);
  if (periode === 'hier') { debut.setDate(debut.getDate() - 1); fin.setDate(fin.getDate() - 1); }
  else if (periode === 'semaine') debut.setDate(debut.getDate() - 6);
  else if (periode === 'mois') debut.setDate(1);
  else if (periode === 'moisPrecedent') { debut.setMonth(debut.getMonth() - 1, 1); fin.setDate(0); }
  else if (periode === 'annee') debut.setMonth(0, 1);
  else if (periode === 'tout') debut.setFullYear(2000, 0, 1);
  return [debut.toISOString(), fin.toISOString()];
}

const nomsNl = () => Object.fromEntries(etat.produits.filter((p) => p.nom_nl).map((p) => [p.id, p.nom_nl]));
const clientDe = (v) => etat.clients.find((c) => c.id === v.client_id);
const nomClient = (v) => { const c = clientDe(v); return c ? (c.nom || c.email) : ''; };
const heure = (iso) => new Date(iso).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
const jour = (iso) => new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit' });
const aujourdhui = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale

async function apresEcriture(message) {
  etat.stocks = await db.stocks();
  await rechargerClients();
  sync.apresEcriture();
  if (message) toast(message);
  rafraichir();
}

function onglets() {
  return `
    <div class="barre segments">
      <button class="${vue === 'ventes' ? 'btn-principal' : 'btn-secondaire'}" data-action="vue" data-vue="ventes">Ventes</button>
      <button class="${vue === 'smart' ? 'btn-principal' : 'btn-secondaire'}" data-action="vue" data-vue="smart">Journal Smart</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Ventes
// ---------------------------------------------------------------------------

function actionsVente(v) {
  if (v.statut === 'annulee') {
    return `<p class="aide">Annulée le ${jour(v.annulee_le)}${v.motif_annulation ? ` — ${esc(v.motif_annulation)}` : ''}</p>`;
  }
  const client = clientDe(v);
  const ticketPossible = client?.email && etat.config.ticket_vendeur && sync.configuree();
  const clients = visibles(etat.clients).sort((a, b) => normaliser(a.nom || a.email).localeCompare(normaliser(b.nom || b.email)));
  return `
    ${v.ticket_email ? `<div class="recap-ligne"><span>Ticket par e-mail</span><span>${v.ticket_envoye_le && !v.ticket_a_renvoyer ? 'envoyé' : "en attente d'envoi"}</span></div>` : ''}
    ${v.smart_saisi_le ? `<div class="recap-ligne"><span>Saisi dans Smart</span><span>${esc(v.smart_saisi_le)}</span></div>` : ''}
    <div class="barre">
      <button class="btn-secondaire" data-action="partager" data-id="${v.id}">Partager le ticket</button>
      <button class="btn-secondaire" data-action="email" data-id="${v.id}" ${ticketPossible ? '' : 'disabled'}>${v.ticket_email ? 'Renvoyer' : 'Envoyer'} par e-mail</button>
    </div>
    ${v.mode_paiement === 'qr' || v.mode_paiement === 'liquide' ? `
      <button class="btn-secondaire large" data-action="mode" data-id="${v.id}">Corriger : payé ${v.mode_paiement === 'qr' ? 'en liquide' : 'par virement'}</button>` : ''}
    ${v.statut === 'en_attente' ? `<button class="btn-secondaire large" data-action="payee" data-id="${v.id}">Marquer comme facturée dans Smart</button>` : ''}
    ${v.canal !== 'magasin' ? `
      <div class="endroit">
        <div class="ligne-saisie">
          <select data-role="canal" aria-label="Endroit">
            ${Object.entries(CANAUX).filter(([cle]) => cle !== 'magasin').map(([cle, nom]) => `<option value="${cle}" ${cle === v.canal ? 'selected' : ''}>${nom}</option>`).join('')}
          </select>
          ${champLieu(v.lieu || '', 'data-role="lieu"')}
        </div>
        <button class="btn-secondaire large" data-action="endroit" data-id="${v.id}">Corriger l'endroit</button>
      </div>` : ''}
    <div class="ligne-saisie">
      <select data-role="client" aria-label="Client">
        <option value="">— aucun client —</option>
        ${clients.map((c) => `<option value="${c.id}" ${c.id === v.client_id ? 'selected' : ''}>${esc(c.nom || c.email)}</option>`).join('')}
      </select>
      <button class="btn-secondaire" data-action="client" data-id="${v.id}">Associer</button>
    </div>
    <button class="btn-danger" data-action="annuler" data-id="${v.id}">Annuler cette vente</button>`;
}

function vueVentes(el, toutes) {
  const filtrees = toutes.filter((v) => !canal || v.canal === canal);
  const valides = filtrees.filter((v) => v.statut !== 'annulee');
  const total = valides.reduce((s, v) => s + v.total_cents, 0);
  const parMode = {};
  const parProduit = {};
  for (const v of valides) {
    parMode[v.mode_paiement] = (parMode[v.mode_paiement] || 0) + v.total_cents;
    for (const l of v.lignes) {
      const cle = `${l.libelle}${l.lot ? ` ${l.lot}` : ''}`;
      parProduit[cle] = (parProduit[cle] || 0) + l.quantite;
    }
  }
  const plusieursJours = periode !== 'jour' && periode !== 'hier';

  el.innerHTML = `
    ${onglets()}
    <div class="ligne-saisie">
      <select id="periode" aria-label="Période">
        ${Object.entries(PERIODES).map(([cle, nom]) => `<option value="${cle}" ${periode === cle ? 'selected' : ''}>${nom}</option>`).join('')}
      </select>
      <select id="canal" aria-label="Canal">
        <option value="">Tous les canaux</option>
        ${Object.entries(CANAUX).map(([cle, nom]) => `<option value="${cle}" ${canal === cle ? 'selected' : ''}>${nom}</option>`).join('')}
      </select>
    </div>
    <div class="tuiles">
      <div class="tuile"><div class="tuile-valeur">${valides.length}</div><div>vente(s)</div></div>
      <div class="tuile"><div class="tuile-valeur">${formatEuro(total)}</div><div>total</div></div>
      ${Object.entries(parMode).map(([mode, cents]) => `<div class="tuile"><div class="tuile-valeur">${formatEuro(cents)}</div><div>${esc(MODES[mode] || mode)}</div></div>`).join('')}
    </div>
    ${Object.keys(parProduit).length ? `
      <details class="recap">
        <summary>Par produit</summary>
        ${Object.entries(parProduit).sort((a, b) => b[1] - a[1]).map(([nom, q]) => `<div class="recap-ligne"><span>${esc(nom)}</span><span>${q}</span></div>`).join('')}
      </details>` : ''}
    <h2>Tickets</h2>
    ${filtrees.map((v) => `
      <details class="recap ${v.statut === 'annulee' ? 'annulee' : ''}">
        <summary>
          <span>${plusieursJours ? `${jour(v.date_heure)} ` : ''}${heure(v.date_heure)} · ${esc(v.numero)} · ${esc(MODES[v.mode_paiement] || v.mode_paiement)}${v.statut === 'annulee' ? ' · annulée' : v.statut === 'en_attente' ? ' · à facturer' : ''}</span>
          <strong>${formatEuro(v.total_cents)}</strong>
        </summary>
        ${v.lignes.map((l) => `<div class="recap-ligne"><span>${l.quantite} × ${esc(l.libelle)} ${esc(l.lot)}</span><span>${formatEuro(l.total_cents)}</span></div>`).join('')}
        ${v.remise_cents ? `<div class="recap-ligne"><span>Remise ${esc(v.remise_libelle)}</span><span>−${formatEuro(v.remise_cents)}</span></div>` : ''}
        <div class="recap-ligne"><span>${esc(CANAUX[v.canal] || v.canal)}${v.lieu ? ` · ${esc(v.lieu)}` : ''}</span><span>${esc(nomClient(v))}</span></div>
        ${actionsVente(v)}
      </details>`).join('') || '<p class="vide">Aucune vente sur cette période.</p>'}`;

  el.onchange = (e) => {
    if (e.target.id === 'periode') periode = e.target.value;
    else if (e.target.id === 'canal') canal = e.target.value;
    else {
      if (e.target.dataset.role === 'lieu' && e.target.tagName === 'SELECT') {
        const vente = toutes.find((x) => x.id === e.target.closest('.endroit')?.querySelector('[data-action="endroit"]')?.dataset.id);
        choisirLieu(e.target, vente?.lieu);
      }
      return;
    }
    rafraichir();
  };

  el.onclick = async (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const { action, id } = bouton.dataset;
    if (action === 'vue') { vue = bouton.dataset.vue; selection = new Set(); rafraichir(); return; }
    const v = toutes.find((x) => x.id === id);
    if (!v) return;

    if (action === 'partager') {
      const { sujet, texte } = construireTicket(v, etat.config, nomsNl());
      try {
        if (navigator.share) await navigator.share({ title: sujet, text: texte });
        else { await navigator.clipboard.writeText(texte); toast('Ticket copié'); }
      } catch (erreur) {
        if (erreur.name !== 'AbortError') toast('Partage impossible', 'erreur');
      }
    } else if (action === 'email') {
      const client = clientDe(v);
      if (!confirm(`Envoyer le ticket ${v.numero} à ${client.email} ?`)) return;
      await db.modifierVentes([{ ...v, ticket_email: client.email, ticket_a_renvoyer: true }]);
      await apresEcriture("Ticket en cours d'envoi");
    } else if (action === 'mode') {
      await db.modifierVentes([{ ...v, mode_paiement: v.mode_paiement === 'qr' ? 'liquide' : 'qr' }]);
      await apresEcriture('Mode de paiement corrigé');
    } else if (action === 'endroit') {
      const bloc = bouton.closest('.endroit');
      const nouveauCanal = bloc.querySelector('[data-role="canal"]').value;
      const nouveauLieu = bloc.querySelector('[data-role="lieu"]').value.trim();
      if (nouveauCanal === v.canal && nouveauLieu === (v.lieu || '')) { toast('Rien à corriger'); return; }
      if (v.smart_saisi_le && !confirm(`Cette vente est déjà saisie dans Smart (${v.smart_saisi_le}).\n\nPense à corriger aussi chez Smart. Continuer ?`)) return;
      await db.modifierVentes([{ ...v, canal: nouveauCanal, lieu: nouveauLieu }]);
      await apresEcriture('Endroit corrigé');
    } else if (action === 'payee') {
      await db.modifierVentes([{ ...v, statut: 'payee', smart_saisi_le: aujourdhui() }]);
      await apresEcriture('Livraison marquée comme facturée');
    } else if (action === 'client') {
      const choisi = bouton.parentElement.querySelector('[data-role="client"]').value || null;
      await db.modifierVentes([{ ...v, client_id: choisi }]);
      await apresEcriture(choisi ? 'Client associé' : 'Client retiré');
    } else if (action === 'annuler') {
      const motif = prompt(`Annuler la vente ${v.numero} (${formatEuro(v.total_cents)}) ?\n\nLe stock sera rétabli. La vente reste visible dans l'historique, marquée « annulée ».\n\nMotif (facultatif) :`, '');
      if (motif === null) return;
      const mouvements = mouvementsAnnulation(v.lignes).map((m) => db.nouveauMouvement({ ...m, vente_id: v.id, note: `annulation ${v.numero}` }));
      await db.modifierVentes([{ ...v, statut: 'annulee', annulee_le: db.maintenant(), motif_annulation: motif.trim() }], mouvements);
      await apresEcriture(`Vente ${v.numero} annulée`);
    }
  };
  el.oninput = el.onsubmit = null;
}

// ---------------------------------------------------------------------------
// Journal Smart
// ---------------------------------------------------------------------------

function telecharger(nom, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  Object.assign(document.createElement('a'), { href: url, download: nom }).click();
  URL.revokeObjectURL(url);
}

function vueSmart(el, toutes) {
  const aDeclarer = encaissements(toutes).filter((v) => Boolean(v.smart_saisi_le) === dejaSaisis);
  const groupes = regrouper(aDeclarer, regroupement);
  const livraisons = livraisonsAFacturer(toutes);
  selection = new Set([...selection].filter((cle) => groupes.some((g) => g.cle === cle)));
  const choisis = () => groupes.filter((g) => selection.has(g.cle));

  el.innerHTML = `
    ${onglets()}
    <p class="aide">Encaissements sans facturation (marchés, domicile) à ressaisir dans Smart. Coche les périodes saisies, puis marque-les.</p>
    <div class="ligne-saisie">
      <select id="regroupement" aria-label="Regroupement">
        <option value="jour" ${regroupement === 'jour' ? 'selected' : ''}>Par jour</option>
        <option value="mois" ${regroupement === 'mois' ? 'selected' : ''}>Par mois</option>
      </select>
      <select id="etat-saisie" aria-label="État">
        <option value="0" ${dejaSaisis ? '' : 'selected'}>À saisir</option>
        <option value="1" ${dejaSaisis ? 'selected' : ''}>Déjà saisis</option>
      </select>
    </div>

    ${groupes.map((g) => `
      <div class="groupe">
        <label class="case">
          <input type="checkbox" data-cle="${g.cle}" ${selection.has(g.cle) ? 'checked' : ''}>
          <span class="groupe-titre">${esc(g.libelle)}</span>
          <strong>${formatEuro(g.total_cents)}</strong>
        </label>
        <div class="ligne-prix">${g.nb} vente(s) · virement ${formatEuro(g.parMode.qr || 0)} · liquide ${formatEuro(g.parMode.liquide || 0)}</div>
        <details>
          <summary>Détail par produit</summary>
          ${Object.entries(g.parProduit).map(([nom, q]) => `<div class="recap-ligne"><span>${esc(nom)}</span><span>${q}</span></div>`).join('')}
        </details>
      </div>`).join('') || `<p class="vide">${dejaSaisis ? 'Rien de saisi pour le moment.' : 'Tout est saisi dans Smart.'}</p>`}

    ${groupes.length ? `
      <div class="barre">
        <button class="btn-secondaire" data-action="tout">Tout cocher</button>
        <button class="btn-secondaire" data-action="copier">Copier</button>
        <button class="btn-secondaire" data-action="csv">Exporter CSV</button>
      </div>
      <button class="btn-principal large" data-action="marquer">${dejaSaisis ? 'Remettre « à saisir »' : 'Marquer comme saisi dans Smart'}</button>` : ''}

    <h2>Livraisons magasin à facturer</h2>
    ${livraisons.map((v) => `
      <details class="recap">
        <summary>
          <span>${jour(v.date_heure)} · ${esc(v.numero)}${nomClient(v) ? ` · ${esc(nomClient(v))}` : ''}</span>
          <strong>${formatEuro(v.total_cents)}</strong>
        </summary>
        ${v.lignes.map((l) => `<div class="recap-ligne"><span>${l.quantite} × ${esc(l.libelle)} ${esc(l.lot)}</span><span>${formatEuro(l.total_cents)}</span></div>`).join('')}
        <button class="btn-secondaire large" data-action="facturee" data-id="${v.id}">Marquer comme facturée dans Smart</button>
      </details>`).join('') || '<p class="vide">Aucune livraison à facturer.</p>'}`;

  el.onchange = (e) => {
    if (e.target.id === 'regroupement') { regroupement = e.target.value; selection = new Set(); }
    else if (e.target.id === 'etat-saisie') { dejaSaisis = e.target.value === '1'; selection = new Set(); }
    else if (e.target.dataset.cle) {
      if (e.target.checked) selection.add(e.target.dataset.cle); else selection.delete(e.target.dataset.cle);
      return;
    } else return;
    rafraichir();
  };

  el.onclick = async (e) => {
    const bouton = e.target.closest('button[data-action]');
    if (!bouton) return;
    const { action, id } = bouton.dataset;
    if (action === 'vue') { vue = bouton.dataset.vue; rafraichir(); return; }
    if (action === 'tout') { selection = new Set(groupes.map((g) => g.cle)); rafraichir(); return; }
    if (action === 'facturee') {
      const v = toutes.find((x) => x.id === id);
      await db.modifierVentes([{ ...v, statut: 'payee', smart_saisi_le: aujourdhui() }]);
      await apresEcriture('Livraison marquée comme facturée');
      return;
    }
    const cibles = choisis().length ? choisis() : (action === 'marquer' ? [] : groupes);
    if (action === 'copier') {
      try { await navigator.clipboard.writeText(versTexte(cibles)); toast(`${cibles.length} période(s) copiée(s)`); }
      catch { toast('Copie impossible', 'erreur'); }
    } else if (action === 'csv') {
      telecharger(`smart-${aujourdhui()}.csv`, '﻿' + versCsv(cibles), 'text/csv;charset=utf-8');
      toast('CSV exporté');
    } else if (action === 'marquer') {
      if (!cibles.length) { toast('Coche au moins une période', 'erreur'); return; }
      const ids = new Set(cibles.flatMap((g) => g.ids));
      const valeur = dejaSaisis ? '' : aujourdhui();
      await db.modifierVentes(toutes.filter((v) => ids.has(v.id)).map((v) => ({ ...v, smart_saisi_le: valeur })));
      selection = new Set();
      await apresEcriture(dejaSaisis ? `${ids.size} vente(s) remise(s) à saisir` : `${ids.size} vente(s) marquée(s) comme saisie(s)`);
    }
  };
  el.oninput = el.onsubmit = null;
}

export async function rendre(el) {
  if (vue === 'smart') {
    // Le journal porte sur tout l'historique : une vente non saisie ne doit jamais disparaître.
    vueSmart(el, (await db.toutesLesVentes()).sort((a, b) => String(b.date_heure).localeCompare(String(a.date_heure))));
  } else {
    vueVentes(el, await db.ventesEntre(...bornes()));
  }
}
