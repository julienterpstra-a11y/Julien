import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config, ROOT } from './env.js';
import * as store from './store.js';
import { TRANSFER_CATEGORIES } from './categorize.js';
import { generateDemo } from './demo.js';
import { importCsv } from './csv.js';
import * as enablebanking from './providers/enablebanking.js';
import * as gocardless from './providers/gocardless.js';

const PROVIDERS = { [enablebanking.name]: enablebanking, [gocardless.name]: gocardless };
const PUBLIC = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

store.load();

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Bestand te groot');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function json(req) {
  const buf = await readBody(req, 1024 * 1024);
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Ongeldige JSON');
  }
}

function decodeText(buf) {
  // Veel bank-exports zijn Windows-1252; val daarop terug als UTF-8 niet klopt.
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// ---------- authenticatie (optioneel) ----------
const COOKIE = 'fd_session';
const sign = (v) => createHmac('sha256', store.get().secret).update(v).digest('base64url');

function isAuthed(req) {
  if (!config.password) return true;
  const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const [issued, mac] = cookie.slice(COOKIE.length + 1).split('.');
  if (!issued || !mac) return false;
  const expected = Buffer.from(sign(issued));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) && Date.now() - Number(issued) < 30 * 864e5;
}

function login(res, password) {
  const a = createHmac('sha256', 'pw').update(String(password)).digest();
  const b = createHmac('sha256', 'pw').update(config.password).digest();
  if (!config.password || !timingSafeEqual(a, b)) throw new HttpError(401, 'Onjuist wachtwoord');
  const issued = String(Date.now());
  const secure = config.baseUrl.startsWith('https') ? '; Secure' : '';
  send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${issued}.${sign(issued)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${secure}` });
}

// ---------- bankkoppeling ----------
const isoDate = (d) => d.toISOString().slice(0, 10);

async function syncAll() {
  const db = store.get();
  const report = [];
  for (const connection of db.connections) {
    const provider = PROVIDERS[connection.provider];
    if (!provider?.isConfigured()) {
      report.push({ bank: connection.bank, error: `${connection.provider} is niet geconfigureerd` });
      continue;
    }
    if (connection.validUntil && new Date(connection.validUntil) < new Date()) {
      connection.expired = true;
      report.push({ bank: connection.bank, error: 'Toestemming verlopen — koppel de bank opnieuw' });
      continue;
    }
    for (const account of db.accounts.filter((a) => a.connectionId === connection.id)) {
      try {
        // Eerste sync: zo ver terug als de bank toestaat (vaak 90 dagen tot 2 jaar). Daarna 10 dagen overlap.
        const since = account.lastSync ? isoDate(new Date(new Date(account.lastSync).getTime() - 10 * 864e5)) : isoDate(new Date(Date.now() - 730 * 864e5));
        const { balance, transactions } = await provider.sync(connection, account, since);
        // Openstaande (pending) transacties krijgen bij boeking vaak een nieuw ID: vervang ze.
        db.transactions = db.transactions.filter((t) => !(t.accountId === account.id && t.pending));
        const added = store.addTransactions(transactions);
        store.upsertAccount({ ...account, balance: balance ?? account.balance, balanceDate: new Date().toISOString(), lastSync: new Date().toISOString(), error: undefined });
        report.push({ bank: connection.bank, account: account.name, added });
      } catch (err) {
        store.upsertAccount({ ...account, error: err.message });
        report.push({ bank: connection.bank, account: account.name, error: err.message });
      }
    }
    connection.lastSync = new Date().toISOString();
  }
  store.save();
  return report;
}

async function handleCallback(req, res, url) {
  const providerName = url.pathname.split('/')[2];
  const provider = PROVIDERS[providerName];
  const query = Object.fromEntries(url.searchParams);
  const state = query.state || query.ref;
  const db = store.get();
  const pending = db.pending[state];
  const back = (msg, ok) => {
    res.writeHead(302, { Location: `/?${ok ? 'connected' : 'error'}=${encodeURIComponent(msg)}` });
    res.end();
  };
  if (!provider || !pending || pending.provider !== providerName) return back('Onbekende of verlopen koppelsessie', false);
  delete db.pending[state];
  try {
    const { connection, accounts } = await provider.completeAuth(pending, query);
    // Opnieuw koppelen van dezelfde bank vervangt de oude sessie maar behoudt de historie.
    for (const acc of accounts) {
      const old = db.accounts.find((a) => a.source === acc.source && ((acc.iban && a.iban === acc.iban) || a.id === acc.id));
      if (old && old.id !== acc.id) {
        for (const t of db.transactions) if (t.accountId === old.id) t.accountId = acc.id;
        acc.lastSync = old.lastSync;
        db.accounts = db.accounts.filter((a) => a !== old);
      }
      store.upsertAccount(acc);
    }
    db.connections = db.connections.filter((c) => db.accounts.some((a) => a.connectionId === c.id));
    db.connections.push(connection);
    store.save();
    await syncAll();
    back(`${connection.bank} gekoppeld (${accounts.length} rekening${accounts.length === 1 ? '' : 'en'})`, true);
  } catch (err) {
    store.save();
    back(err.message, false);
  }
}

// ---------- API ----------
async function api(req, res, url) {
  const db = store.get();
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/login') return login(res, (await json(req)).password);
  if (route === 'GET /api/status') {
    return send(res, 200, {
      authRequired: Boolean(config.password),
      authed: isAuthed(req),
      providers: Object.values(PROVIDERS).map((p) => ({ id: p.name, label: p.label, configured: p.isConfigured() })),
    });
  }
  if (!isAuthed(req)) throw new HttpError(401, 'Log eerst in');

  // Beschermt tegen CSRF: schrijfacties alleen vanaf onze eigen pagina (fetch met JSON / custom header).
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'finance-dashboard') throw new HttpError(403, 'Ongeldig verzoek');

  if (route === 'POST /api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });

  if (route === 'GET /api/data') {
    return send(res, 200, {
      accounts: db.accounts,
      transactions: db.transactions,
      connections: db.connections.map(({ id, provider, bank, validUntil, lastSync, expired, createdAt }) => ({ id, provider, bank, validUntil, lastSync, expired, createdAt })),
      rules: db.rules,
      budgets: db.budgets,
      transferCategories: [...TRANSFER_CATEGORIES],
    });
  }

  if (route === 'GET /api/banks') {
    const provider = PROVIDERS[url.searchParams.get('provider')];
    if (!provider?.isConfigured()) throw new HttpError(400, 'Provider niet geconfigureerd — zie README');
    return send(res, 200, await provider.listBanks(url.searchParams.get('country') || 'NL'));
  }

  if (route === 'POST /api/connect') {
    const { provider: providerName, bank, country = 'NL' } = await json(req);
    const provider = PROVIDERS[providerName];
    if (!provider?.isConfigured()) throw new HttpError(400, 'Provider niet geconfigureerd — zie README');
    if (!bank) throw new HttpError(400, 'Kies een bank');
    const state = randomBytes(16).toString('hex');
    const { url: authUrl, pending } = await provider.startAuth({ bank, country, state, redirectUrl: `${config.baseUrl}/callback/${providerName}` });
    for (const [k, v] of Object.entries(db.pending)) if (Date.now() - v.at > 3600e3) delete db.pending[k];
    db.pending[state] = { ...pending, provider: providerName, at: Date.now() };
    store.save();
    return send(res, 200, { url: authUrl });
  }

  if (route === 'POST /api/sync') return send(res, 200, { report: await syncAll() });

  let m;
  if ((m = url.pathname.match(/^\/api\/connections\/([\w-]+)$/)) && req.method === 'DELETE') {
    db.connections = db.connections.filter((c) => c.id !== m[1]);
    store.removeAccounts((a) => a.connectionId === m[1]);
    store.save();
    return send(res, 200, { ok: true });
  }

  if ((m = url.pathname.match(/^\/api\/accounts\/([\w-]+)$/))) {
    if (req.method === 'DELETE') {
      store.removeAccounts((a) => a.id === m[1]);
      store.save();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'PATCH') {
      const { name, balance } = await json(req);
      const acc = db.accounts.find((a) => a.id === m[1]);
      if (!acc) throw new HttpError(404, 'Rekening niet gevonden');
      if (typeof name === 'string' && name.trim()) acc.name = name.trim().slice(0, 80);
      if (Number.isFinite(balance)) Object.assign(acc, { balance, balanceDate: new Date().toISOString() });
      store.save();
      return send(res, 200, acc);
    }
  }

  if (route === 'POST /api/import') {
    const text = decodeText(await readBody(req));
    let result;
    try {
      result = importCsv(text, { accountName: url.searchParams.get('account') || undefined });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const existing = db.accounts.find((a) => a.id === result.account.id);
    store.upsertAccount(existing ? { ...result.account, name: existing.name, ...(result.account.balance === undefined && { balance: existing.balance, balanceDate: existing.balanceDate }) } : result.account);
    const added = store.addTransactions(result.transactions);
    store.save();
    return send(res, 200, { format: result.format, account: result.account.name, added, total: result.transactions.length });
  }

  if ((m = url.pathname.match(/^\/api\/transactions\/([\w-]+)$/)) && req.method === 'PATCH') {
    const { category, createRule } = await json(req);
    const tx = db.transactions.find((t) => t.id === m[1]);
    if (!tx) throw new HttpError(404, 'Transactie niet gevonden');
    if (typeof category !== 'string' || !category.trim()) throw new HttpError(400, 'Categorie ontbreekt');
    Object.assign(tx, { category: category.trim().slice(0, 60), manual: true });
    let updated = 1;
    if (createRule && tx.counterparty) {
      // Leer van de keuze: alle transacties met dezelfde tegenpartij krijgen deze categorie.
      const pattern = tx.counterparty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      db.rules = db.rules.filter((r) => r.match !== pattern);
      db.rules.unshift({ match: pattern, category: tx.category, custom: true });
      for (const t of db.transactions) if (t.counterparty === tx.counterparty && !t.manual) { t.category = tx.category; updated++; }
    }
    store.save();
    return send(res, 200, { updated });
  }

  if (route === 'PUT /api/rules') {
    const { rules } = await json(req);
    if (!Array.isArray(rules)) throw new HttpError(400, 'rules moet een lijst zijn');
    for (const r of rules) {
      try { new RegExp(r.match, 'i'); } catch { throw new HttpError(400, `Ongeldig patroon: ${r.match}`); }
    }
    db.rules = rules.map(({ match, category, sign, custom }) => ({ match: String(match), category: String(category), ...(sign && { sign }), ...(custom && { custom }) }));
    store.recategorizeAll();
    store.save();
    return send(res, 200, { ok: true });
  }

  if (route === 'PUT /api/budgets') {
    const { budgets } = await json(req);
    db.budgets = Object.fromEntries(Object.entries(budgets || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
    store.save();
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/demo') {
    const { accounts, transactions } = generateDemo();
    store.removeAccounts((a) => a.source === 'demo');
    for (const a of accounts) store.upsertAccount(a);
    store.addTransactions(transactions);
    store.save();
    return send(res, 200, { ok: true });
  }

  if (route === 'DELETE /api/data') {
    store.reset();
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Niet gevonden');
}

async function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC + path.sep)) throw new HttpError(404, 'Niet gevonden');
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    throw new HttpError(404, 'Niet gevonden');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/callback/')) {
      if (!isAuthed(req)) throw new HttpError(401, 'Log eerst in');
      return await handleCallback(req, res, url);
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Methode niet toegestaan');
    return await serveStatic(res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message });
  }
});

// Automatische synchronisatie elke 6 uur (PSD2 staat max. 4x per dag toe zonder dat je zelf inlogt).
setInterval(() => {
  if (store.get().connections.length) syncAll().catch((e) => console.error('Auto-sync mislukt:', e.message));
}, 6 * 3600e3).unref();

server.listen(config.port, HOST, () => {
  console.log(`Financieel dashboard draait op http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${config.port}`);
  for (const p of Object.values(PROVIDERS)) console.log(`  ${p.label}: ${p.isConfigured() ? 'geconfigureerd ✓' : 'niet geconfigureerd'}`);
  if (!config.password && HOST !== '127.0.0.1' && HOST !== 'localhost') console.warn('  ⚠ Geen DASHBOARD_PASSWORD ingesteld terwijl de server extern bereikbaar is!');
});
