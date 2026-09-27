import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'fd-test-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(path.join(dir, 'key.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.DATA_DIR = dir;
process.env.ENABLE_BANKING_APP_ID = 'test-app';
process.env.ENABLE_BANKING_KEY_PATH = path.join(dir, 'key.pem');
process.env.GOCARDLESS_SECRET_ID = 'id';
process.env.GOCARDLESS_SECRET_KEY = 'key';

const eb = await import('../src/providers/enablebanking.js');
const gc = await import('../src/providers/gocardless.js');

function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`Onverwachte call ${url}`);
    const body = typeof routes[key] === 'function' ? routes[key](url, opts) : routes[key];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return calls;
}

test('Enable Banking: JWT, sessie en transacties met paginering', async () => {
  assert.ok(eb.isConfigured());
  const calls = mockFetch({
    '/sessions': { session_id: 's1', access: { valid_until: '2027-01-01T00:00:00Z' }, accounts: [{ uid: 'u1', account_id: { iban: 'NL01TEST' }, name: 'Betaal', currency: 'EUR' }] },
    '/balances': { balances: [{ balance_type: 'CLBD', balance_amount: { amount: '100.00', currency: 'EUR' } }, { balance_type: 'ITAV', balance_amount: { amount: '90.00', currency: 'EUR' } }] },
    '/transactions': (url) =>
      url.includes('continuation_key')
        ? { transactions: [{ entry_reference: 'b', transaction_amount: { amount: '5.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', booking_date: '2026-01-02', debtor: { name: 'Jan' }, status: 'BOOK' }] }
        : { continuation_key: 'next', transactions: [{ entry_reference: 'a', transaction_amount: { amount: '12.30', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-01-01', creditor: { name: 'Jumbo' }, remittance_information: ['Pas 1'], status: 'BOOK' }] },
  });
  const { connection, accounts } = await eb.completeAuth({ bank: 'ING', country: 'NL' }, { code: 'abc' });
  assert.equal(accounts[0].iban, 'NL01TEST');
  const { balance, transactions } = await eb.sync(connection, accounts[0], '2025-01-01');
  assert.equal(balance, 90);
  assert.deepEqual(transactions.map((t) => [t.amount, t.counterparty]), [[-12.3, 'Jumbo'], [5, 'Jan']]);

  const [h, p, s] = calls[0].opts.headers.Authorization.slice(7).split('.');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).kid, 'test-app');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'api.enablebanking.com');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('GoCardless: token, requisition en transacties', async () => {
  mockFetch({
    '/token/new/': { access: 'tok', access_expires: 86400 },
    '/requisitions/r1/': { id: 'r1', status: 'LN', accounts: ['acc1'] },
    '/details/': { account: { iban: 'NL02TEST', name: 'Rekening' } },
    '/balances/': { balances: [{ balanceType: 'closingBooked', balanceAmount: { amount: '250.50', currency: 'EUR' } }] },
    '/transactions/': { transactions: { booked: [{ transactionId: 't1', bookingDate: '2026-02-01', transactionAmount: { amount: '-40.00', currency: 'EUR' }, creditorName: 'Eneco', remittanceInformationUnstructured: 'Termijn' }], pending: [] } },
  });
  const { connection, accounts } = await gc.completeAuth({ bank: 'ING', requisitionId: 'r1', validDays: 90 }, {});
  const { balance, transactions } = await gc.sync(connection, accounts[0], '2025-01-01');
  assert.equal(accounts[0].iban, 'NL02TEST');
  assert.equal(balance, 250.5);
  assert.equal(transactions[0].counterparty, 'Eneco');
  assert.equal(transactions[0].amount, -40);
});
