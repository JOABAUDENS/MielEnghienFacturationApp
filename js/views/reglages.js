// Réglages : coordonnées bancaires, consigne, préfixe de ticket, sauvegarde.
import { etat, esc, rafraichir, toast, VERSION_APP } from '../etat.js';
import { ibanValide, normaliserIban, formaterIban } from '../epc.js';
import { toCents, centsToInput } from '../money.js';
import * as db from '../db.js';

export async function rendre(el) {
  const c = etat.config;
  const persistant = await navigator.storage?.persisted?.().catch(() => false);
  const nbVentes = await db.nombreVentes();

  el.innerHTML = `
    <form id="form-reglages" class="formulaire">
      <h2>Paiement par virement</h2>
      <label>Nom du bénéficiaire <input name="beneficiaire" type="text" value="${esc(c.beneficiaire)}" autocomplete="off"></label>
      <label>IBAN <input name="iban" type="text" value="${esc(formaterIban(c.iban))}" placeholder="BE.. .... .... ...." autocomplete="off" autocapitalize="characters"></label>
      <label>BIC <input name="bic" type="text" value="${esc(c.bic)}" autocomplete="off" autocapitalize="characters"></label>

      <h2>Vente</h2>
      <label>Montant d'une consigne (€) <input name="consigne" type="text" inputmode="decimal" value="${centsToInput(c.consigne_cents)}"></label>
      <label>Préfixe des tickets de cet appareil <input name="prefixe" type="text" maxlength="2" value="${esc(c.prefixe)}" autocapitalize="characters"></label>

      <button type="submit" class="btn-principal large">Enregistrer</button>
    </form>

    <h2>Sauvegarde</h2>
    <p class="aide">Les ventes sont stockées sur ce téléphone uniquement tant que la synchronisation Google Sheet (lot 2) n'est pas en place. Exporte régulièrement une sauvegarde.</p>
    <button class="btn-secondaire large" data-action="exporter">Exporter une sauvegarde (JSON)</button>

    <h2>Réinitialiser</h2>
    <p class="aide">Efface toutes les ventes de ce téléphone (${nbVentes} enregistrée(s)) et remet la numérotation des tickets à zéro. Le catalogue et les réglages sont conservés.</p>
    <button class="btn-danger" data-action="reinitialiser" ${nbVentes ? '' : 'disabled'}>Effacer toutes les ventes</button>

    <p class="aide">
      Version ${VERSION_APP} · stockage ${persistant ? 'protégé' : 'non protégé (installe l\'application sur l\'écran d\'accueil)'}<br>
      Appareil ${esc((c.device_id || '').slice(0, 8))}
    </p>`;

  el.querySelector('#form-reglages').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const iban = normaliserIban(f.get('iban'));
    if (iban && !ibanValide(iban)) { toast('IBAN invalide : vérifie la saisie', 'erreur'); return; }
    const consigne = toCents(f.get('consigne'));
    if (consigne === null || consigne < 0) { toast('Montant de consigne invalide', 'erreur'); return; }
    const maj = {
      beneficiaire: f.get('beneficiaire').trim(),
      iban,
      bic: f.get('bic').replace(/\s+/g, '').toUpperCase(),
      consigne_cents: consigne,
      prefixe: f.get('prefixe').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'J',
    };
    await db.ecrireConfig(maj);
    Object.assign(etat.config, maj);
    toast('Réglages enregistrés');
    rafraichir();
  };

  el.onclick = async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'reinitialiser') {
      const message = `Effacer définitivement ${nbVentes} vente(s) de ce téléphone ?\n\nCette action est irréversible. Exporte d'abord une sauvegarde si tu veux en garder une trace.`;
      if (!confirm(message)) return;
      await db.effacerVentes();
      etat.config.compteur_ticket = 0;
      toast('Ventes effacées');
      rafraichir();
      return;
    }
    if (action !== 'exporter') return;
    const donnees = await db.exporterTout();
    const url = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
    const lien = Object.assign(document.createElement('a'), { href: url, download: `miel-enghien-${new Date().toISOString().slice(0, 10)}.json` });
    lien.click();
    URL.revokeObjectURL(url);
    toast('Sauvegarde exportée');
  };
  el.oninput = el.onchange = null;
}
