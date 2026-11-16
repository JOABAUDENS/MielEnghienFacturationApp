// Démarrage de l'application, navigation par onglets, service worker.
import { etat, definirRendu, rafraichir, toast } from './etat.js';
import * as db from './db.js';
import * as sync from './sync.js';
import * as vente from './views/vente.js';
import * as paiement from './views/paiement.js';
import * as ventes from './views/ventes.js';
import * as catalogue from './views/catalogue.js';
import * as reglages from './views/reglages.js';

const ONGLETS = { vente, ventes, catalogue, reglages };
const vue = document.getElementById('vue');
const nav = document.getElementById('onglets');

async function rendre() {
  const enPaiement = Boolean(etat.paiement);
  document.body.classList.toggle('en-paiement', enPaiement);
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === etat.onglet));
  try {
    await (enPaiement ? paiement : ONGLETS[etat.onglet]).rendre(vue);
  } catch (erreur) {
    console.error(erreur);
    toast(`Erreur d'affichage : ${erreur.message}`, 'erreur');
  }
}

nav.onclick = (e) => {
  const bouton = e.target.closest('button[data-onglet]');
  if (!bouton) return;
  etat.onglet = bouton.dataset.onglet;
  etat.edition = null;
  window.scrollTo(0, 0);
  rafraichir();
};

// Pastille de synchro dans l'en-tête : un coup d'œil suffit, un appui ouvre les Réglages.
const pastille = document.getElementById('pastille');
function afficherStatutSync() {
  const { icone, texte } = sync.decrire();
  pastille.hidden = !icone;
  pastille.textContent = icone;
  pastille.title = texte;
  pastille.classList.toggle('erreur', Boolean(sync.statut.erreur) && !sync.statut.enCours);
  const detail = document.getElementById('sync-etat');
  if (detail) detail.textContent = texte;
}
pastille.onclick = () => {
  if (etat.paiement) return;
  etat.onglet = 'reglages';
  etat.edition = null;
  rafraichir();
};

function installerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const bandeau = document.getElementById('maj');
  const proposer = (sw) => {
    bandeau.hidden = false;
    bandeau.querySelector('button').onclick = () => sw.postMessage('activer');
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) proposer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nouveau = reg.installing;
      nouveau?.addEventListener('statechange', () => {
        // Une nouvelle version est prête : on propose, on ne recharge jamais en pleine vente.
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) proposer(nouveau);
      });
    });
  }).catch((erreur) => console.warn('Service worker non installé', erreur));
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recharge) return;
    recharge = true;
    location.reload();
  });
}

async function demarrer() {
  definirRendu(rendre);
  try {
    etat.config = await db.initialiser();
    etat.produits = await db.produits();
  } catch (erreur) {
    console.error(erreur);
    vue.innerHTML = `<p class="alerte">Impossible d'ouvrir le stockage local : ${erreur.message}</p>`;
    return;
  }
  await rendre();
  sync.surChangement(afficherStatutSync);
  sync.demarrer();
  installerServiceWorker();
}

demarrer();
