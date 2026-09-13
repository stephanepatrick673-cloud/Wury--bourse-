# Wúri Bourse — Backend

Serveur qui reproduit côté serveur toute la logique jusque-là simulée dans le
navigateur (comptes, soldes, achats/ventes d'actions, dépôts, retraits, KYC).

**Zéro dépendance externe** : uniquement les modules intégrés de Node.js
(`http`, `node:sqlite`, `crypto`). Pas de `npm install` à faire.

## Prérequis

- Node.js **22.5 ou plus récent** (pour `node:sqlite`). Vérifie avec `node --version`.

## Démarrer le serveur

```bash
node server.js
```

Le serveur écoute par défaut sur `http://localhost:3000` et crée
automatiquement un fichier `wuri_bourse.db` (base SQLite) dans le même
dossier au premier lancement.

Pour changer le port ou le secret des jetons de session :

```bash
PORT=4000 TOKEN_SECRET="une-vraie-cle-secrete-longue" node server.js
```

## Endpoints disponibles

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | non | Créer un compte (nom, téléphone, mot de passe, PIN) |
| POST | `/api/login` | non | Se connecter (téléphone, mot de passe) → jeton |
| POST | `/api/verify-pin` | oui | Vérifier le code PIN (écran de verrouillage) |
| GET | `/api/me` | oui | Profil + solde de l'utilisateur connecté |
| GET | `/api/stocks` | non | Liste des 25 entreprises et leurs cours |
| GET | `/api/holdings` | oui | Portefeuille de l'utilisateur |
| GET | `/api/transactions` | oui | Historique (dépôts, retraits, achats, ventes) |
| POST | `/api/buy` | oui | Acheter des actions (`ticker`, `qty`) |
| POST | `/api/sell` | oui | Vendre des actions (`ticker`, `qty`) |
| POST | `/api/deposit/init` | oui | Démarrer un dépôt (`amount`, `methodId`, `phone`) |
| POST | `/api/deposit/confirm` | admin | Confirmer un dépôt reçu (`transactionId`) |
| POST | `/api/withdraw/init` | oui | Démarrer un retrait (`amount`, `methodId`, `destination`) |
| POST | `/api/withdraw/confirm` | admin | Confirmer un retrait envoyé (`transactionId`) |
| POST | `/api/kyc` | oui | Soumettre un dossier KYC (`name`, `docType`, `docNumber`) |
| POST | `/api/admin/kyc/approve` | admin | Valider un KYC (`userId`) |
| GET | `/api/settings/deposit-numbers` | non | Lire les numéros de dépôt configurés |
| POST | `/api/settings/deposit-numbers` | admin | Configurer les numéros de dépôt par opérateur |

`oui` = nécessite l'en-tête `Authorization: Bearer <token>` reçu à
l'inscription ou à la connexion.

`admin` = nécessite un compte avec `is_admin = 1` (le premier compte créé
sur une base neuve le devient automatiquement — voir section ci-dessous).

## Exemple d'utilisation (curl)

```bash
# Inscription
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ndongo Simo","phone":"690123456","password":"motdepasse123","pin":"1234"}'

# Connexion (récupère un token)
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"690123456","password":"motdepasse123"}'

# Acheter 5 actions SAFACAM (remplace TOKEN par celui reçu ci-dessus)
curl -X POST http://localhost:3000/api/buy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"SAFACAM","qty":5}'
```

## Ce qui est déjà correct pour une vraie mise en production

- Mots de passe et codes PIN **jamais stockés en clair** (hachés avec
  `scrypt` + sel aléatoire par utilisateur)
- Toute la logique de calcul (frais, soldes, quantités) s'exécute **côté
  serveur** — un client ne peut plus trafiquer son solde depuis la console
  du navigateur, contrairement à la version 100% front-end
- Base de données persistante partagée entre tous les utilisateurs (fini le
  `localStorage` isolé par navigateur)

## Sécurité des routes admin ✅

Les 4 routes sensibles (`/api/deposit/confirm`, `/api/withdraw/confirm`,
`/api/admin/kyc/approve`, `POST /api/settings/deposit-numbers`) sont
désormais protégées : seul un compte avec `is_admin = 1` peut les appeler.

**Le tout premier compte créé sur une base de données neuve devient
automatiquement administrateur.** Si tu redémarres avec une base vide (ou
sur un nouveau déploiement), assure-toi de créer TON compte en premier.

Pour vérifier ou changer manuellement qui est admin, tu peux inspecter/éditer
directement la base SQLite :

```bash
sqlite3 wuri_bourse.db "SELECT id, name, phone, is_admin FROM users;"
sqlite3 wuri_bourse.db "UPDATE users SET is_admin = 1 WHERE phone = '690123456';"
```

**Limite encore à connaître** : `/api/deposit/confirm` et
`/api/withdraw/confirm` sont maintenant réservées à un admin, ce qui est déjà
beaucoup plus sûr — mais en vraie production, même un admin humain ne
devrait pas cliquer "j'ai reçu le paiement" à la main. Ces deux routes
devront être remplacées par de vrais webhooks signés envoyés automatiquement
par le fournisseur de paiement (Orange, MTN, CinetPay...).

## Ce qu'il reste à faire avant un vrai lancement

1. ~~Protéger les routes marquées ⚠️~~ ✅ fait
2. **Remplacer `/api/deposit/confirm` et `/api/withdraw/confirm`** par de
   vrais webhooks signés des fournisseurs (Orange, MTN, ou un agrégateur
   comme CinetPay/Flutterwave/PawaPay).
3. **Servir le site en HTTPS** (obligatoire pour manipuler de l'argent et
   des mots de passe).
4. **Obtenir les agréments réglementaires** nécessaires (COSUMAF, CREPMF,
   SEC, etc. selon les marchés visés) avant d'accepter de vrais dépôts.

## Le front-end est maintenant branché ✅

`plateforme-bourse.html` appelle désormais cette API avec `fetch()` au lieu
d'utiliser `localStorage`. Pour tester l'ensemble :

1. Démarre le serveur : `node server.js` (laisse ce terminal ouvert)
2. Ouvre `plateforme-bourse.html` directement dans ton navigateur
   (double-clic, ou glisser-déposer dans une fenêtre du navigateur)
3. Crée un compte depuis l'écran d'accueil — les données sont maintenant
   stockées dans `wuri_bourse.db`, partagées entre tous ceux qui utilisent
   le même serveur

Si le navigateur bloque les requêtes depuis un fichier local (rare, mais
possible selon la configuration), sers le HTML avec un petit serveur local
plutôt que de l'ouvrir directement :

```bash
# Dans le dossier où se trouve plateforme-bourse.html
python3 -m http.server 8080
# puis ouvre http://localhost:8080/plateforme-bourse.html
```

Si tu héberges un jour l'API ailleurs qu'en local, change la valeur de
`API_BASE` tout en haut du `<script>` dans `plateforme-bourse.html`.

## Prochaine étape proposée

Commencer l'intégration
d'un vrai fournisseur de paiement (CinetPay, Flutterwave ou PawaPay pour
couvrir plusieurs opérateurs à la fois) à la place de la simulation actuelle.
