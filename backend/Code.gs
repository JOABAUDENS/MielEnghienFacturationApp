/**
 * Miel d'Enghien — service de synchronisation (Google Apps Script lié au Google Sheet).
 *
 * Installation et mise à jour : voir docs/DEPLOIEMENT.md.
 * L'application envoie ses écritures (ops) et reçoit en retour les lignes modifiées par
 * les autres appareils depuis sa dernière synchro (changes). Le script envoie aussi les
 * tickets de caisse par e-mail.
 *
 * Après toute modification de ce fichier : Déployer → Gérer les déploiements → ✏️ →
 * Version : « Nouvelle version » → Déployer (l'URL reste la même).
 */

/**
 * Colonnes de chaque onglet, dans l'ordre. `synced_at` est rempli par ce script.
 * Une nouvelle colonne s'ajoute toujours À LA FIN d'un onglet, jamais au milieu.
 */
const TABLES = {
  Produits: ['id', 'categorie', 'nom_fr', 'nom_nl', 'lot', 'format', 'prix_cents', 'prix_magasin_cents',
    'consigne', 'date_recolte', 'actif', 'archive', 'ordre', 'seuil_alerte', 'updated_at', 'device_id', 'synced_at'],
  Ventes: ['id', 'numero', 'date_heure', 'canal', 'lieu', 'client_id', 'mode_paiement', 'sous_total_cents',
    'remise_cents', 'remise_libelle', 'total_cents', 'statut', 'langue', 'note', 'updated_at', 'device_id', 'synced_at',
    'ticket_email', 'ticket_envoye_le'],
  LignesVente: ['id', 'vente_id', 'produit_id', 'libelle', 'lot', 'quantite', 'prix_unitaire_cents',
    'total_cents', 'device_id', 'synced_at'],
  MouvementsStock: ['id', 'date_heure', 'produit_id', 'delta', 'motif', 'vente_id', 'note', 'device_id', 'synced_at'],
  Clients: ['id', 'type', 'nom', 'email', 'telephone', 'langue', 'consentement_contact', 'consentement_le',
    'note', 'fusionne_dans', 'supprime', 'updated_at', 'device_id', 'synced_at'],
};

/** Colonnes numériques ou booléennes ; toutes les autres sont forcées en texte brut. */
const NON_TEXTE = ['prix_cents', 'prix_magasin_cents', 'consigne', 'actif', 'archive', 'ordre', 'seuil_alerte',
  'sous_total_cents', 'remise_cents', 'total_cents', 'quantite', 'prix_unitaire_cents', 'delta',
  'consentement_contact', 'supprime'];

/** Onglets dont une modification manuelle doit redescendre vers les téléphones. */
const MODIFIABLES_A_LA_MAIN = ['Produits', 'Clients'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🐝 Miel')
    .addItem('Initialiser les onglets', 'setup')
    .addItem('Afficher le secret', 'afficherSecret')
    .addToUi();
}

/**
 * Déclenché par Google à chaque modification MANUELLE du classeur.
 * Dans les onglets Produits et Clients, la ligne modifiée est horodatée pour que les
 * téléphones la récupèrent à leur prochaine synchro. Une ligne ajoutée à la main reçoit un
 * identifiant. (Les écritures faites par l'application ne passent pas par ici.)
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const feuille = e.range.getSheet();
  const colonnes = TABLES[feuille.getName()];
  if (!colonnes || MODIFIABLES_A_LA_MAIN.indexOf(feuille.getName()) === -1) return;
  const premiere = Math.max(2, e.range.getRow());
  const derniere = e.range.getLastRow();
  if (derniere < premiere) return;

  const instant = new Date().toISOString();
  const iId = colonnes.indexOf('id');
  const iMaj = colonnes.indexOf('updated_at'); // updated_at, device_id, synced_at se suivent
  const lignes = feuille.getRange(premiere, 1, derniere - premiere + 1, colonnes.length).getValues();
  lignes.forEach(function (ligne, i) {
    const vide = ligne.slice(1, iMaj).every(function (v) { return v === ''; });
    if (vide) return; // ligne effacée ou encore vide : on n'y touche pas
    const numero = premiere + i;
    if (!ligne[iId]) feuille.getRange(numero, iId + 1).setValue(Utilities.getUuid());
    feuille.getRange(numero, iMaj + 1, 1, 3).setValues([[instant, 'sheet', instant]]);
  });
}

/**
 * Crée les onglets manquants et complète les en-têtes (nouvelles colonnes en fin d'onglet).
 * Sans effet si tout est déjà en place.
 */
function preparerOnglets(classeur) {
  Object.keys(TABLES).forEach(function (nom) {
    const colonnes = TABLES[nom];
    let feuille = classeur.getSheetByName(nom);
    if (feuille && feuille.getLastColumn() >= colonnes.length
        && String(feuille.getRange(1, colonnes.length).getValue()) === colonnes[colonnes.length - 1]) {
      return; // déjà à jour
    }
    feuille = feuille || classeur.insertSheet(nom);
    if (feuille.getMaxColumns() < colonnes.length) {
      feuille.insertColumnsAfter(feuille.getMaxColumns(), colonnes.length - feuille.getMaxColumns());
    }
    feuille.getRange(1, 1, 1, colonnes.length).setValues([colonnes]).setFontWeight('bold');
    feuille.setFrozenRows(1);
    colonnes.forEach(function (colonne, i) {
      if (NON_TEXTE.indexOf(colonne) === -1) {
        // Texte brut : empêche Sheets de transformer une date ISO ou un lot en autre chose.
        feuille.getRange(1, i + 1, feuille.getMaxRows(), 1).setNumberFormat('@');
      }
    });
  });
}

/** Crée les onglets, les en-têtes et le secret. Peut être relancé sans risque. */
function setup() {
  preparerOnglets(SpreadsheetApp.getActiveSpreadsheet());
  // Fait apparaître la demande d'autorisation d'envoi d'e-mails (tickets de caisse).
  MailApp.getRemainingDailyQuota();
  const proprietes = PropertiesService.getScriptProperties();
  if (!proprietes.getProperty('SECRET')) {
    proprietes.setProperty('SECRET', Utilities.getUuid().replace(/-/g, ''));
  }
  afficherSecret();
}

function afficherSecret() {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  SpreadsheetApp.getUi().alert(secret
    ? 'Secret à saisir dans Réglages de l\'application :\n\n' + secret
    : 'Aucun secret : lance d\'abord « Initialiser les onglets ».');
}

function doGet() {
  return ContentService.createTextOutput('Miel d\'Enghien : service de synchronisation actif.');
}

function doPost(e) {
  let reponse;
  try {
    reponse = traiter(JSON.parse(e.postData.contents));
  } catch (erreur) {
    reponse = { ok: false, error: String((erreur && erreur.message) || erreur) };
  }
  return ContentService.createTextOutput(JSON.stringify(reponse)).setMimeType(ContentService.MimeType.JSON);
}

/** Envoie le ticket joint à une vente. Lève une erreur si l'envoi échoue. */
function envoyerTicket(row) {
  const destinataire = String(row.ticket_email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) throw new Error('adresse e-mail invalide');
  MailApp.sendEmail({
    to: destinataire,
    subject: String(row.ticket_sujet || 'Votre ticket Miel d\'Enghien'),
    body: String(row.ticket_texte || ''),
    htmlBody: String(row.ticket_html),
    name: 'Miel d\'Enghien',
  });
}

/**
 * @param {{secret: string, device_id: string, cursor?: string, full?: boolean,
 *          ops?: Array<{table: string, row: Object}>}} requete
 */
function traiter(requete) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || requete.secret !== secret) throw new Error('Secret invalide');
  if (!requete.device_id) throw new Error('device_id manquant');

  const verrou = LockService.getScriptLock();
  verrou.waitLock(25000); // une seule synchro à la fois
  try {
    const classeur = SpreadsheetApp.getActiveSpreadsheet();
    preparerOnglets(classeur);
    const instant = new Date().toISOString();
    const parTable = {};
    (requete.ops || []).forEach(function (op) {
      if (!TABLES[op.table]) throw new Error('Onglet inconnu : ' + op.table + ' (mets le script à jour)');
      if (!op.row || !op.row.id) throw new Error('Ligne sans id dans ' + op.table);
      (parTable[op.table] = parTable[op.table] || []).push(op.row);
    });

    const changements = {};
    const tickets = [];
    const erreursTicket = [];
    Object.keys(TABLES).forEach(function (nom) {
      const colonnes = TABLES[nom];
      const feuille = classeur.getSheetByName(nom);
      const nbLignes = feuille.getLastRow();
      const donnees = nbLignes > 1 ? feuille.getRange(2, 1, nbLignes - 1, colonnes.length).getValues() : [];

      // Écritures : mise à jour si l'id existe déjà, ajout sinon (idempotent).
      const index = {};
      donnees.forEach(function (ligne, i) { index[ligne[0]] = i; });
      const nbExistantes = donnees.length;
      const iEnvoye = colonnes.indexOf('ticket_envoye_le');
      (parTable[nom] || []).forEach(function (row) {
        const valeurs = colonnes.map(function (c) {
          if (c === 'synced_at') return instant;
          const v = row[c];
          return v === undefined || v === null ? '' : v;
        });
        const id = String(row.id);
        const existe = index[id] !== undefined;

        if (nom === 'Ventes') {
          // Un ticket déjà envoyé le reste, même si le téléphone ne le sait pas encore.
          if (existe && !valeurs[iEnvoye]) valeurs[iEnvoye] = donnees[index[id]][iEnvoye];
          if (row.ticket_email && row.ticket_html && !valeurs[iEnvoye]) {
            try {
              envoyerTicket(row);
              valeurs[iEnvoye] = instant;
              tickets.push({ vente_id: id, envoye_le: instant });
            } catch (erreur) {
              erreursTicket.push((row.numero || id) + ' : ' + String((erreur && erreur.message) || erreur));
            }
          }
        }

        if (existe) {
          donnees[index[id]] = valeurs;
          // Ligne déjà dans la feuille : réécrite sur place. Sinon elle part avec les ajouts.
          if (index[id] < nbExistantes) feuille.getRange(index[id] + 2, 1, 1, colonnes.length).setValues([valeurs]);
        } else {
          index[id] = donnees.length;
          donnees.push(valeurs);
        }
      });
      const ajouts = donnees.slice(nbExistantes);
      if (ajouts.length) {
        const premiere = nbLignes + 1;
        const manque = premiere + ajouts.length - 1 - feuille.getMaxRows();
        if (manque > 0) feuille.insertRowsAfter(feuille.getMaxRows(), manque);
        feuille.getRange(premiere, 1, ajouts.length, colonnes.length).setValues(ajouts);
      }

      // Lectures : ce qui a changé depuis le curseur, hors écritures de l'appareil demandeur.
      const iSync = colonnes.indexOf('synced_at');
      const iDevice = colonnes.indexOf('device_id');
      changements[nom] = donnees.filter(function (ligne) {
        if (requete.full) return true;
        if (String(ligne[iDevice]) === requete.device_id) return false;
        return !requete.cursor || String(ligne[iSync]) > requete.cursor;
      }).map(function (ligne) {
        const objet = {};
        colonnes.forEach(function (c, i) {
          objet[c] = ligne[i] instanceof Date ? ligne[i].toISOString() : ligne[i];
        });
        return objet;
      });
    });

    return { ok: true, cursor: instant, changes: changements, tickets: tickets, erreurs_ticket: erreursTicket };
  } finally {
    verrou.releaseLock();
  }
}
