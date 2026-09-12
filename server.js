// ============================================================================
// Wúri Bourse — Backend
// Zéro dépendance externe : uniquement les modules intégrés de Node.js
// (http, node:sqlite, crypto). Nécessite Node.js 22.5+.
//
// Démarrage :  node server.js
// Le serveur écoute par défaut sur http://localhost:3000
// ============================================================================

const http = require("http");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "wuri_bourse.db");
const TOKEN_SECRET = process.env.TOKEN_SECRET || "changeme-en-production-avec-une-vraie-cle-secrete";
const FEE_RATE = 0.01; // 1% de frais de courtage, achat comme vente

// ----------------------------------------------------------------------------
// Base de données
// ----------------------------------------------------------------------------
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    pin_hash TEXT,
    pin_salt TEXT,
    cash REAL NOT NULL DEFAULT 0,
    kyc_status TEXT NOT NULL DEFAULT 'none',
    kyc_name TEXT,
    kyc_doc_type TEXT,
    kyc_doc_number TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holdings (
    user_id INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    qty REAL NOT NULL,
    avg_price REAL NOT NULL,
    PRIMARY KEY (user_id, ticker),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,        -- depot | retrait | achat | vente
    method TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,      -- pending | completed
    reference TEXT,
    phone TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deposit_numbers (
    method_id TEXT PRIMARY KEY,
    number TEXT NOT NULL
  );
`);

// Solde de départ pour la démo (comme dans la version front-end)
const STARTING_CASH = 850000;

// ----------------------------------------------------------------------------
// Données de marché (identiques au front-end)
// ----------------------------------------------------------------------------
const STOCKS = [
  { ticker: "SAFACAM", name: "Société Africaine Forestière et Agricole du Cameroun", sector: "Agro-industrie", exchange: "BVMAC", price: 31500, change: 1.4 },
  { ticker: "SOCAPALM", name: "Société Camerounaise de Palmeraies", sector: "Agro-industrie", exchange: "BVMAC", price: 47800, change: -0.6 },
  { ticker: "SEMC", name: "Société des Eaux Minérales du Cameroun", sector: "Agroalimentaire", exchange: "BVMAC", price: 15900, change: 2.1 },
  { ticker: "SIAC", name: "Société Industrielle et Agricole du Cameroun", sector: "Agro-industrie", exchange: "BVMAC", price: 8200, change: 0.0 },
  { ticker: "SNTS", name: "Sonatel", sector: "Télécommunications", exchange: "BRVM", price: 14200, change: 0.8 },
  { ticker: "ETIT", name: "Ecobank Transnational Incorporated", sector: "Banque", exchange: "BRVM", price: 12800, change: -1.1 },
  { ticker: "BOAB", name: "Bank of Africa Bénin", sector: "Banque", exchange: "BRVM", price: 3475, change: 0.5 },
  { ticker: "SICC", name: "SICOR", sector: "Agro-industrie", exchange: "BRVM", price: 6400, change: 2.3 },
  { ticker: "NTLC", name: "Nestlé Côte d'Ivoire", sector: "Agroalimentaire", exchange: "BRVM", price: 35500, change: 0.2 },
  { ticker: "SDSC", name: "Bolloré Transport & Logistics Côte d'Ivoire", sector: "Logistique", exchange: "BRVM", price: 9850, change: -0.4 },
  { ticker: "DANGREF", name: "Dangote Petroleum Refinery", sector: "Énergie · Pétrole", exchange: "NGX", price: 30000 / 72, change: 4.2, featured: true, lotSize: 72 },
  { ticker: "DANGCEM", name: "Dangote Cement", sector: "Matériaux de construction", exchange: "NGX", price: 68500, change: 1.9 },
  { ticker: "MTNN", name: "MTN Nigeria", sector: "Télécommunications", exchange: "NGX", price: 34800, change: -0.3 },
  { ticker: "GTCO", name: "Guaranty Trust Holding Company", sector: "Banque", exchange: "NGX", price: 7500, change: 3.1 },
  { ticker: "ZENITHBANK", name: "Zenith Bank", sector: "Banque", exchange: "NGX", price: 6200, change: 0.6 },
  { ticker: "NPN", name: "Naspers", sector: "Technologie · Médias", exchange: "JSE", price: 89500, change: 1.2 },
  { ticker: "MTN", name: "MTN Group", sector: "Télécommunications", exchange: "JSE", price: 18900, change: -0.9 },
  { ticker: "SOL", name: "Sasol", sector: "Énergie · Chimie", exchange: "JSE", price: 24300, change: -2.4 },
  { ticker: "SHP", name: "Shoprite Holdings", sector: "Distribution", exchange: "JSE", price: 42200, change: 0.7 },
  { ticker: "COMI", name: "Commercial International Bank", sector: "Banque", exchange: "EGX", price: 12500, change: 1.5 },
  { ticker: "ETEL", name: "Telecom Egypt", sector: "Télécommunications", exchange: "EGX", price: 3800, change: 0.4 },
  { ticker: "SCOM", name: "Safaricom", sector: "Télécommunications", exchange: "NSE-KE", price: 2900, change: 2.0 },
  { ticker: "EABL", name: "East African Breweries", sector: "Boissons", exchange: "NSE-KE", price: 26400, change: -0.5 },
  { ticker: "ATW", name: "Attijariwafa Bank", sector: "Banque", exchange: "BVC", price: 87200, change: 0.9 },
  { ticker: "IAM", name: "Maroc Telecom", sector: "Télécommunications", exchange: "BVC", price: 15700, change: 0.1 },
];
const stockByTicker = (t) => STOCKS.find((s) => s.ticker === t);

const PAYMENT_METHODS = [
  { id: "orange", name: "Orange Money", type: "mobile", country: "Cameroun · Sénégal · Côte d'Ivoire" },
  { id: "mtn", name: "MTN Mobile Money", type: "mobile", country: "Cameroun · Ghana · Ouganda" },
  { id: "mpesa", name: "M-Pesa", type: "mobile", country: "Kenya · Tanzanie" },
  { id: "wave", name: "Wave", type: "mobile", country: "Sénégal · Côte d'Ivoire" },
  { id: "airtel", name: "Airtel Money", type: "mobile", country: "Nigéria · Zambie · Ouganda" },
  { id: "moov", name: "Moov Money", type: "mobile", country: "Bénin · Togo · Côte d'Ivoire" },
  { id: "vodafone", name: "Vodafone Cash", type: "mobile", country: "Ghana · Égypte" },
  { id: "ecocash", name: "EcoCash", type: "mobile", country: "Zimbabwe" },
  { id: "card", name: "Carte bancaire", type: "card", country: "International" },
  { id: "transfer", name: "Virement bancaire", type: "transfer", country: "International" },
];
const methodById = (id) => PAYMENT_METHODS.find((m) => m.id === id);

// ----------------------------------------------------------------------------
// Sécurité : hachage mot de passe / PIN (scrypt, intégré à Node — pas besoin de bcrypt)
// ----------------------------------------------------------------------------
function hashSecret(secret, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return { hash, salt };
}
function verifySecret(secret, salt, expectedHash) {
  const { hash } = hashSecret(secret, salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
}

// ----------------------------------------------------------------------------
// Jetons de session (mini-JWT maison en HMAC-SHA256 — pas de dépendance externe)
// ----------------------------------------------------------------------------
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(payload) {
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("hex");
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Aides HTTP
// ----------------------------------------------------------------------------
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*", // à restreindre à ton domaine en production
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

function getAuthUser(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return db.prepare("SELECT * FROM users WHERE id = ?").get(payload.userId) || null;
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    cash: u.cash,
    kycStatus: u.kyc_status,
    isAdmin: !!u.is_admin,
  };
}

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.pattern.split("/").filter(Boolean);
    const actual = pathname.split("/").filter(Boolean);
    if (parts.length !== actual.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(actual[i]);
      else if (parts[i] !== actual[i]) ok = false;
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ---- Auth ----
route("POST", "/api/register", async (req, res) => {
  const { name, phone, password, pin } = await readJsonBody(req);
  if (!name || !phone || !password || !/^\d{4}$/.test(pin || "")) {
    return sendJson(res, 400, { error: "Nom, téléphone, mot de passe et PIN à 4 chiffres sont requis." });
  }
  const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(phone);
  if (existing) return sendJson(res, 409, { error: "Ce numéro de téléphone est déjà utilisé." });

  const pw = hashSecret(password);
  const pn = hashSecret(pin);
  const info = db
    .prepare(
      `INSERT INTO users (name, phone, password_hash, password_salt, pin_hash, pin_salt, cash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, phone, pw.hash, pw.salt, pn.hash, pn.salt, STARTING_CASH);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
  const token = signToken({ userId: user.id });
  sendJson(res, 201, { token, user: publicUser(user) });
});

route("POST", "/api/login", async (req, res) => {
  const { phone, password } = await readJsonBody(req);
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(phone || "");
  if (!user || !verifySecret(password, user.password_salt, user.password_hash)) {
    return sendJson(res, 401, { error: "Numéro de téléphone ou mot de passe incorrect." });
  }
  const token = signToken({ userId: user.id });
  sendJson(res, 200, { token, user: publicUser(user) });
});

route("POST", "/api/verify-pin", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { pin } = await readJsonBody(req);
  const ok = user.pin_hash && verifySecret(pin, user.pin_salt, user.pin_hash);
  sendJson(res, ok ? 200 : 401, ok ? { ok: true } : { error: "Code PIN incorrect." });
});

route("GET", "/api/me", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  sendJson(res, 200, { user: publicUser(user) });
});

// ---- Marché ----
route("GET", "/api/stocks", async (req, res) => {
  sendJson(res, 200, { stocks: STOCKS });
});

// ---- Portefeuille ----
route("GET", "/api/holdings", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const rows = db.prepare("SELECT ticker, qty, avg_price AS avgPrice FROM holdings WHERE user_id = ?").all(user.id);
  sendJson(res, 200, { holdings: rows });
});

route("GET", "/api/transactions", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const rows = db
    .prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC")
    .all(user.id);
  sendJson(res, 200, { transactions: rows });
});

// ---- Achat / vente ----
route("POST", "/api/buy", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { ticker, qty } = await readJsonBody(req);
  const stock = stockByTicker(ticker);
  if (!stock || !qty || qty <= 0) return sendJson(res, 400, { error: "Requête invalide." });

  const lotSize = stock.lotSize || 1;
  if (qty % lotSize !== 0) {
    return sendJson(res, 400, { error: `Cette action s'achète par lot de ${lotSize}.` });
  }

  const subtotal = stock.price * qty;
  const fee = subtotal * FEE_RATE;
  const total = subtotal + fee;
  if (total > user.cash) return sendJson(res, 400, { error: "Liquidités insuffisantes." });

  const newCash = user.cash - total;
  db.prepare("UPDATE users SET cash = ? WHERE id = ?").run(newCash, user.id);

  const existing = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND ticker = ?").get(user.id, ticker);
  if (existing) {
    const newQty = existing.qty + qty;
    const newAvg = (existing.avg_price * existing.qty + stock.price * qty) / newQty;
    db.prepare("UPDATE holdings SET qty = ?, avg_price = ? WHERE user_id = ? AND ticker = ?").run(newQty, newAvg, user.id, ticker);
  } else {
    db.prepare("INSERT INTO holdings (user_id, ticker, qty, avg_price) VALUES (?, ?, ?, ?)").run(user.id, ticker, qty, stock.price);
  }

  db.prepare(
    `INSERT INTO transactions (user_id, kind, method, amount, status, detail)
     VALUES (?, 'achat', ?, ?, 'completed', ?)`
  ).run(user.id, ticker, total, `${qty} action(s) · frais ${fee.toFixed(0)} FCFA`);

  sendJson(res, 200, { cash: newCash, subtotal, fee, total });
});

route("POST", "/api/sell", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { ticker, qty } = await readJsonBody(req);
  const stock = stockByTicker(ticker);
  const holding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND ticker = ?").get(user.id, ticker);
  if (!stock || !holding || !qty || qty <= 0 || qty > holding.qty) {
    return sendJson(res, 400, { error: "Requête invalide ou quantité insuffisante." });
  }

  const subtotal = stock.price * qty;
  const fee = subtotal * FEE_RATE;
  const proceeds = subtotal - fee;
  const newCash = user.cash + proceeds;
  db.prepare("UPDATE users SET cash = ? WHERE id = ?").run(newCash, user.id);

  const remaining = holding.qty - qty;
  if (remaining <= 0) {
    db.prepare("DELETE FROM holdings WHERE user_id = ? AND ticker = ?").run(user.id, ticker);
  } else {
    db.prepare("UPDATE holdings SET qty = ? WHERE user_id = ? AND ticker = ?").run(remaining, user.id, ticker);
  }

  db.prepare(
    `INSERT INTO transactions (user_id, kind, method, amount, status, detail)
     VALUES (?, 'vente', ?, ?, 'completed', ?)`
  ).run(user.id, ticker, proceeds, `${qty} action(s) · frais ${fee.toFixed(0)} FCFA`);

  sendJson(res, 200, { cash: newCash, subtotal, fee, proceeds });
});

// ---- Dépôt ----
// NOTE IMPORTANTE : /api/deposit/confirm doit, dans une vraie mise en prod, être
// appelé UNIQUEMENT par le webhook du fournisseur de paiement (Orange, MTN,
// CinetPay...), jamais directement par le client. Ici il est laissé accessible
// pour permettre de simuler la confirmation en attendant une vraie intégration.
route("POST", "/api/deposit/init", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { amount, methodId, phone } = await readJsonBody(req);
  const method = methodById(methodId);
  if (!method || !amount || amount <= 0) return sendJson(res, 400, { error: "Requête invalide." });
  if (method.type === "mobile" && (!phone || phone.length < 6)) {
    return sendJson(res, 400, { error: "Numéro de téléphone requis pour ce moyen de paiement." });
  }

  const reference = "WB-" + Math.floor(100000 + Math.random() * 900000);

  if (method.type === "card") {
    // Simule une vérification 3D Secure instantanée
    const newCash = user.cash + amount;
    db.prepare("UPDATE users SET cash = ? WHERE id = ?").run(newCash, user.id);
    const info = db
      .prepare(`INSERT INTO transactions (user_id, kind, method, amount, status, reference) VALUES (?, 'depot', ?, ?, 'completed', ?)`)
      .run(user.id, method.name, amount, reference);
    return sendJson(res, 200, { status: "completed", cash: newCash, transactionId: info.lastInsertRowid });
  }

  const depositNumberRow = db.prepare("SELECT number FROM deposit_numbers WHERE method_id = ?").get(methodId);
  const depositNumber = depositNumberRow ? depositNumberRow.number : null;

  const info = db
    .prepare(
      `INSERT INTO transactions (user_id, kind, method, amount, status, reference, phone)
       VALUES (?, 'depot', ?, ?, 'pending', ?, ?)`
    )
    .run(user.id, method.name, amount, reference, phone || null);

  sendJson(res, 200, {
    status: "pending",
    transactionId: info.lastInsertRowid,
    reference,
    depositNumber: method.type === "mobile" ? depositNumber : undefined,
    instructions:
      method.type === "transfer"
        ? "Effectuez le virement vers l'IBAN de la plateforme en indiquant la référence."
        : `Envoyez ${amount} FCFA au numéro ${depositNumber || "(non configuré)"} en indiquant la référence ${reference}.`,
  });
});

route("POST", "/api/deposit/confirm", async (req, res) => {
  // ⚠️ À protéger en production (webhook signé du fournisseur, pas d'accès client direct)
  const { transactionId } = await readJsonBody(req);
  const tx = db.prepare("SELECT * FROM transactions WHERE id = ? AND kind = 'depot'").get(transactionId);
  if (!tx || tx.status !== "pending") return sendJson(res, 400, { error: "Transaction introuvable ou déjà traitée." });

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(tx.user_id);
  const newCash = user.cash + tx.amount;
  db.prepare("UPDATE users SET cash = ? WHERE id = ?").run(newCash, user.id);
  db.prepare("UPDATE transactions SET status = 'completed' WHERE id = ?").run(tx.id);

  sendJson(res, 200, { status: "completed", cash: newCash });
});

// ---- Retrait ----
route("POST", "/api/withdraw/init", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { amount, methodId, destination } = await readJsonBody(req);
  const method = methodById(methodId);
  if (!method || method.type === "card" || !amount || amount <= 0) {
    return sendJson(res, 400, { error: "Requête invalide (le retrait par carte n'est pas proposé)." });
  }
  if (amount > user.cash) return sendJson(res, 400, { error: "Solde insuffisant." });
  if (!destination || destination.length < 6) return sendJson(res, 400, { error: "Destination du retrait requise." });

  const newCash = user.cash - amount; // débité immédiatement, comme une vraie demande de retrait
  db.prepare("UPDATE users SET cash = ? WHERE id = ?").run(newCash, user.id);

  const reference = "WB-" + Math.floor(100000 + Math.random() * 900000);
  const info = db
    .prepare(
      `INSERT INTO transactions (user_id, kind, method, amount, status, reference, phone)
       VALUES (?, 'retrait', ?, ?, 'pending', ?, ?)`
    )
    .run(user.id, method.name, amount, reference, destination);

  sendJson(res, 200, { status: "pending", transactionId: info.lastInsertRowid, reference, cash: newCash });
});

route("POST", "/api/withdraw/confirm", async (req, res) => {
  // ⚠️ Action admin/back-office (confirme que l'argent a bien été envoyé au client)
  const { transactionId } = await readJsonBody(req);
  const tx = db.prepare("SELECT * FROM transactions WHERE id = ? AND kind = 'retrait'").get(transactionId);
  if (!tx || tx.status !== "pending") return sendJson(res, 400, { error: "Transaction introuvable ou déjà traitée." });
  db.prepare("UPDATE transactions SET status = 'completed' WHERE id = ?").run(tx.id);
  sendJson(res, 200, { status: "completed" });
});

// ---- KYC ----
route("POST", "/api/kyc", async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return sendJson(res, 401, { error: "Non authentifié." });
  const { name, docType, docNumber } = await readJsonBody(req);
  if (!name || !docNumber) return sendJson(res, 400, { error: "Nom et numéro de pièce requis." });
  db.prepare(
    "UPDATE users SET kyc_status = 'pending', kyc_name = ?, kyc_doc_type = ?, kyc_doc_number = ? WHERE id = ?"
  ).run(name, docType || "cni", docNumber, user.id);
  sendJson(res, 200, { kycStatus: "pending" });
});

route("POST", "/api/admin/kyc/approve", async (req, res) => {
  // ⚠️ À restreindre à un vrai compte admin en production
  const { userId } = await readJsonBody(req);
  db.prepare("UPDATE users SET kyc_status = 'verified' WHERE id = ?").run(userId);
  sendJson(res, 200, { kycStatus: "verified" });
});

// ---- Paramètres : numéros de dépôt (admin) ----
route("GET", "/api/settings/deposit-numbers", async (req, res) => {
  const rows = db.prepare("SELECT method_id AS methodId, number FROM deposit_numbers").all();
  sendJson(res, 200, { depositNumbers: rows });
});

route("POST", "/api/settings/deposit-numbers", async (req, res) => {
  // ⚠️ À restreindre à un vrai compte admin en production
  const { methodId, number } = await readJsonBody(req);
  if (!methodId || !number) return sendJson(res, 400, { error: "methodId et number requis." });
  db.prepare(
    `INSERT INTO deposit_numbers (method_id, number) VALUES (?, ?)
     ON CONFLICT(method_id) DO UPDATE SET number = excluded.number`
  ).run(methodId, number);
  sendJson(res, 200, { ok: true });
});

// ----------------------------------------------------------------------------
// Serveur HTTP
// ----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const match = matchRoute(req.method, url.pathname);
  if (!match) return sendJson(res, 404, { error: "Route inconnue." });

  try {
    req.params = match.params;
    await match.handler(req, res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Erreur serveur : " + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Wúri Bourse — backend démarré sur http://localhost:${PORT}`);
  console.log(`Base de données : ${DB_PATH}`);
});
