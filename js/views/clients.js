// Onglet Clients : liste triable, recherche, fiche avec historique d'achats, fusion, suppression.
import { etat, esc, rafraichir, toast, MODES } from '../etat.js';
import { visibles, rechercher, trouverDoublons, emailValide, normaliser } from '../clients.js';
import { rechargerClients } from '../chargement.js';
import { formatEuro } from '../money.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

let tri = 'dernier';
let filtre = '';

const TRIS = { dernier: 'Dernier achat', total: 'Total dépensé', nb: "Nombre d'achats", nom: 'Nom' };
const dateCourte = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');

async function apresEcriture(message) {
  await rechargerClients();
  sync.apresEcriture();
  if (message) toast(message);
  rafraichir();
}

function clientVierge() {
  return {
    id: crypto.randomUUID(), type: 'particulier', nom: '', email: '', telephone: '', langue: 'fr',
    consentement_contact: false, consentement_le: '', note: '', fusionne_dans: '', supprime: false, nouveau: true,
  };
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

function lignesHtml() {
  const stats = etat.statsClients;
  const s = (c) => stats[c.id] || { nb: 0, total_cents: 0, dernier: '' };
  const base = filtre.trim().length >= 2 ? rechercher(etat.clients, filtre, stats, 500) : visibles(etat.clients);
  const comparateurs = {
    dernier: (a, b) => s(b).dernier.localeCompare(s(a).dernier),
    total: (a, b) => s(b).total_cents - s(a).total_cents,
    nb: (a, b) => s(b).nb - s(a).nb,
    nom: (a, b) => normaliser(a.nom || a.email).localeCompare(normaliser(b.nom || b.email)),
  };
  const liste = [...base].sort(comparateurs[tri]);
  return liste.map((c) => `
    <button class="ligne lien-ligne" data-action="fiche" data-id="${c.id}">
      <div class="ligne-info">
        <div class="ligne-nom">${esc(c.nom || c.email)}${c.type === 'magasin' ? ' <span class="lot">magasin</span>' : ''}</div>
        <div class="ligne-prix">${s(c).nb ? `${s(c).nb} achat(s) · dernier le ${dateCourte(s(c).dernier)}` : 'aucun achat'}</div>
      </div>
      <strong>${s(c).nb ? formatEuro(s(c).total_cents) : ''}</strong>
    </button>`).join('') || '<p class="vide">Aucun client.</p>';
}

function liste(el) {
  el.innerHTML = `
    <div class="barre">
      <button class="btn-principal" data-action="nouveau">+ Nouveau client</button>
    </div>
    <div class="ligne-saisie">
      <input id="filtre" type="text" placeholder="Rechercher un nom ou un e-mail" value="${esc(filtre)}" autocomplete="off" autocapitalize="none" spellcheck="false">
      <select id="tri" aria-label="Trier par" class="court">
        ${Object.entries(TRIS).map(([cle, nom]) => `<option value="${cle}" ${tri === cle ? 'selected' : ''}>${nom}</option>`).join('')}
      </select>
    </div>
    <div id="liste-clients">${lignesHtml()}</div>`;

  el.oninput = (e) => {
    if (e.target.id !== 'filtre') return;
    filtre = e.target.value;
    el.querySelector('#liste-clients').innerHTML = lignesHtml();
  };
  el.onchange = (e) => {
    if (e.target.id !== 'tri') return;
    tri = e.target.value;
    el.querySelector('#liste-clients').innerHTML = lignesHtml();
  };
  el.onclick = (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    if (bouton.dataset.action === 'nouveau') etat.edition = { mode: 'client', client: clientVierge() };
    else if (bouton.dataset.action === 'fiche') etat.edition = { mode: 'client', client: { ...etat.clients.find((c) => c.id === bouton.dataset.id) } };
    window.scrollTo(0, 0);
    rafraichir();
  };
  el.onsubmit = null;
}

// ---------------------------------------------------------------------------
// Fiche
// ---------------------------------------------------------------------------

async function fiche(el) {
  const c = etat.edition.client;
  const stats = etat.statsClients[c.id];
  const achats = c.nouveau ? [] : (await db.toutesLesVentes())
    .filter((v) => v.client_id === c.id)
    .sort((a, b) => String(b.date_heure).localeCompare(String(a.date_heure)));
  const autres = visibles(etat.clients).filter((x) => x.id !== c.id)
    .sort((a, b) => normaliser(a.nom || a.email).localeCompare(normaliser(b.nom || b.email)));

  el.innerHTML = `
    <button class="btn-discret" data-action="retour">← Clients</button>
    <h2>${c.nouveau ? 'Nouveau client' : 'Fiche client'}</h2>
    ${stats ? `
      <div class="tuiles">
        <div class="tuile"><div class="tuile-valeur">${stats.nb}</div><div>achat(s)</div></div>
        <div class="tuile"><div class="tuile-valeur">${formatEuro(stats.total_cents)}</div><div>total dépensé</div></div>
      </div>` : ''}
    <form id="form-fiche" class="formulaire">
      <label>Nom <input name="nom" type="text" value="${esc(c.nom)}" autocomplete="off"></label>
      <label>E-mail <input name="email" type="text" inputmode="email" value="${esc(c.email)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label>Téléphone <input name="telephone" type="text" inputmode="tel" value="${esc(c.telephone)}" autocomplete="off"></label>
      <label>Type
        <select name="type">
          <option value="particulier" ${c.type !== 'magasin' ? 'selected' : ''}>Particulier</option>
          <option value="magasin" ${c.type === 'magasin' ? 'selected' : ''}>Magasin</option>
        </select>
      </label>
      <label>Langue
        <select name="langue">
          <option value="fr" ${c.langue !== 'nl' ? 'selected' : ''}>Français</option>
          <option value="nl" ${c.langue === 'nl' ? 'selected' : ''}>Nederlands</option>
        </select>
      </label>
      <label class="case"><input name="consentement" type="checkbox" ${c.consentement_contact ? 'checked' : ''}> Accepte d'être recontacté${c.consentement_le ? ` (depuis le ${dateCourte(c.consentement_le)})` : ''}</label>
      <label>Note <input name="note" type="text" value="${esc(c.note)}" autocomplete="off"></label>
      <button type="submit" class="btn-principal large">Enregistrer</button>
    </form>

    ${c.nouveau ? '' : `
      <h2>Achats</h2>
      ${achats.map((v) => `
        <details class="recap">
          <summary>
            <span>${dateCourte(v.date_heure)} · ${esc(v.numero)} · ${esc(MODES[v.mode_paiement] || v.mode_paiement)}${v.statut === 'annulee' ? ' · annulée' : ''}</span>
            <strong>${formatEuro(v.total_cents)}</strong>
          </summary>
          ${(v.lignes || []).map((l) => `<div class="recap-ligne"><span>${l.quantite} × ${esc(l.libelle)} ${esc(l.lot)}</span><span>${formatEuro(l.total_cents)}</span></div>`).join('')}
        </details>`).join('') || '<p class="vide">Aucun achat.</p>'}

      ${autres.length ? `
        <h2>Doublon ?</h2>
        <p class="aide">Si cette fiche et une autre désignent la même personne, fusionne-les : les achats de cette fiche seront rattachés à l'autre, et cette fiche disparaîtra.</p>
        <div class="ligne-saisie">
          <select id="cible-fusion" aria-label="Fiche à conserver">
            <option value="">— fiche à conserver —</option>
            ${autres.map((x) => `<option value="${x.id}">${esc(x.nom || x.email)}${x.nom && x.email ? ` (${esc(x.email)})` : ''}</option>`).join('')}
          </select>
          <button class="btn-secondaire" data-action="fusionner">Fusionner</button>
        </div>` : ''}

      <button class="btn-danger" data-action="supprimer">Supprimer cette fiche</button>
      <p class="aide">La suppression efface le nom, l'e-mail, le téléphone et la note. Les ventes restent dans l'historique, sans nom.</p>`}`;

  el.onsubmit = async (e) => {
    if (e.target.id !== 'form-fiche') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const email = f.get('email').trim().toLowerCase();
    const nom = f.get('nom').trim();
    if (!nom && !email) { toast('Saisis un nom ou un e-mail', 'erreur'); return; }
    if (email && !emailValide(email)) { toast('E-mail invalide', 'erreur'); return; }
    const { parEmail, parNom } = trouverDoublons(etat.clients, { id: c.id, nom, email });
    if (parEmail) { toast(`Cet e-mail est déjà celui de ${parEmail.nom || 'une autre fiche'}`, 'erreur'); return; }
    const consentement = f.get('consentement') === 'on';
    const { nouveau, ...client } = c;
    Object.assign(client, {
      nom,
      email,
      telephone: f.get('telephone').trim(),
      type: f.get('type'),
      langue: f.get('langue'),
      note: f.get('note').trim(),
      consentement_contact: consentement,
      consentement_le: consentement ? (c.consentement_contact && c.consentement_le ? c.consentement_le : db.maintenant()) : '',
    });
    await db.enregistrerClient(client);
    etat.edition = null;
    await apresEcriture(parNom.length ? `Enregistré — attention, une fiche proche existe : ${parNom[0].nom}` : 'Client enregistré');
  };

  el.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'retour') { etat.edition = null; rafraichir(); return; }
    if (action === 'fusionner') {
      const cibleId = el.querySelector('#cible-fusion').value;
      const cible = etat.clients.find((x) => x.id === cibleId);
      if (!cible) { toast('Choisis la fiche à conserver', 'erreur'); return; }
      if (!confirm(`Fusionner « ${c.nom || c.email} » dans « ${cible.nom || cible.email} » ?\n\n${achats.length} achat(s) seront rattachés à « ${cible.nom || cible.email} ». Cette action est irréversible.`)) return;
      await db.fusionnerClients(c.id, cible.id);
      etat.edition = { mode: 'client', client: { ...cible } };
      await apresEcriture('Fiches fusionnées');
      return;
    }
    if (action === 'supprimer') {
      if (!confirm(`Supprimer la fiche de « ${c.nom || c.email} » ?\n\nSes coordonnées seront effacées définitivement. Ses achats restent dans l'historique, sans nom.`)) return;
      const { nouveau, ...client } = c;
      await db.enregistrerClient({
        ...client, nom: '', email: '', telephone: '', note: '', consentement_contact: false, consentement_le: '', supprime: true,
      });
      etat.edition = null;
      await apresEcriture('Fiche supprimée');
    }
  };
  el.oninput = el.onchange = null;
}

export async function rendre(el) {
  if (etat.edition?.mode === 'client') await fiche(el);
  else liste(el);
}
