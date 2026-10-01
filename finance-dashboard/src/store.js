import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { config } from './env.js';
import { DEFAULT_RULES, categorize } from './categorize.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

const empty = () => ({
  connections: [],   // gekoppelde banken (provider-sessies)
  accounts: [],      // rekeningen
  transactions: [],  // genormaliseerde transacties
  rules: DEFAULT_RULES.map((r) => ({ ...r })),
  budgets: {},       // { categorie: maandbedrag }
  pending: {},       // lopende autorisaties: state -> { provider, ... }
  secret: randomBytes(32).toString('hex'),
});

let db;

export function load() {
  mkdirSync(config.dataDir, { recursive: true });
  db = existsSync(DB_FILE) ? { ...empty(), ...JSON.parse(readFileSync(DB_FILE, 'utf8')) } : empty();
  save();
  return db;
}

export function get() {
  return db ?? load();
}

export function save() {
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 1), { mode: 0o600 });
  renameSync(tmp, DB_FILE);
}

export const id = (...parts) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);

export function upsertAccount(account) {
  const d = get();
  const i = d.accounts.findIndex((a) => a.id === account.id);
  if (i >= 0) d.accounts[i] = { ...d.accounts[i], ...account };
  else d.accounts.push(account);
}

/**
 * Voegt transacties toe en slaat duplicaten over. Handmatig gewijzigde categorieën blijven behouden.
 * @returns aantal nieuwe transacties
 */
export function addTransactions(list) {
  const d = get();
  const byId = new Map(d.transactions.map((t) => [t.id, t]));
  let added = 0;
  for (const t of list) {
    const existing = byId.get(t.id);
    if (existing) {
      // Pending -> geboekt, of bijgewerkte omschrijving: update, maar respecteer handmatige categorie.
      Object.assign(existing, { ...t, category: existing.manual ? existing.category : categorize(t, d.rules), manual: existing.manual });
      continue;
    }
    const tx = { ...t, category: categorize(t, d.rules), manual: false };
    d.transactions.push(tx);
    byId.set(tx.id, tx);
    added++;
  }
  d.transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return added;
}

export function recategorizeAll() {
  const d = get();
  for (const t of d.transactions) if (!t.manual) t.category = categorize(t, d.rules);
}

export function removeAccounts(predicate) {
  const d = get();
  const gone = new Set(d.accounts.filter(predicate).map((a) => a.id));
  d.accounts = d.accounts.filter((a) => !gone.has(a.id));
  d.transactions = d.transactions.filter((t) => !gone.has(t.accountId));
}

export function reset() {
  const secret = get().secret;
  db = { ...empty(), secret };
  save();
}
