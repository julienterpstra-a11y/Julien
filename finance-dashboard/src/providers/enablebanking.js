// Enable Banking — PSD2 aggregator met gratis toegang voor je eigen rekeningen.
// Docs: https://enablebanking.com/docs/api/reference/
import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { config } from '../env.js';
import { id } from '../store.js';

const API = 'https://api.enablebanking.com';

export const name = 'enablebanking';
export const label = 'Enable Banking';

export function isConfigured() {
  return Boolean(config.enableBanking.appId && existsSync(config.enableBanking.keyPath));
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: config.enableBanking.appId };
  const body = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 };
  const unsigned = `${b64url(header)}.${b64url(body)}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(readFileSync(config.enableBanking.keyPath)).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Enable Banking ${res.status}: ${data.message || data.detail || text}`);
  return data;
}

export async function listBanks(country = 'NL') {
  const { aspsps } = await api(`/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
  return aspsps.map((b) => ({ id: b.name, name: b.name, logo: b.logo, country: b.country }));
}

export async function startAuth({ bank, country, state, redirectUrl }) {
  // PSD2 staat maximaal 180 dagen toe; daarna moet je opnieuw inloggen bij je bank.
  const validUntil = new Date(Date.now() + 179 * 864e5).toISOString();
  const res = await api('/auth', {
    method: 'POST',
    body: { access: { valid_until: validUntil }, aspsp: { name: bank, country }, state, redirect_url: redirectUrl, psu_type: 'personal' },
  });
  return { url: res.url, pending: { bank, country } };
}

export async function completeAuth(pending, query) {
  if (query.error) throw new Error(`Bank weigerde toegang: ${query.error_description || query.error}`);
  const session = await api('/sessions', { method: 'POST', body: { code: query.code } });
  const connection = {
    id: id('eb', session.session_id),
    provider: name,
    bank: pending.bank,
    sessionId: session.session_id,
    validUntil: session.access?.valid_until,
    createdAt: new Date().toISOString(),
  };
  const accounts = session.accounts.map((a) => ({
    id: id('eb-acc', a.uid),
    connectionId: connection.id,
    providerAccountId: a.uid,
    name: a.name || a.product || pending.bank,
    iban: a.account_id?.iban || '',
    currency: a.currency || 'EUR',
    bank: pending.bank,
    source: name,
  }));
  return { connection, accounts };
}

const BALANCE_PRIORITY = ['CLAV', 'ITAV', 'ITBD', 'CLBD', 'XPCD', 'OPBD', 'PRCD'];

export async function sync(connection, account, since) {
  const { balances = [] } = await api(`/accounts/${account.providerAccountId}/balances`);
  balances.sort((a, b) => BALANCE_PRIORITY.indexOf(a.balance_type) - BALANCE_PRIORITY.indexOf(b.balance_type));
  const balance = balances[0] ? Number(balances[0].balance_amount.amount) : null;

  const transactions = [];
  let continuation = '';
  do {
    const qs = new URLSearchParams({ date_from: since });
    if (continuation) qs.set('continuation_key', continuation);
    const page = await api(`/accounts/${account.providerAccountId}/transactions?${qs}`);
    for (const t of page.transactions || []) transactions.push(normalize(t, account));
    continuation = page.continuation_key || '';
  } while (continuation);

  return { balance, transactions };
}

function normalize(t, account) {
  const amount = Number(t.transaction_amount.amount) * (t.credit_debit_indicator === 'DBIT' ? -1 : 1);
  const date = t.booking_date || t.value_date || t.transaction_date;
  const counterparty = (amount < 0 ? t.creditor?.name : t.debtor?.name) || t.creditor?.name || t.debtor?.name || '';
  const description = (t.remittance_information || []).join(' ').trim();
  return {
    id: id(account.id, t.entry_reference || t.transaction_id || `${date}|${amount}|${counterparty}|${description}`),
    accountId: account.id,
    date,
    amount: Math.round(amount * 100) / 100,
    currency: t.transaction_amount.currency,
    counterparty,
    description,
    pending: t.status && t.status !== 'BOOK',
  };
}
