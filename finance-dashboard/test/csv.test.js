import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importCsv, parseAmount, parseDate } from '../src/csv.js';
import { categorize, DEFAULT_RULES } from '../src/categorize.js';

test('bedragen en datums in Nederlandse notatie', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('-12,5'), -12.5);
  assert.equal(parseAmount('+7,00'), 7);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseDate('20240131'), '2024-01-31');
  assert.equal(parseDate('31-01-2024'), '2024-01-31');
  assert.equal(parseDate('2024-01-31'), '2024-01-31');
});

test('ING-export (puntkomma, met saldo)', () => {
  const csv = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen";"Saldo na mutatie";"Tag"
"20240302";"Albert Heijn 1234";"NL11INGB0001234567";"";"BA";"Af";"23,45";"Betaalautomaat";"Pasvolgnr: 001";"1976,55";""
"20240301";"Acme B.V.";"NL11INGB0001234567";"NL22RABO0123456789";"OV";"Bij";"2.000,00";"Overschrijving";"Salaris maart";"2000,00";""`;
  const r = importCsv(csv);
  assert.equal(r.format, 'ING');
  assert.equal(r.account.iban, 'NL11INGB0001234567');
  assert.equal(r.transactions.length, 2);
  assert.equal(r.transactions[0].amount, -23.45);
  assert.equal(r.transactions[1].amount, 2000);
  assert.equal(r.account.balance, 1976.55);
});

test('Rabobank-export', () => {
  const csv = `"IBAN/BBAN","Munt","BIC","Volgnr","Datum","Rentedatum","Bedrag","Saldo na trn","Tegenrekening IBAN/BBAN","Naam tegenpartij","Naam uiteindelijke partij","Naam initiërende partij","BIC tegenpartij","Code","Batch ID","Transactiereferentie","Machtigingskenmerk","Incassant ID","Betalingskenmerk","Omschrijving-1","Omschrijving-2","Omschrijving-3"
"NL22RABO0123456789","EUR","RABONL2U","000000000000001","2024-03-01","2024-03-01","-1245,00","+500,00","NL33ABNA0123456789","Woonbron","","","","ei","","","","","","Huur maart","",""
"NL22RABO0123456789","EUR","RABONL2U","000000000000002","2024-03-05","2024-03-05","-55,00","+445,00","","Ziggo","","","","ei","","","","","","Internet","",""`;
  const r = importCsv(csv);
  assert.equal(r.format, 'Rabobank');
  assert.equal(r.transactions[0].counterparty, 'Woonbron');
  assert.equal(r.transactions[0].amount, -1245);
  assert.equal(r.account.balance, 445);
});

test('ABN AMRO TAB-export', () => {
  const tab = '123456789\tEUR\t20240305\t1000,00\t980,00\t20240305\t-20,00\tBEA   NR:XXX   05.03.24/12.00 Jumbo Utrecht,PAS123\n';
  const r = importCsv(tab);
  assert.equal(r.format, 'ABN AMRO');
  assert.equal(r.transactions[0].amount, -20);
  assert.equal(r.account.balance, 980);
});

test('generiek formaat (bunq-achtig)', () => {
  const csv = `"Date";"Interest Date";"Amount";"Account";"Counterparty";"Name";"Description"\n"2024-03-01";"2024-03-01";"-9,99";"NL44BUNQ0123456789";"NL00";"Spotify";"Premium"`;
  const r = importCsv(csv);
  assert.equal(r.format, 'Generiek');
  assert.equal(r.transactions[0].amount, -9.99);
  assert.equal(r.transactions[0].counterparty, 'Spotify');
});

test('dubbele import levert dezelfde ID’s op', () => {
  const csv = 'Datum;Bedrag;Naam\n2024-01-01;-5,00;Lidl\n2024-01-01;-5,00;Lidl';
  const a = importCsv(csv).transactions.map((t) => t.id);
  const b = importCsv(csv).transactions.map((t) => t.id);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], a[1]);
});

test('categorisatie', () => {
  const c = (counterparty, amount, description = '') => categorize({ counterparty, amount, description }, DEFAULT_RULES);
  assert.equal(c('Albert Heijn 1234', -20), 'Boodschappen');
  assert.equal(c('Acme B.V.', 3000, 'Salaris maart'), 'Salaris');
  assert.equal(c('Netflix International', -13.99), 'Abonnementen');
  assert.equal(c('Onbekend', -10), 'Overige uitgaven');
  assert.equal(c('Onbekend', 10), 'Overige inkomsten');
});
