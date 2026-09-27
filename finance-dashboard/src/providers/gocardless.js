// GoCardless Bank Account Data (voorheen Nordigen).
// Docs: https://developer.gocardless.com/bank-account-data/overview
import { config } from '../env.js';
import { id } from '../store.js';

const API = 'https://bankaccountdata.gocardless.com/api/v2';

export const name = 'gocardless';
export const label = 'GoCardless Bank Account Data';

export function isConfigured() {
  return Boolean(config.goCardless.secretId && config.goCardless.secretKey);
}

let token = { value: '', expires: 0 };

async function accessToken() {
  if (token.value && Date.now() < token.expires) return token.value;
  const res = await fetch(`${API}/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ secret_id: config.goCardless.secretId, secret_key: config.goCardless.secretKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GoCardless token ${res.status}: ${data.detail || data.summary || JSON.stringify(data)}`);
  token = { value: data.access, expires: Date.now() + (data.access_expires - 60) * 1000 };
  return token.value;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GoCardless ${res.status}: ${data.detail || data.summary || JSON.stringify(data)}`);
  return data;
}

export async function listBanks(country = 'NL') {
  const list = await api(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`);
  return list.map((b) => ({ id: b.id, name: b.name, logo: b.logo, country, days: Number(b.transaction_total_days) }));
}

export async function startAuth({ bank, state, redirectUrl }) {
  const institution = await api(`/institutions/${encodeURIComponent(bank)}/`);
  const agreement = await api('/agreements/enduser/', {
    method: 'POST',
    body: {
      institution_id: bank,
      max_historical_days: Number(institution.transaction_total_days) || 90,
      access_valid_for_days: Math.min(Number(institution.max_access_valid_for_days) || 90, 180),
      access_scope: ['balances', 'details', 'transactions'],
    },
  });
  const req = await api('/requisitions/', {
    method: 'POST',
    body: { redirect: redirectUrl, institution_id: bank, reference: state, agreement: agreement.id, user_language: 'NL' },
  });
  return { url: req.link, pending: { bank: institution.name, requisitionId: req.id, validDays: agreement.access_valid_for_days } };
}

export async function completeAuth(pending, query) {
  if (query.error) throw new Error(`Bank weigerde toegang: ${query.details || query.error}`);
  const req = await api(`/requisitions/${pending.requisitionId}/`);
  if (!req.accounts?.length) throw new Error(`Geen rekeningen gekoppeld (status ${req.status}).`);
  const connection = {
    id: id('gc', req.id),
    provider: name,
    bank: pending.bank,
    requisitionId: req.id,
    validUntil: new Date(Date.now() + (pending.validDays || 90) * 864e5).toISOString(),
    createdAt: new Date().toISOString(),
  };
  const accounts = [];
  for (const accId of req.accounts) {
    const { account = {} } = await api(`/accounts/${accId}/details/`).catch(() => ({}));
    accounts.push({
      id: id('gc-acc', accId),
      connectionId: connection.id,
      providerAccountId: accId,
      name: account.name || account.product || account.ownerName || pending.bank,
      iban: account.iban || '',
      currency: account.currency || 'EUR',
      bank: pending.bank,
      source: name,
    });
  }
  return { connection, accounts };
}

const BALANCE_PRIORITY = ['interimAvailable', 'closingAvailable', 'expected', 'interimBooked', 'closingBooked', 'openingBooked'];

export async function sync(connection, account, since) {
  const { balances = [] } = await api(`/accounts/${account.providerAccountId}/balances/`);
  balances.sort((a, b) => BALANCE_PRIORITY.indexOf(a.balanceType) - BALANCE_PRIORITY.indexOf(b.balanceType));
  const balance = balances[0] ? Number(balances[0].balanceAmount.amount) : null;

  const { transactions = {} } = await api(`/accounts/${account.providerAccountId}/transactions/?date_from=${since}`);
  const list = [
    ...(transactions.booked || []).map((t) => normalize(t, account, false)),
    ...(transactions.pending || []).map((t) => normalize(t, account, true)),
  ];
  return { balance, transactions: list };
}

function normalize(t, account, pending) {
  const amount = Number(t.transactionAmount.amount);
  const date = t.bookingDate || t.valueDate || t.bookingDateTime?.slice(0, 10);
  const counterparty = (amount < 0 ? t.creditorName : t.debtorName) || t.creditorName || t.debtorName || '';
  const description = [t.remittanceInformationUnstructured, ...(t.remittanceInformationUnstructuredArray || []), t.additionalInformation]
    .filter(Boolean)
    .join(' ')
    .trim();
  return {
    id: id(account.id, t.transactionId || t.internalTransactionId || `${date}|${amount}|${counterparty}|${description}`),
    accountId: account.id,
    date,
    amount: Math.round(amount * 100) / 100,
    currency: t.transactionAmount.currency,
    counterparty,
    description,
    pending,
  };
}
