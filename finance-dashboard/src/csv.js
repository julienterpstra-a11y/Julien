// CSV/TXT-import voor exports van ING, Rabobank, ABN AMRO, bunq, ASN/SNS/RegioBank (generiek) en Triodos (generiek).
import { id } from './store.js';

export function parseCsv(text, sep) {
  text = text.replace(/^﻿/, '');
  if (!sep) {
    const first = text.split(/\r?\n/, 1)[0];
    const counts = [',', ';', '\t'].map((s) => [s, first.split(s).length]);
    sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// "1.234,56" / "-12,50" / "+12,50" / "12.50" -> number
export function parseAmount(s) {
  s = String(s).trim().replace(/[€\s]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (Number.isNaN(n)) throw new Error(`Ongeldig bedrag: ${s}`);
  return n;
}

// 20240131 / 2024-01-31 / 31-01-2024 / 31/01/2024 -> 2024-01-31
export function parseDate(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new Error(`Ongeldige datum: ${s}`);
}

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function findCol(header, ...names) {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.indexOf(norm(n));
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.includes(norm(n)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Detecteert het formaat en zet om naar { format, iban, rows: [{date, amount, counterparty, description, balanceAfter?}] }
 */
export function detectAndParse(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('Leeg bestand');
  const header = rows[0];
  const h = header.map(norm);

  // ABN AMRO .TAB: geen header; kolommen: rekening, munt, datum, beginsaldo, eindsaldo, rentedatum, bedrag, omschrijving
  if (header.length >= 8 && /^\d{8}$/.test(header[2]?.trim()) && !h.includes('datum')) {
    return {
      format: 'ABN AMRO',
      iban: header[0].trim(),
      rows: rows.map((r) => {
        const description = r.slice(7).join(' ').replace(/\s+/g, ' ').trim();
        const name = description.match(/Naam:\s*(.+?)(?:\s{2,}|\s+(?:Omschrijving|Kenmerk|IBAN|BIC|Machtiging):|$)/i)?.[1];
        return { date: parseDate(r[2]), amount: parseAmount(r[6]), counterparty: name || description.slice(0, 40), description, balanceAfter: parseAmount(r[4]) };
      }),
    };
  }

  // ING
  if (h.includes('afbij') && (h.includes('bedrageur') || h.some((x) => x.startsWith('bedrag')))) {
    const c = {
      date: findCol(header, 'Datum'),
      name: findCol(header, 'Naam / Omschrijving', 'Naam'),
      account: findCol(header, 'Rekening'),
      sign: findCol(header, 'Af Bij'),
      amount: findCol(header, 'Bedrag (EUR)', 'Bedrag'),
      memo: findCol(header, 'Mededelingen'),
      kind: findCol(header, 'Mutatiesoort'),
      balance: findCol(header, 'Saldo na mutatie'),
    };
    return {
      format: 'ING',
      iban: rows[1]?.[c.account]?.trim() || '',
      rows: rows.slice(1).map((r) => ({
        date: parseDate(r[c.date]),
        amount: parseAmount(r[c.amount]) * (norm(r[c.sign]) === 'af' ? -1 : 1),
        counterparty: r[c.name]?.trim() || '',
        description: [r[c.memo], r[c.kind]].filter(Boolean).join(' — ').trim(),
        balanceAfter: c.balance >= 0 && r[c.balance] ? parseAmount(r[c.balance]) : undefined,
      })),
    };
  }

  // Rabobank
  if (h.includes('ibanbban') && h.includes('naamtegenpartij')) {
    const c = {
      iban: findCol(header, 'IBAN/BBAN'),
      date: findCol(header, 'Datum'),
      amount: findCol(header, 'Bedrag'),
      balance: findCol(header, 'Saldo na trn'),
      name: findCol(header, 'Naam tegenpartij'),
      desc: header.map((x, i) => (/^omschrijving/i.test(x) ? i : -1)).filter((i) => i >= 0),
    };
    return {
      format: 'Rabobank',
      iban: rows[1]?.[c.iban]?.trim() || '',
      rows: rows.slice(1).map((r) => ({
        date: parseDate(r[c.date]),
        amount: parseAmount(r[c.amount]),
        counterparty: r[c.name]?.trim() || '',
        description: c.desc.map((i) => r[i]).filter(Boolean).join(' ').trim(),
        balanceAfter: c.balance >= 0 && r[c.balance] ? parseAmount(r[c.balance]) : undefined,
      })),
    };
  }

  // Generiek (o.a. bunq, SNS/ASN, Triodos, Knab met header)
  const c = {
    date: findCol(header, 'Datum', 'Date', 'Boekdatum', 'Transactiedatum', 'Booking date'),
    amount: findCol(header, 'Bedrag', 'Amount', 'Transactiebedrag'),
    name: findCol(header, 'Naam tegenpartij', 'Tegenpartij', 'Name', 'Naam', 'Begunstigde', 'Counterparty'),
    desc: findCol(header, 'Omschrijving', 'Description', 'Mededelingen', 'Details'),
    sign: findCol(header, 'Af/Bij', 'Debet/Credit', 'D/C'),
    iban: findCol(header, 'Rekening', 'Account', 'Rekeningnummer', 'IBAN'),
  };
  if (c.date < 0 || c.amount < 0) {
    throw new Error('Onbekend CSV-formaat. Zorg voor kolommen "Datum" en "Bedrag" (of exporteer als CSV vanuit je bank).');
  }
  return {
    format: 'Generiek',
    iban: c.iban >= 0 ? rows[1]?.[c.iban]?.trim() || '' : '',
    rows: rows.slice(1).map((r) => {
      let amount = parseAmount(r[c.amount]);
      if (c.sign >= 0 && /^(af|d|debet|debit)/i.test(r[c.sign]?.trim() || '')) amount = -Math.abs(amount);
      return { date: parseDate(r[c.date]), amount, counterparty: c.name >= 0 ? r[c.name]?.trim() || '' : '', description: c.desc >= 0 ? r[c.desc]?.trim() || '' : '' };
    }),
  };
}

export function importCsv(text, { accountName } = {}) {
  const parsed = detectAndParse(text);
  const accountKey = parsed.iban || accountName || parsed.format;
  const account = {
    id: id('csv', accountKey),
    name: accountName || (parsed.iban ? `${parsed.format} ${parsed.iban.slice(-4)}` : `${parsed.format}-import`),
    iban: parsed.iban,
    currency: 'EUR',
    bank: parsed.format,
    source: 'csv',
  };
  // Duplicaatdetectie: identieke regels op dezelfde dag krijgen een volgnummer.
  const seen = new Map();
  const transactions = parsed.rows.map((r) => {
    const key = `${r.date}|${r.amount}|${r.counterparty}|${r.description}`;
    const k = (seen.get(key) || 0) + 1;
    seen.set(key, k);
    return { id: id(account.id, key, k), accountId: account.id, date: r.date, amount: Math.round(r.amount * 100) / 100, currency: 'EUR', counterparty: r.counterparty, description: r.description, pending: false, balanceAfter: r.balanceAfter };
  });
  // Saldo afleiden uit "saldo na mutatie" van de meest recente regel, indien aanwezig.
  // Banken exporteren oplopend (Rabobank) of aflopend (ING); neem de laatste regel in tijd.
  const withBalance = transactions.filter((t) => t.balanceAfter !== undefined);
  const ascending = withBalance.length > 1 && withBalance[0].date <= withBalance[withBalance.length - 1].date && withBalance[0].date !== withBalance[withBalance.length - 1].date;
  const latest = ascending ? withBalance[withBalance.length - 1] : withBalance[0];
  if (latest) {
    account.balance = latest.balanceAfter;
    account.balanceDate = `${latest.date}T23:59:59.000Z`;
  }
  for (const t of transactions) delete t.balanceAfter;
  return { format: parsed.format, account, transactions };
}
