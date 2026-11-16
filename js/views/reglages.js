// Réglages : coordonnées bancaires, consigne, préfixe de ticket, synchronisation, sauvegarde.
import { etat, esc, rafraichir, toast, VERSION_APP } from '../etat.js';
import { ibanValide, normaliserIban, formaterIban } from '../epc.js';
import { toCents, centsToInput } from '../money.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

export async function rendre(el) {
  const c = etat.config;
  const persistant = await navigator.storage?.persisted?.().catch(() => false);
  const nbVentes = await db.nombreVentes();
  const syncOk = sync.configuree();

  el.innerHTML = `
    <form id="form-reglages" class="formulaire">
      <h2>Paiement par virement</h2>
      <label>Nom du bénéficiaire <input name="beneficiaire" type="text" value="${esc(c.beneficiaire)}" autocomplete="off"></label>
      <label>IBAN <input name="iban" type="text" value="${esc(formaterIban(c.iban))}" placeholder="BE.. .... .... ...." autocomplete="off" autocapitalize="characters"></label>
      <label>BIC <input name="bic" type="text" value="${esc(c.bic)}" autocomplete="off" autocapitalize="characters"></label>

      <h2>Vente</h2>
      <label>Montant d'une consigne (€) <input name="consigne" type="text" inputmode="decimal" value="${centsToInput(c.consigne_cents)}"></label>
      <label>Préfixe des tickets de cet appareil <input name="prefixe" type="text" maxlength="2" value="${esc(c.prefixe)}" autocapitalize="characters"></label>

      <h2>Synchronisation Google Sheet</h2>
      <label>URL du script <input name="sync_url" type="text" inputmode="url" value="${esc(c.sync_url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label>Secret <input name="sync_secret" type="text" value="${esc(c.sync_secret)}" autocomplete="off" autocapitalize="none" spellcheck="false"></label>

      <button type="submit" class="btn-principal large">Enregistrer</button>
    </form>

    <p class="sync-etat" id="sync-etat">${esc(sync.decrire().texte)}</p>
    <div class="barre">
      <button class="btn-secondaire" data-action="synchroniser" ${syncOk ? '' : 'disabled'}>Synchroniser maintenant</button>
      <button class="btn-secondaire" data-action="rapatrier" ${syncOk ? '' : 'disabled'}>Tout rapatrier</button>
    </div>
    <p class="aide">« Tout rapatrier » relit l'intégralité du Google Sheet : à utiliser sur un téléphone neuf ou après une réinstallation.</p>

    <h2>Sauvegarde</h2>
    <p class="aide">${syncOk
      ? 'Les ventes sont envoyées au Google Sheet. L\'export reste utile comme copie de secours.'
      : 'Tant que la synchronisation n\'est pas configurée, les ventes ne sont stockées que sur ce téléphone. Exporte régulièrement une sauvegarde.'}</p>
    <button class="btn-secondaire large" data-action="exporter">Exporter une sauvegarde (JSON)</button>

    <h2>Réinitialiser</h2>
    <p class="aide">Efface toutes les ventes de ce téléphone (${nbVentes} enregistrée(s)) et remet la numérotation des tickets à zéro. Le catalogue et les réglages sont conservés.${syncOk ? ' Le Google Sheet n\'est pas modifié.' : ''}</p>
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
    const url = f.get('sync_url').trim();
    if (url && !/^https?:\/\/\S+$/.test(url)) { toast('URL du script invalide', 'erreur'); return; }
    const maj = {
      beneficiaire: f.get('beneficiaire').trim(),
      iban,
      bic: f.get('bic').replace(/\s+/g, '').toUpperCase(),
      consigne_cents: consigne,
      prefixe: f.get('prefixe').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'J',
      sync_url: url,
      sync_secret: f.get('sync_secret').trim(),
    };
    // Nouvelle adresse = nouveau Sheet possible : on repart d'une lecture complète.
    if (maj.sync_url !== c.sync_url) Object.assign(maj, { sync_cursor: '', sync_initialisee: false });
    await db.ecrireConfig(maj);
    Object.assign(etat.config, maj);
    toast('Réglages enregistrés');
    rafraichir();
    sync.apresEcriture();
  };

  el.onclick = async (e) => {
    const bouton = e.target.closest('[data-action]');
    const action = bouton?.dataset.action;
    if (action === 'synchroniser' || action === 'rapatrier') {
      bouton.disabled = true;
      const ok = await sync.synchroniser({ complet: action === 'rapatrier' });
      toast(ok ? 'Synchronisation réussie' : `Échec : ${sync.statut.erreur}`, ok ? 'ok' : 'erreur');
      rafraichir();
      return;
    }
    if (action === 'reinitialiser') {
      const message = `Effacer définitivement ${nbVentes} vente(s) de ce téléphone ?\n\nCette action est irréversible. Exporte d'abord une sauvegarde si tu veux en garder une trace.`;
      if (!confirm(message)) return;
      await db.effacerVentes();
      etat.config.compteur_ticket = 0;
      await sync.actualiserCompteur();
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
