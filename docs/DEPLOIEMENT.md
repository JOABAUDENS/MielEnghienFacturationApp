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

## Bon à savoir

- **Montants en centimes** dans le classeur (`1000` = 10,00 €) : divise par 100 dans tes analyses.
- **Ne modifie pas à la main** les onglets `Ventes`, `LignesVente` et `MouvementsStock`.
  L'onglet `LignesVente` (une ligne par produit vendu) est le bon point de départ pour les statistiques.
- **Mettre à jour le script** après une nouvelle version de `Code.gs` : colle le nouveau code,
  puis **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer**.
  L'URL ne change pas. (Un « Nouveau déploiement » créerait une autre URL.)
- **Téléphone neuf ou réinstallation** : saisis l'URL et le secret, puis **Tout rapatrier**.
- **Changer le secret** : éditeur Apps Script → ⚙️ Paramètres du projet → Propriétés du
  script → `SECRET`, puis ressaisis-le dans chaque téléphone.
- Les coordonnées bancaires ne sont pas synchronisées : elles se saisissent sur chaque téléphone.
