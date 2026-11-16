# Mise en place de la synchronisation Google Sheet

À faire une seule fois, sur un ordinateur. Compte 10 minutes.

## 1. Créer le Google Sheet

1. Ouvre https://sheets.new : un nouveau classeur vide se crée.
2. Nomme-le, par exemple « Miel d'Enghien — Caisse ».

Ce classeur est privé : ne le partage pas, il contiendra tes ventes.

## 2. Installer le script

1. Dans le classeur : menu **Extensions → Apps Script**.
2. Supprime le contenu du fichier `Code.gs` affiché, et colle à la place tout le contenu de
   [`backend/Code.gs`](../backend/Code.gs).
3. Clique sur 💾 (Enregistrer).
4. Reviens sur le classeur et **recharge la page**. Un menu **🐝 Miel** apparaît.
5. Menu **🐝 Miel → Initialiser les onglets**. Google demande une autorisation la première
   fois : choisis ton compte, puis « Paramètres avancés » → « Accéder à … (non sécurisé) » →
   « Autoriser ». C'est ton propre script : l'avertissement est normal.
6. Relance **🐝 Miel → Initialiser les onglets** si rien ne s'est passé après l'autorisation.
   Quatre onglets sont créés (`Produits`, `Ventes`, `LignesVente`, `MouvementsStock`) et une
   fenêtre affiche le **secret**. Copie-le.

Le secret peut être réaffiché à tout moment : **🐝 Miel → Afficher le secret**.

## 3. Publier le script

1. Dans l'éditeur Apps Script : **Déployer → Nouveau déploiement**.
2. Roue dentée ⚙️ à côté de « Sélectionner le type » → **Application Web**.
3. Exécuter en tant que : **Moi**. Qui a accès : **Tout le monde**.
   (L'adresse est publique, mais sans le secret le script refuse tout.)
4. **Déployer**, puis copie l'**URL de l'application Web** (elle finit par `/exec`).

## 4. Configurer l'application

Sur le téléphone : **Réglages → Synchronisation Google Sheet**.

1. Colle l'URL du script et le secret, puis **Enregistrer**.
2. La pastille en haut à droite passe à ✓ après quelques secondes, et le catalogue apparaît
   dans l'onglet `Produits` du classeur.

Pour un second téléphone : installe l'application, choisis un **préfixe de ticket différent**
(par exemple `A`), puis saisis la même URL et le même secret. Le catalogue et l'historique
arrivent tout seuls.

## Lire la pastille

| Pastille | Signification |
|----------|---------------|
| ✓ | Tout est envoyé |
| ⏳ 3 | 3 écritures attendent le réseau ; elles partiront toutes seules |
| ⚠ 3 | Dernier envoi en échec ; nouvel essai automatique. Détail dans Réglages |
| ↻ | Synchronisation en cours |

Une vente est toujours enregistrée sur le téléphone d'abord : la pastille ne bloque jamais la caisse.

## Mettre à jour le script

À faire quand une nouvelle version de l'application le demande (nouvel onglet, envoi de tickets…).

1. Dans le classeur : **Extensions → Apps Script**. Remplace tout le code par le nouveau
   contenu de [`backend/Code.gs`](../backend/Code.gs), puis 💾.
2. Reviens sur le classeur, recharge la page, puis **🐝 Miel → Initialiser les onglets**.
   Si le script a besoin d'une nouvelle permission (par exemple envoyer des e-mails pour les
   tickets), Google la demande à ce moment-là : accepte-la, puis relance le menu une fois.
3. Dans l'éditeur : **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version →
   Déployer**. L'URL ne change pas. (Un « Nouveau déploiement » créerait une autre URL.)

Si la pastille de l'application affiche ⚠ avec « Réponse illisible », c'est le plus souvent
que l'étape 2 (permission) ou l'étape 3 (nouvelle version) a été oubliée.

## Tickets par e-mail

Les tickets partent de **ton adresse Gmail**, avec « Miel d'Enghien » comme nom d'expéditeur,
et se retrouvent dans tes messages envoyés. Google limite un compte gratuit à environ
100 e-mails par jour. Dans l'application, l'envoi n'est proposé que si le vendeur est
renseigné dans **Réglages → Ticket de caisse** et si le client a une adresse e-mail.

## Bon à savoir

- **Montants en centimes** dans le classeur (`1000` = 10,00 €) : divise par 100 dans tes analyses.
- **Modifier le catalogue depuis le classeur** : dans l'onglet `Produits`, change une cellule
  (nom, lot, prix…) ; le script horodate la ligne et les téléphones la reçoivent à leur
  prochaine synchro (ouverture de l'appli, retour au premier plan, ou après une vente).
  Les prix sont en centimes ; `actif` et `archive` valent `TRUE` ou `FALSE`. Pour ajouter un
  produit, remplis une nouvelle ligne en laissant `id` vide : il est créé tout seul. Ne supprime
  pas de ligne : mets `archive` à `TRUE`.
- **Ne modifie pas à la main** les onglets `Ventes`, `LignesVente` et `MouvementsStock`.
  L'onglet `LignesVente` (une ligne par produit vendu) est le bon point de départ pour les statistiques.
- **Modifier un client depuis le classeur** : l'onglet `Clients` fonctionne comme `Produits`
  (nom, e-mail, téléphone, langue `fr` ou `nl`, note). Pour retirer une fiche, utilise plutôt
  « Supprimer cette fiche » dans l'application.
- **Téléphone neuf ou réinstallation** : saisis l'URL et le secret, puis **Tout rapatrier**.
- **Changer le secret** : éditeur Apps Script → ⚙️ Paramètres du projet → Propriétés du
  script → `SECRET`, puis ressaisis-le dans chaque téléphone.
- Les coordonnées bancaires ne sont pas synchronisées : elles se saisissent sur chaque téléphone.
