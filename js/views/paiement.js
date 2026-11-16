// Écran de paiement : choix du mode, QR de virement avec plan B, liquide avec rendu.
/* global qrcode */
import { etat, esc, rafraichir, toast, panierVide } from '../etat.js';
import { buildEpcPayload, ibanValide, formaterIban, nettoyer } from '../epc.js';
import { mouvementsDeVente } from '../panier.js';
import { formatEuro, toCents, centsToInput } from '../money.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

let verrouEcran = null;

async function garderEcranAllume() {
  try { verrouEcran ??= await navigator.wakeLock?.request('screen'); } catch { /* non bloquant */ }
}

function relacherEcran() {
  verrouEcran?.release().catch(() => {});
  verrouEcran = null;
}

function communication() {
  return nettoyer(`MIEL ENGHIEN ${etat.paiement.numero}`, 140);
}

/** Dessine le QR sur un canvas : modules noirs sur blanc pur, marge de 4 modules. */
function dessinerQr(canvas, texte) {
  const qr = qrcode(0, 'M');
  qr.addData(texte, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const marge = 4;
  const echelle = 8;
  canvas.width = canvas.height = (n + 2 * marge) * echelle;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let l = 0; l < n; l++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(l, c)) ctx.fillRect((c + marge) * echelle, (l + marge) * echelle, echelle, echelle);
    }
  }
}

async function valider(mode) {
  const { calcul, numero } = etat.paiement;
  const date = db.maintenant();
  const venteId = crypto.randomUUID();
  const vente = {
    id: venteId,
    numero,
    date_heure: date,
    canal: etat.config.canal,
    lieu: etat.config.lieu,
    client_id: null,
    mode_paiement: mode,
    sous_total_cents: calcul.sousTotalCents,
    remise_cents: calcul.remiseCents,
    remise_libelle: calcul.remiseLibelle,
    total_cents: calcul.totalCents,
    statut: 'payee',
    langue: 'fr',
    note: '',
    lignes: calcul.lignes.map((l) => ({ id: crypto.randomUUID(), vente_id: venteId, ...l })),
    updated_at: date,
    device_id: etat.config.device_id,
  };
  const mouvements = mouvementsDeVente(calcul.lignes).map((m) => ({
    id: crypto.randomUUID(),
    date_heure: date,
    vente_id: venteId,
    note: '',
    device_id: etat.config.device_id,
    ...m,
  }));
  const compteur = (etat.config.compteur_ticket || 0) + 1;
  try {
    await db.enregistrerVente(vente, mouvements, compteur);
  } catch (erreur) {
    console.error(erreur);
    toast("Échec de l'enregistrement : la vente n'est PAS sauvegardée", 'erreur');
    return;
  }
  etat.config.compteur_ticket = compteur;
  sync.apresEcriture(); // envoi en arrière-plan : on n'attend jamais le réseau
  etat.panier = panierVide();
  etat.paiement = null;
  relacherEcran();
  toast(`Vente ${numero} enregistrée · ${formatEuro(vente.total_cents)}`);
  rafraichir();
}

function ecranChoix(total) {
  if (total < 0) {
    return `
      <p class="montant-geant">${formatEuro(-total)}</p>
      <p class="centre">À rendre au client (retour de consignes)</p>
      <button class="btn-principal large" data-action="payer" data-mode="liquide">✅ Rendu en liquide</button>`;
  }
  if (total === 0) {
    return `
      <p class="montant-geant">${formatEuro(0)}</p>
      <button class="btn-principal large" data-action="payer" data-mode="liquide">✅ Valider</button>`;
  }
  return `
    <p class="montant-geant">${formatEuro(total)}</p>
    <button class="btn-principal large" data-action="etape" data-etape="qr">📱 QR virement</button>
    <button class="btn-liquide large" data-action="etape" data-etape="liquide">💵 Liquide</button>`;
}

function ecranQr(total) {
  const { beneficiaire, iban, bic } = etat.config;
  if (!beneficiaire || !ibanValide(iban)) {
    return `
      <p class="alerte">Le bénéficiaire et un IBAN valide doivent être saisis dans Réglages avant de générer un QR.</p>
      <button class="btn-principal large" data-action="reglages">Ouvrir les Réglages</button>
      <button class="btn-liquide large" data-action="etape" data-etape="liquide">💵 Payer en liquide</button>`;
  }
  const planB = etat.paiement.planB;
  const champ = (titre, valeur, aCopier = valeur) => `
    <div class="planb-champ">
      <div><div class="planb-titre">${titre}</div><div class="planb-valeur">${esc(valeur)}</div></div>
      <button class="btn-secondaire" data-action="copier" data-texte="${esc(aCopier)}">Copier</button>
    </div>`;
  return `
    <p class="montant-geant">${formatEuro(total)}</p>
    <div class="qr-cadre"><canvas id="qr" aria-label="QR code de virement"></canvas></div>
    <p class="centre">Scannez avec votre application bancaire<br><strong>${esc(beneficiaire)}</strong></p>
    <button class="btn-discret" data-action="planb">${planB ? 'Masquer les coordonnées' : 'Ça ne marche pas ?'}</button>
    ${planB ? `
      <div class="planb">
        ${champ('Bénéficiaire', beneficiaire)}
        ${champ('IBAN', formaterIban(iban), iban)}
        ${bic ? champ('BIC', bic) : ''}
        ${champ('Montant', formatEuro(total), centsToInput(total))}
        ${champ('Communication', communication())}
      </div>` : ''}
    <button class="btn-principal large" data-action="payer" data-mode="qr">✅ Payé par virement</button>
    <button class="btn-liquide large" data-action="etape" data-etape="liquide">💵 Finalement en liquide</button>`;
}

function ecranLiquide(total) {
  return `
    <p class="montant-geant">${formatEuro(total)}</p>
    <div class="ligne-saisie">
      <label for="recu">Montant reçu</label>
      <input id="recu" type="text" inputmode="decimal" placeholder="facultatif" class="court">
    </div>
    <p class="rendu" id="rendu"></p>
    <button class="btn-principal large" data-action="payer" data-mode="liquide">✅ Payé en liquide</button>`;
}

export function rendre(el) {
  const { calcul, numero, etape } = etat.paiement;
  const total = calcul.totalCents;
  const corps = etape === 'qr' ? ecranQr(total) : etape === 'liquide' ? ecranLiquide(total) : ecranChoix(total);

  el.innerHTML = `
    <div class="paiement">
      <div class="paiement-entete">
        <button class="btn-discret" data-action="retour">← ${etape === 'choix' ? 'Panier' : 'Retour'}</button>
        <span class="numero">Ticket ${esc(numero)}</span>
      </div>
      ${corps}
      <details class="recap">
        <summary>${calcul.nbArticles} article(s) — détail</summary>
        ${calcul.lignes.map((l) => `<div class="recap-ligne"><span>${l.quantite} × ${esc(l.libelle)} ${esc(l.lot)}</span><span>${formatEuro(l.total_cents)}</span></div>`).join('')}
        ${calcul.remiseCents ? `<div class="recap-ligne"><span>Remise ${esc(calcul.remiseLibelle)}</span><span>−${formatEuro(calcul.remiseCents)}</span></div>` : ''}
      </details>
    </div>`;

  if (etape === 'qr') {
    const canvas = el.querySelector('#qr');
    if (canvas) {
      try {
        dessinerQr(canvas, buildEpcPayload({
          bic: etat.config.bic,
          nom: etat.config.beneficiaire,
          iban: etat.config.iban,
          montantCents: total,
          communication: communication(),
        }));
        garderEcranAllume();
      } catch (erreur) {
        canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'alerte', textContent: `QR impossible : ${erreur.message}` }));
      }
    }
  } else {
    relacherEcran();
  }

  el.onclick = async (e) => {
    const bouton = e.target.closest('[data-action]');
    if (!bouton) return;
    const { action } = bouton.dataset;
    if (action === 'retour') {
      if (etape === 'choix') { etat.paiement = null; relacherEcran(); }
      else { etat.paiement.etape = 'choix'; etat.paiement.planB = false; }
    } else if (action === 'etape') {
      etat.paiement.etape = bouton.dataset.etape;
    } else if (action === 'planb') {
      etat.paiement.planB = !etat.paiement.planB;
    } else if (action === 'reglages') {
      etat.paiement = null;
      etat.onglet = 'reglages';
    } else if (action === 'copier') {
      try { await navigator.clipboard.writeText(bouton.dataset.texte); toast('Copié'); }
      catch { toast('Copie impossible', 'erreur'); }
      return;
    } else if (action === 'payer') {
      bouton.disabled = true; // évite le double enregistrement
      await valider(bouton.dataset.mode);
      return;
    }
    rafraichir();
  };

  el.oninput = (e) => {
    if (e.target.id !== 'recu') return;
    const recu = toCents(e.target.value);
    const zone = el.querySelector('#rendu');
    if (recu === null || recu < total) zone.textContent = '';
    else zone.textContent = `À rendre : ${formatEuro(recu - total)}`;
  };
  el.onchange = null;
}
