// Rechargement en mémoire des données dérivées de la base locale.
import { etat } from './etat.js';
import { statsClients } from './clients.js';
import * as db from './db.js';

/** Clients et leurs statistiques d'achat (à appeler après une vente ou une modification de fiche). */
export async function rechargerClients() {
  etat.clients = await db.clients();
  etat.statsClients = statsClients(await db.toutesLesVentes());
}
