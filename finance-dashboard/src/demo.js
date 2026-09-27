// Genereert 12 maanden realistische voorbeelddata zodat je de dashboard direct kunt proberen.
import { id } from './store.js';

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function generateDemo(today = new Date()) {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => Math.round((a + rand() * (b - a)) * 100) / 100;

  const checking = { id: id('demo', 'checking'), name: 'Betaalrekening', iban: 'NL00DEMO0123456789', currency: 'EUR', bank: 'Demobank', source: 'demo' };
  const savings = { id: id('demo', 'savings'), name: 'Spaarrekening', iban: 'NL00DEMO0987654321', currency: 'EUR', bank: 'Demobank', source: 'demo' };
  const tx = [];
  let n = 0;
  const add = (account, date, amount, counterparty, description = '') =>
    tx.push({ id: id('demo', n++), accountId: account.id, date, amount, currency: 'EUR', counterparty, description, pending: false });

  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  for (let m = 0; m < 12; m++) {
    const y = start.getUTCFullYear();
    const mo = start.getUTCMonth() + m;
    const day = (d) => {
      const dt = new Date(Date.UTC(y, mo, d));
      return dt <= today ? dt.toISOString().slice(0, 10) : null;
    };
    const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const on = (d, ...args) => {
      const date = day(d);
      if (date) add(...[args[0], date, ...args.slice(1)]);
    };

    on(24, checking, between(3680, 3760), 'Acme B.V.', 'Salaris');
    if ((mo % 12) === 4) on(24, checking, 2480, 'Acme B.V.', 'Vakantiegeld');
    on(1, checking, -1245, 'Woonbron', 'Huur');
    on(3, checking, -between(128, 142), 'Zilveren Kruis', 'Zorgverzekering premie');
    on(5, checking, -between(135, 175), 'Vattenfall', 'Termijnbedrag energie');
    on(6, checking, -between(24, 29), 'Waternet', 'Drinkwater');
    on(8, checking, -55, 'Ziggo', 'Internet & TV');
    on(9, checking, -18.5, 'Odido', 'Mobiel abonnement');
    on(10, checking, -13.99, 'Netflix', 'Abonnement');
    on(11, checking, -10.99, 'Spotify', 'Premium');
    on(12, checking, -29.99, 'Basic-Fit', 'Lidmaatschap');
    on(15, checking, -between(40, 62), 'Centraal Beheer', 'Inboedel & aansprakelijkheid');
    on(20, checking, -between(95, 115), 'Gemeente Rotterdam', 'Gemeentelijke belastingen');
    on(25, checking, -500, 'Eigen spaarrekening', 'Maandelijks sparen');
    on(25, savings, 500, 'Eigen betaalrekening', 'Maandelijks sparen');

    for (let d = 1; d <= daysInMonth; d++) {
      if (rand() < 0.55) on(d, checking, -between(8, 75), pick(['Albert Heijn', 'Jumbo', 'Lidl', 'Picnic', 'Dirk']), 'Betaalautomaat');
      if (rand() < 0.14) on(d, checking, -between(12, 48), pick(['Thuisbezorgd.nl', 'Starbucks', 'Brasserie De Haven', 'Domino\'s Pizza']), '');
      if (rand() < 0.12) on(d, checking, -between(4, 32), pick(['NS Reizigers', 'Shell', 'Q-Park', 'RET']), '');
      if (rand() < 0.06) on(d, checking, -between(15, 180), pick(['Bol.com', 'Coolblue', 'HEMA', 'IKEA', 'Zalando', 'Action']), '');
      if (rand() < 0.03) on(d, checking, between(8, 45), pick(['J. de Vries', 'S. Bakker']), 'Tikkie betaalverzoek');
      if (rand() < 0.025) on(d, checking, -between(9, 60), pick(['Apotheek Centrum', 'Kruidvat', 'Pathé']), '');
    }
    if (m % 5 === 3) on(14, checking, -between(280, 640), pick(['Booking.com', 'KLM', 'Transavia']), 'Vakantie');
    if (m === 11) on(2, savings, 38.12, 'Demobank', 'Rente');
  }

  const sum = (acc) => tx.filter((t) => t.accountId === acc.id).reduce((s, t) => s + t.amount, 0);
  checking.balance = Math.round((2400 + sum(checking)) * 100) / 100;
  savings.balance = Math.round((8200 + sum(savings)) * 100) / 100;
  checking.balanceDate = savings.balanceDate = today.toISOString();
  return { accounts: [checking, savings], transactions: tx };
}
