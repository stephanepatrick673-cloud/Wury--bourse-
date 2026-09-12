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
| POST | `/api/deposit/confirm` | ⚠️ | Confirmer un dépôt reçu (`transactionId`) |
| POST | `/api/withdraw/init` | oui | Démarrer un retrait (`amount`, `methodId`, `destination`) |
| POST | `/api/withdraw/confirm` | ⚠️ | Confirmer un retrait envoyé (`transactionId`) |
| POST | `/api/kyc` | oui | Soumettre un dossier KYC (`name`, `docType`, `docNumber`) |
| POST | `/api/admin/kyc/approve` | ⚠️ | Valider un KYC (`userId`) |
| GET/POST | `/api/settings/deposit-numbers` | ⚠️ | Lire/configurer les numéros de dépôt par opérateur |

`oui` = nécessite l'en-tête `Authorization: Bearer <token>` reçu à
l'inscription ou à la connexion.

`⚠️` = routes qui **doivent être protégées avant toute mise en ligne
réelle** : elles ne sont accessibles à personne en particulier pour
l'instant (ni authentification admin, ni vérification de webhook), ce qui
convient pour développer et tester en local mais pas pour un vrai
déploiement public.

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

## Ce qu'il reste à faire avant un vrai lancement

1. **Protéger les routes marquées ⚠️** : ajouter une vérification de rôle
   admin réel (champ `is_admin` déjà présent dans la table `users`) et un
   compte admin distinct pour se connecter au back-office.
2. **Remplacer `/api/deposit/confirm` et `/api/withdraw/confirm`** par de
   vrais webhooks signés des fournisseurs (Orange, MTN, ou un agrégateur
   comme CinetPay/Flutterwave/PawaPay) — actuellement n'importe qui peut
   appeler ces routes et confirmer une transaction, ce qui est acceptable
   en développement mais dangereux en production.
3. **Servir le site en HTTPS** (obligatoire pour manipuler de l'argent et
   des mots de passe).
4. **Connecter le front-end existant** (`plateforme-bourse.html`) à cette
   API à la place du `localStorage` — prochaine étape logique.
5. **Obtenir les agréments réglementaires** nécessaires (COSUMAF, CREPMF,
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

Protéger les routes ⚠️ avec un vrai rôle admin, puis commencer l'intégration
d'un vrai fournisseur de paiement (CinetPay, Flutterwave ou PawaPay pour
couvrir plusieurs opérateurs à la fois) à la place de la simulation actuelle.
