// Stockage local IndexedDB : source de vérité de l'appareil.
// Magasins : produits, ventes, mouvements (journal de stock, ajout seul), config (clé/valeur).

const NOM_BASE = 'miel-enghien';
const VERSION = 1;

/** Valeurs par défaut de la configuration. Aucun IBAN ici : il se saisit dans Réglages. */
export const CONFIG_DEFAUT = {
  beneficiaire: '',
  iban: '',
  bic: '',
  consigne_cents: 50,
  prefixe: 'J',
  compteur_ticket: 0,
  device_id: '',
  canal: 'marche',
  lieu: '',
  catalogue_initialise: false,
};

/** Catalogue de départ, repris de l'ancienne page HTML (modifiable ensuite dans l'appli). */
const PRODUITS_INITIAUX = [
  { categorie: 'miel', nom_fr: 'Miel de printemps (Marcq)', lot: 'M02', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été", lot: 'M03', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été (tilleul)", lot: 'M04', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: 'Miel de printemps', lot: 'ME', prix_cents: 1000 },
  { categorie: 'miel', nom_fr: "Miel d'été", lot: 'ME', prix_cents: 1000 },
  { categorie: 'hydromel', nom_fr: 'Hydromel nature', lot: '', prix_cents: 1500 },
  { categorie: 'hydromel', nom_fr: 'Hydromel cerise', lot: '', prix_cents: 1500 },
];

let basePromise;

function ouvrir() {
  basePromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NOM_BASE, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('produits', { keyPath: 'id' });
      db.createObjectStore('ventes', { keyPath: 'id' }).createIndex('date_heure', 'date_heure');
      db.createObjectStore('mouvements', { keyPath: 'id' }).createIndex('produit_id', 'produit_id');
      db.createObjectStore('config', { keyPath: 'cle' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return basePromise;
}

const attendre = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finTransaction = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
  });

export const maintenant = () => new Date().toISOString();

export async function tout(magasin) {
  const db = await ouvrir();
  return attendre(db.transaction(magasin).objectStore(magasin).getAll());
}

export async function lireConfig() {
  const lignes = await tout('config');
  const config = { ...CONFIG_DEFAUT };
  for (const l of lignes) config[l.cle] = l.valeur;
  return config;
}

export async function ecrireConfig(partiel) {
  const db = await ouvrir();
  const tx = db.transaction('config', 'readwrite');
  for (const [cle, valeur] of Object.entries(partiel)) tx.objectStore('config').put({ cle, valeur });
  await finTransaction(tx);
}

/** Premier lancement : identifiant d'appareil + catalogue de départ. */
export async function initialiser() {
  let config = await lireConfig();
  const ajout = {};
  if (!config.device_id) ajout.device_id = crypto.randomUUID();
  if (!config.catalogue_initialise) {
    const db = await ouvrir();
    const tx = db.transaction('produits', 'readwrite');
    PRODUITS_INITIAUX.forEach((p, i) => {
      tx.objectStore('produits').put({
        id: crypto.randomUUID(),
        nom_nl: '',
        format: '',
        prix_magasin_cents: null,
        consigne: p.categorie === 'miel',
        date_recolte: '',
        actif: true,
        archive: false,
        ordre: i + 1,
        seuil_alerte: null,
        updated_at: maintenant(),
        device_id: config.device_id || ajout.device_id,
        ...p,
      });
    });
    await finTransaction(tx);
    ajout.catalogue_initialise = true;
  }
  if (Object.keys(ajout).length) {
    await ecrireConfig(ajout);
    config = { ...config, ...ajout };
  }
  // Demande au navigateur de ne jamais purger ces données (sans effet si déjà accordé).
  navigator.storage?.persist?.().catch(() => {});
  return config;
}

export async function produits() {
  return (await tout('produits')).sort((a, b) => a.ordre - b.ordre);
}

export async function enregistrerProduit(produit) {
  const db = await ouvrir();
  const tx = db.transaction('produits', 'readwrite');
  tx.objectStore('produits').put({ ...produit, updated_at: maintenant() });
  await finTransaction(tx);
}

export async function enregistrerProduits(liste) {
  const db = await ouvrir();
  const tx = db.transaction('produits', 'readwrite');
  for (const p of liste) tx.objectStore('produits').put({ ...p, updated_at: maintenant() });
  await finTransaction(tx);
}

/**
 * Valide une vente : la vente, ses mouvements de stock et le compteur de tickets sont
 * écrits dans UNE transaction — tout est enregistré, ou rien.
 */
export async function enregistrerVente(vente, mouvements, compteurTicket) {
  const db = await ouvrir();
  const tx = db.transaction(['ventes', 'mouvements', 'config'], 'readwrite');
  tx.objectStore('ventes').put(vente);
  for (const m of mouvements) tx.objectStore('mouvements').put(m);
  tx.objectStore('config').put({ cle: 'compteur_ticket', valeur: compteurTicket });
  await finTransaction(tx);
}

/** Ventes dont la date est comprise entre deux instants ISO, de la plus récente à la plus ancienne. */
export async function ventesEntre(debutIso, finIso) {
  const db = await ouvrir();
  const index = db.transaction('ventes').objectStore('ventes').index('date_heure');
  const liste = await attendre(index.getAll(IDBKeyRange.bound(debutIso, finIso)));
  return liste.reverse();
}

/** Nombre de ventes enregistrées sur l'appareil. */
export async function nombreVentes() {
  const db = await ouvrir();
  return attendre(db.transaction('ventes').objectStore('ventes').count());
}

/**
 * Efface toutes les ventes et tous les mouvements de stock, et remet le compteur de tickets
 * à zéro. Le catalogue et les réglages sont conservés. Irréversible.
 */
export async function effacerVentes() {
  const db = await ouvrir();
  const tx = db.transaction(['ventes', 'mouvements', 'config'], 'readwrite');
  tx.objectStore('ventes').clear();
  tx.objectStore('mouvements').clear();
  tx.objectStore('config').put({ cle: 'compteur_ticket', valeur: 0 });
  await finTransaction(tx);
}

/** Copie complète de la base, pour la sauvegarde manuelle. */
export async function exporterTout() {
  const [prods, ventes, mouvements, config] = await Promise.all([
    tout('produits'), tout('ventes'), tout('mouvements'), tout('config'),
  ]);
  return { format: 'miel-enghien-sauvegarde', version: VERSION, exporte_le: maintenant(), produits: prods, ventes, mouvements, config };
}
