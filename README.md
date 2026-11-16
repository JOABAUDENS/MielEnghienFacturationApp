# Miel d'Enghien — caisse et stock

Application web installable (PWA) pour encaisser les ventes de miel : panier, QR de virement
SEPA, paiement en liquide, catalogue. Fonctionne hors ligne. La spécification complète
(`SPECIFICATION.md`) est conservée en local, hors du dépôt.

État : **lots 1 et 2** (voir §14 de la spécification). Les ventes sont enregistrées sur le
téléphone puis envoyées à un Google Sheet dès qu'il y a du réseau. Mise en place de la
synchronisation : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Lancer en local

Aucune installation ni compilation. Il faut seulement un serveur web (les modules JavaScript
ne se chargent pas en `file://`) :

```bash
python -m http.server 8765 --bind 127.0.0.1
```

- Application : http://localhost:8765/
- Tests des modules de calcul : http://localhost:8765/tests/tests.html

## Publier (GitHub Pages)

1. Pousser ce dossier dans un dépôt GitHub (les anciennes pages HTML sont exclues par `.gitignore`
   car elles contiennent l'IBAN).
2. Dépôt → Settings → Pages → « Deploy from a branch », branche `main`, dossier `/`.
3. Ouvrir l'adresse `https://<compte>.github.io/<dépôt>/` dans Chrome sur Android →
   menu ⋮ → « Installer l'application ».
4. Saisir le bénéficiaire, l'IBAN et le BIC dans Réglages (ils ne sont jamais dans le code).

À chaque nouvelle version : incrémenter `VERSION` dans `sw.js` **et** `VERSION_APP` dans
`js/etat.js`, sinon les téléphones gardent l'ancienne version en cache. Tout nouveau fichier
doit aussi être ajouté à la liste `FICHIERS` de `sw.js`.

## Organisation

| Fichier | Rôle |
|---------|------|
| `js/epc.js` | Payload du QR de virement (norme EPC069-12) |
| `js/money.js` | Montants en centimes entiers |
| `js/panier.js` | Calcul du panier, remise, mouvements de stock |
| `js/db.js` | Stockage local IndexedDB et file d'attente de synchro |
| `js/sync.js` | Envoi et réception avec le Google Sheet |
| `backend/Code.gs` | Script Google Apps Script à coller dans le Sheet |
| `js/etat.js` | État partagé et utilitaires d'interface |
| `js/views/*.js` | Un fichier par écran |
| `sw.js` | Cache hors ligne |
| `vendor/qrcode.js` | qrcode-generator 1.4.4 (Kazuhiko Arase, licence MIT) |
