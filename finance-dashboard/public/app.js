// Mijn Financiën — frontend (geen dependencies)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat('nl-NL', { style: 'percent', maximumFractionDigits: 0 });
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const fmtShort = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}M` : a >= 1e3 ? `${(a / 1e3).toLocaleString('nl-NL', { maximumFractionDigits: 1 })}k` : Math.round(a).toString();
  return `${v < 0 ? '−' : ''}€${s}`;
};
const fmtDate = (d) => {
  const [y, m, day] = d.split('-');
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const monthLabel = (ym, withYear) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${withYear ? ` '${ym.slice(2, 4)}` : ''}`;
const iso = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);

const state = {
  data: null,
  status: null,
  period: '12',
  account: 'all',
  category: '',
  search: '',
  limit: 50,
  banks: [],
};
try {
  state.period = localStorage.getItem('fd.period') || state.period;
} catch {}

// ---------- API ----------
async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'finance-dashboard', ...(body && !raw && { 'Content-Type': 'application/json' }) },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') {
    showLogin();
    throw new Error(data.error || 'Niet ingelogd');
  }
  if (!res.ok) throw new Error(data.error || `Fout ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${error ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 7000 : 4000);
}

// ---------- afgeleide data ----------
const transferCats = () => new Set(state.data.transferCategories);
const accountsInScope = () => state.data.accounts.filter((a) => state.account === 'all' || a.id === state.account);
const txInScope = () => state.data.transactions.filter((t) => state.account === 'all' || t.accountId === state.account);

function periodRange() {
  const now = new Date();
  const to = iso(now);
  const first = (y, m) => iso(new Date(y, m, 1));
  switch (state.period) {
    case 'month': return { from: first(now.getFullYear(), now.getMonth()), to };
    case 'prev': return { from: first(now.getFullYear(), now.getMonth() - 1), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
    case 'ytd': return { from: first(now.getFullYear(), 0), to };
    case 'all': {
      const txs = txInScope();
      return { from: txs.length ? txs[txs.length - 1].date : to, to };
    }
    default: return { from: first(now.getFullYear(), now.getMonth() - Number(state.period) + 1), to };
  }
}

function monthsBetween(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// Aantal maanden (fractioneel voor de lopende maand) — voor gemiddelden en budgetten.
function monthSpan(from, to) {
  const d0 = new Date(`${from}T00:00:00Z`);
  const d1 = new Date(`${to}T00:00:00Z`);
  return Math.max(1, Math.round(((d1 - d0) / 864e5 + 1) / 30.44 * 10) / 10);
}

function flows(txs) {
  const tc = transferCats();
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (tc.has(t.category)) continue;
    if (t.amount > 0) income += t.amount;
    else expense -= t.amount;
  }
  return { income, expense, net: income - expense };
}

function allCategories() {
  const set = new Set(state.data.rules.map((r) => r.category));
  for (const t of state.data.transactions) set.add(t.category);
  ['Overige uitgaven', 'Overige inkomsten', 'Overboeking eigen rekening'].forEach((c) => set.add(c));
  return [...set].sort((a, b) => a.localeCompare(b, 'nl'));
}

// ---------- tooltip ----------
const tip = $('#tooltip');
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => (tip.hidden = true);

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// ---------- render: KPI's ----------
function renderKpis(range, txs) {
  const accounts = accountsInScope();
  const withBalance = accounts.filter((a) => Number.isFinite(a.balance));
  const total = withBalance.reduce((s, a) => s + a.balance, 0);
  const f = flows(txs);
  const months = monthSpan(range.from, range.to);
  const rate = f.income > 0 ? f.net / f.income : null;

  $('#kpis').innerHTML = `
    <article class="card kpi">
      <div class="label">Totaal saldo</div>
      <div class="value">${withBalance.length ? eur.format(total) : '—'}</div>
      <ul class="accounts">${accounts
        .map((a) => `<li><span>${esc(a.name)}</span><span>${Number.isFinite(a.balance) ? eur.format(a.balance) : '<span class="muted">onbekend</span>'}</span></li>`)
        .join('')}</ul>
    </article>
    <article class="card kpi">
      <div class="label">Inkomsten</div>
      <div class="value">${eur.format(f.income)}</div>
      <div class="sub">gem. ${eur0.format(f.income / months)} per maand</div>
    </article>
    <article class="card kpi">
      <div class="label">Uitgaven</div>
      <div class="value">${eur.format(f.expense)}</div>
      <div class="sub">gem. ${eur0.format(f.expense / months)} per maand</div>
    </article>
    <article class="card kpi">
      <div class="label">Overgehouden</div>
      <div class="value ${f.net >= 0 ? 'pos' : 'delta down'}">${f.net >= 0 ? '+' : ''}${eur.format(f.net)}</div>
      <div class="sub">${rate === null ? 'geen inkomsten in periode' : `spaarquote <strong class="delta ${rate >= 0 ? 'up' : 'down'}">${pct.format(rate)}</strong> van je inkomen`}</div>
    </article>`;
}

// ---------- render: inkomsten/uitgaven per maand ----------
function renderFlowChart(range) {
  const el = $('#flow-chart');
  let months = monthsBetween(range.from, range.to);
  if (months.length < 6) {
    // Minimaal 6 maanden tonen voor context.
    const d = new Date(`${range.to.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 5);
    months = monthsBetween(d.toISOString().slice(0, 10), range.to);
  }
  if (months.length > 24) months = months.slice(-24);
  const tc = transferCats();
  const byMonth = new Map(months.map((m) => [m, { in: 0, out: 0 }]));
  for (const t of txInScope()) {
    const b = byMonth.get(t.date.slice(0, 7));
    if (!b || tc.has(t.category)) continue;
    if (t.amount > 0) b.in += t.amount;
    else b.out -= t.amount;
  }
  const inPeriod = new Set(monthsBetween(range.from, range.to));

  const W = Math.max(300, el.clientWidth);
  const H = 260;
  const m = { l: 52, r: 8, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1, ...[...byMonth.values()].flatMap((v) => [v.in, v.out]));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1];
  const y = (v) => m.t + ih - (v / top) * ih;
  const band = iw / months.length;
  const barW = Math.max(2, Math.min(22, (band - 8) / 2 - 1));
  const multiYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const labelEvery = Math.ceil(months.length / Math.max(1, Math.floor(iw / 44)));

  const bar = (x, v, cls) => {
    const h = Math.max(0, y(0) - y(v));
    if (h < 0.5) return '';
    const r = Math.min(4, h, barW / 2);
    const yt = y(v);
    return `<path class="bar" fill="var(${cls})" d="M${x},${y(0)} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + barW - r} Q${x + barW},${yt} ${x + barW},${yt + r} V${y(0)} Z"/>`;
  };

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Staafgrafiek van inkomsten en uitgaven per maand">
    <g class="axis">${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join('')}</g>
    ${months
      .map((ym, i) => {
        const v = byMonth.get(ym);
        const cx = m.l + band * i + band / 2;
        const x1 = cx - barW - 1;
        const x2 = cx + 1;
        return `<g class="col" data-i="${i}" style="${inPeriod.has(ym) ? '' : 'opacity:.4'}">
          ${bar(x1, v.in, '--series-1')}${bar(x2, v.out, '--series-2')}
          <rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>
        </g>
        ${i % labelEvery === 0 ? `<text class="axis" x="${cx}" y="${H - 6}" text-anchor="middle" fill="var(--text-3)" style="font-size:11px">${monthLabel(ym, multiYear && (i === 0 || ym.endsWith('-01')))}</text>` : ''}`;
      })
      .join('')}
    <line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>
  </svg>`;

  $('#flow-legend').innerHTML = `<span><i style="background:var(--series-1)"></i>Inkomsten</span><span><i style="background:var(--series-2)"></i>Uitgaven</span>`;

  $$('.col', el).forEach((g) => {
    const ym = months[Number(g.dataset.i)];
    const v = byMonth.get(ym);
    g.addEventListener('mousemove', (e) => {
      el.classList.add('hovering');
      const net = v.in - v.out;
      showTip(e, `<div class="t">${monthLabel(ym)} ${ym.slice(0, 4)}</div>
        <div class="r"><span><i style="background:var(--series-1)"></i>Inkomsten</span><span>${eur.format(v.in)}</span></div>
        <div class="r"><span><i style="background:var(--series-2)"></i>Uitgaven</span><span>${eur.format(v.out)}</span></div>
        <div class="r"><span>Verschil</span><strong>${net >= 0 ? '+' : ''}${eur.format(net)}</strong></div>`);
    });
    g.addEventListener('mouseleave', () => { el.classList.remove('hovering'); hideTip(); });
  });
}

// ---------- render: saldoverloop ----------
function renderBalanceChart(range) {
  const el = $('#balance-chart');
  const accounts = accountsInScope().filter((a) => Number.isFinite(a.balance));
  if (!accounts.length) {
    el.innerHTML = '<p class="muted">Nog geen saldo bekend. Koppel een bank of vul het saldo van je CSV-rekening in bij <em>Rekeningen</em>.</p>';
    return;
  }
  const ids = new Set(accounts.map((a) => a.id));
  const txs = state.data.transactions.filter((t) => ids.has(t.accountId) && !t.pending);
  const current = accounts.reduce((s, a) => s + a.balance, 0);
  const balanceDate = (a) => (a.balanceDate || new Date().toISOString()).slice(0, 10);

  // Saldo op dag d = huidig saldo − alles wat na d is geboekt (tot de saldodatum).
  const days = Math.round((new Date(range.to) - new Date(range.from)) / 864e5);
  const step = days > 400 ? 7 : days > 120 ? 3 : 1;
  const dates = [];
  for (let d = new Date(`${range.to}T00:00:00Z`); iso(d) >= range.from; d.setUTCDate(d.getUTCDate() - step)) dates.unshift(d.toISOString().slice(0, 10));
  if (dates[0] !== range.from) dates.unshift(range.from);
  const sorted = [...txs].sort((a, b) => (a.date < b.date ? 1 : -1)); // nieuwste eerst
  const bdates = new Map(accounts.map((a) => [a.id, balanceDate(a)]));
  const points = [];
  let bal = current;
  let j = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    while (j < sorted.length && sorted[j].date > dates[i]) {
      const t = sorted[j++];
      if (t.date <= bdates.get(t.accountId)) bal -= t.amount;
    }
    points.unshift({ date: dates[i], v: Math.round(bal * 100) / 100 });
  }

  const W = Math.max(300, el.clientWidth);
  const H = 260;
  const m = { l: 56, r: 12, t: 10, b: 26 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const vals = points.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 100;
  lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad;
  const ticks = niceTicks(lo, hi + pad);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = (i) => m.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => m.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1)},${y(y0)}L${x(0)},${y(y0)}Z`;

  const months = monthsBetween(range.from, range.to);
  const everyN = Math.ceil(months.length / Math.max(1, Math.floor(iw / 50)));
  const monthTicks = months
    .map((ym, k) => ({ ym, k, i: points.findIndex((p) => p.date >= `${ym}-01`) }))
    .filter((t) => t.i >= 0 && t.k % everyN === 0 && (t.ym > range.from.slice(0, 7) || range.from.endsWith('-01')));
  const multiYear = months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lijngrafiek van het totale saldo; nu ${esc(eur.format(current))}">
    <defs><linearGradient id="bal-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--series-1)" stop-opacity=".18"/><stop offset="1" stop-color="var(--series-1)" stop-opacity="0"/></linearGradient></defs>
    <g class="axis">${ticks.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmtShort(t)}</text>`).join('')}
    ${monthTicks.map((t) => `<text x="${x(t.i)}" y="${H - 6}" text-anchor="middle">${monthLabel(t.ym, multiYear && (t.ym.endsWith('-01') || t === monthTicks[0]))}</text>`).join('')}</g>
    ${y0 < 0 && y1 > 0 ? `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>` : ''}
    <path d="${area}" fill="url(#bal-fill)" stroke="none"/>
    <path d="${line}" stroke="var(--series-1)" stroke-width="2" fill="none"/>
    <line class="crosshair" id="bal-x" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <circle id="bal-dot" r="4.5" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>
  </svg>`;

  const svg = $('svg', el);
  const hit = $('.hit', el);
  const cross = $('#bal-x', el);
  const dot = $('#bal-dot', el);
  hit.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - m.l) / iw) * (points.length - 1))));
    const p = points[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(p.v));
    dot.setAttribute('visibility', 'visible');
    const diff = p.v - points[0].v;
    showTip(e, `<div class="t">${fmtDate(p.date)}</div><div class="r"><span>Saldo</span><strong>${eur.format(p.v)}</strong></div>
      <div class="r"><span>Sinds begin periode</span><span class="delta ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : ''}${eur.format(diff)}</span></div>`);
  });
  hit.addEventListener('mouseleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTip();
  });
}

// ---------- render: categorieën ----------
function renderCategories(range, txs) {
  const tc = transferCats();
  const totals = new Map();
  for (const t of txs) {
    if (t.amount >= 0 || tc.has(t.category)) continue;
    totals.set(t.category, (totals.get(t.category) || 0) - t.amount);
  }
  const months = monthSpan(range.from, range.to);
  const budgets = state.data.budgets || {};
  for (const c of Object.keys(budgets)) if (!totals.has(c)) totals.set(c, 0);
  const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([c, v]) => Math.max(v, (budgets[c] || 0) * months)));
  const el = $('#categories');
  if (!rows.length) {
    el.innerHTML = '<p class="muted">Geen uitgaven in deze periode.</p>';
    return;
  }
  el.innerHTML = rows
    .map(([cat, v]) => {
      const budget = budgets[cat] ? budgets[cat] * months : 0;
      const over = budget && v > budget;
      return `<button class="cat ${state.category === cat ? 'active' : ''}" data-cat="${esc(cat)}" aria-pressed="${state.category === cat}">
        <span class="name">${esc(cat)}</span>
        <span class="track"><span class="fill" style="width:${(v / max) * 100}%"></span>${budget ? `<span class="budget" style="left:calc(${(budget / max) * 100}% - 1px)" title="Budget"></span>` : ''}</span>
        <span class="amt">${eur0.format(v)}<small class="${over ? 'over' : ''}">${eur0.format(v / months)}/mnd${budget ? ` · budget ${eur0.format(budgets[cat])}` : ''}</small></span>
      </button>`;
    })
    .join('');
  $$('.cat', el).forEach((b) =>
    b.addEventListener('click', () => {
      state.category = state.category === b.dataset.cat ? '' : b.dataset.cat;
      state.limit = 50;
      $('#tx-category').value = state.category;
      renderCategories(range, txs);
      renderTransactions(range);
      if (state.category) $('#tx-body').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }),
  );
}

// ---------- render: vaste lasten ----------
function renderRecurring() {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const cutoff = iso(since);
  const tc = transferCats();
  const groups = new Map();
  for (const t of txInScope()) {
    if (t.date < cutoff || t.amount >= 0 || tc.has(t.category) || !t.counterparty) continue;
    const key = t.counterparty.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!groups.has(key)) groups.set(key, { name: t.counterparty, category: t.category, amounts: [], months: new Set() });
    const g = groups.get(key);
    g.amounts.push(-t.amount);
    g.months.add(t.date.slice(0, 7));
  }
  const rec = [];
  for (const g of groups.values()) {
    if (g.months.size < 3 || g.amounts.length > g.months.size * 2) continue; // max ~2x per maand: vaste last, geen supermarkt
    const mean = g.amounts.reduce((s, v) => s + v, 0) / g.amounts.length;
    const sd = Math.sqrt(g.amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / g.amounts.length);
    if (sd / mean > 0.35) continue;
    rec.push({ ...g, monthly: g.amounts.reduce((s, v) => s + v, 0) / g.months.size });
  }
  rec.sort((a, b) => b.monthly - a.monthly);
  const total = rec.reduce((s, r) => s + r.monthly, 0);
  $('#recurring').innerHTML = rec.length
    ? rec
        .slice(0, 9)
        .map((r) => `<div class="rec"><div>${esc(r.name)}<small>${esc(r.category)}</small></div><div class="num">${eur.format(r.monthly)}</div></div>`)
        .join('') + `<div class="rec"><strong>Totaal vaste lasten</strong><strong>${eur.format(total)} /mnd</strong></div>`
    : '<p class="muted">Nog geen terugkerende afschrijvingen gevonden (minimaal 3 maanden data nodig).</p>';
}

// ---------- render: transacties ----------
function renderTransactions(range) {
  const q = state.search.toLowerCase().trim();
  const accountsById = new Map(state.data.accounts.map((a) => [a.id, a]));
  const list = txInScope().filter((t) => {
    if (t.date < range.from || t.date > range.to) return false;
    if (state.category && t.category !== state.category) return false;
    if (!q) return true;
    return `${t.counterparty} ${t.description} ${t.category} ${t.amount.toFixed(2).replace('.', ',')}`.toLowerCase().includes(q);
  });
  const cats = allCategories();
  const catOptions = (sel) => cats.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const multiAccount = state.account === 'all' && state.data.accounts.length > 1;
  $('#tx-count').textContent = `(${list.length})`;
  $('#tx-body').innerHTML = list.length
    ? list
        .slice(0, state.limit)
        .map(
          (t) => `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><div class="cp">${esc(t.counterparty || t.description.slice(0, 50) || '—')}${t.pending ? '<span class="tag">in behandeling</span>' : ''}${multiAccount ? `<span class="tag">${esc(accountsById.get(t.accountId)?.name)}</span>` : ''}</div>
          <div class="desc" title="${esc(t.description)}">${esc(t.description)}</div></td>
        <td><select data-id="${t.id}" aria-label="Categorie">${catOptions(t.category)}<option value="__new">+ Nieuwe categorie…</option></select></td>
        <td class="num ${t.amount > 0 ? 'pos' : ''}">${t.amount > 0 ? '+' : ''}${eur.format(t.amount)}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="muted">Geen transacties gevonden.</td></tr>`;
  $('#tx-more').hidden = list.length <= state.limit;
}

function renderFilters() {
  const accSel = $('#account-filter');
  accSel.innerHTML = `<option value="all">Alle rekeningen</option>${state.data.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}${a.iban ? ` · ${esc(a.iban.slice(-4))}` : ''}</option>`).join('')}`;
  if (!state.data.accounts.some((a) => a.id === state.account)) state.account = 'all';
  accSel.value = state.account;
  $('#tx-category').innerHTML = `<option value="">Alle categorieën</option>${allCategories().map((c) => `<option>${esc(c)}</option>`).join('')}`;
  $('#tx-category').value = state.category;
  $$('#period button').forEach((b) => b.classList.toggle('active', b.dataset.period === state.period));
  $('#sync-btn').hidden = !state.data.connections.length;
}

function render() {
  const hasData = state.data.transactions.length > 0 || state.data.accounts.length > 0;
  $('#empty').hidden = hasData;
  $('#dashboard').hidden = !hasData;
  renderFilters();
  if (!hasData) return;
  const range = periodRange();
  const txs = txInScope().filter((t) => t.date >= range.from && t.date <= range.to);
  renderKpis(range, txs);
  renderFlowChart(range);
  renderBalanceChart(range);
  renderCategories(range, txs);
  renderRecurring();
  renderTransactions(range);
}

async function reload() {
  state.data = await api('/api/data');
  render();
  if ($('#manage').open) renderManage();
}

// ---------- beheer ----------
function renderManage() {
  const d = state.data;
  const providers = state.status.providers;
  const configured = providers.filter((p) => p.configured);
  const provSel = $('#provider');
  const prev = provSel.value;
  provSel.innerHTML = providers.map((p) => `<option value="${p.id}" ${p.configured ? '' : 'disabled'}>${esc(p.label)}${p.configured ? '' : ' (niet ingesteld)'}</option>`).join('');
  provSel.value = configured.some((p) => p.id === prev) ? prev : configured[0]?.id || '';
  const warn = $('#provider-warning');
  warn.hidden = configured.length > 0;
  warn.innerHTML = `<strong>Nog geen koppeldienst ingesteld.</strong> Maak een gratis account bij <a href="https://enablebanking.com/" target="_blank" rel="noopener">Enable Banking</a> of <a href="https://bankaccountdata.gocardless.com/" target="_blank" rel="noopener">GoCardless Bank Account Data</a>, zet de sleutels in <code>.env</code> en herstart de server. Zie de README voor een stappenplan. Tot die tijd kun je CSV-bestanden importeren.`;
  $('#bank-search').disabled = !configured.length;

  const now = Date.now();
  $('#connections').innerHTML = d.connections.length
    ? d.connections
        .map((c) => {
          const days = c.validUntil ? Math.ceil((new Date(c.validUntil) - now) / 864e5) : null;
          const expiring = days !== null && days <= 14;
          return `<li><div class="grow"><strong>${esc(c.bank)}</strong>
            <span class="meta">${esc(providers.find((p) => p.id === c.provider)?.label || c.provider)} · laatst gesynchroniseerd ${c.lastSync ? new Date(c.lastSync).toLocaleString('nl-NL') : 'nooit'}</span>
            ${days !== null ? `<span class="${expiring ? 'err' : 'meta'}">${days > 0 ? `Toestemming geldig nog ${days} dagen` : 'Toestemming verlopen'}${expiring ? ' — koppel opnieuw via de lijst hierboven' : ''}</span>` : ''}</div>
            <button class="btn danger" data-del-conn="${c.id}">Ontkoppelen</button></li>`;
        })
        .join('')
    : '<li class="muted">Nog geen banken gekoppeld.</li>';

  $('#accounts').innerHTML = d.accounts.length
    ? d.accounts
        .map(
          (a) => `<li><div class="grow">
            <input value="${esc(a.name)}" data-rename="${a.id}" aria-label="Naam rekening">
            <span class="meta">${esc(a.bank)} · ${esc(a.iban || 'geen IBAN')} · ${a.source === 'csv' ? 'CSV-import' : a.source === 'demo' ? 'demo' : 'bankkoppeling'} · ${d.transactions.filter((t) => t.accountId === a.id).length} transacties</span>
            ${a.error ? `<span class="err">${esc(a.error)}</span>` : ''}
            ${a.source === 'csv' ? `<label>Huidig saldo <input type="number" step="0.01" value="${Number.isFinite(a.balance) ? a.balance : ''}" data-balance="${a.id}" placeholder="bijv. 1234,56"></label>` : `<span class="meta">Saldo: ${Number.isFinite(a.balance) ? eur.format(a.balance) : 'onbekend'}</span>`}
          </div><button class="btn danger" data-del-acc="${a.id}">Verwijderen</button></li>`,
        )
        .join('')
    : '<li class="muted">Nog geen rekeningen.</li>';

  // Budgetten: gemiddelde van de laatste 3 volledige maanden als hulp.
  const now2 = new Date();
  const from = iso(new Date(now2.getFullYear(), now2.getMonth() - 3, 1));
  const to = iso(new Date(now2.getFullYear(), now2.getMonth(), 0));
  const tc = transferCats();
  const avg = new Map();
  for (const t of d.transactions) {
    if (t.date < from || t.date > to || t.amount >= 0 || tc.has(t.category)) continue;
    avg.set(t.category, (avg.get(t.category) || 0) - t.amount / 3);
  }
  const cats = allCategories().filter((c) => !tc.has(c) && !/inkomsten|salaris|toeslagen/i.test(c));
  $('#budget-form').innerHTML = cats
    .map((c) => `<div class="b"><span>${esc(c)}</span><input type="number" min="0" step="10" name="${esc(c)}" value="${d.budgets[c] ?? ''}" placeholder="—" aria-label="Budget ${esc(c)}"><span class="avg">gem. ${eur0.format(avg.get(c) || 0)}/mnd</span></div>`)
    .join('') + '<div class="row"><button class="btn primary" type="submit">Budgetten opslaan</button></div>';

  renderRules();
  $('#logout-btn').hidden = !state.status.authRequired;
}

function renderRules() {
  $('#rules').innerHTML = state.data.rules
    .map(
      (r, i) => `<div class="rule" data-i="${i}" data-sign="${r.sign || ''}">
      <input value="${esc(r.match)}" aria-label="Patroon" data-f="match">
      <input value="${esc(r.category)}" aria-label="Categorie" data-f="category" list="cat-list">
      <button class="btn ghost icon" data-del-rule="${i}" aria-label="Verwijder regel" type="button">✕</button></div>`,
    )
    .join('') + `<datalist id="cat-list">${allCategories().map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
}

function collectRules() {
  return $$('#rules .rule')
    .map((row) => ({
      match: $('[data-f=match]', row).value.trim(),
      category: $('[data-f=category]', row).value.trim(),
      ...(row.dataset.sign && { sign: row.dataset.sign }),
    }))
    .filter((r) => r.match && r.category);
}

async function loadBanks() {
  const provider = $('#provider').value;
  const list = $('#bank-list');
  if (!provider) { list.innerHTML = ''; return; }
  list.innerHTML = '<li class="muted" style="padding:8px 12px">Banken laden…</li>';
  try {
    state.banks = await api(`/api/banks?provider=${provider}&country=${$('#country').value}`);
    renderBanks();
  } catch (err) {
    list.innerHTML = `<li class="error" style="padding:8px 12px">${esc(err.message)}</li>`;
  }
}

function renderBanks() {
  const q = $('#bank-search').value.toLowerCase();
  const banks = state.banks.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 80);
  $('#bank-list').innerHTML = banks.length
    ? banks.map((b) => `<li><button data-bank="${esc(b.id)}">${b.logo ? `<img src="${esc(b.logo)}" alt="" loading="lazy">` : ''}<span>${esc(b.name)}</span></button></li>`).join('')
    : '<li class="muted" style="padding:8px 12px">Geen banken gevonden.</li>';
}

async function uploadFiles(files) {
  const out = $('#import-result');
  out.innerHTML = '';
  for (const file of files) {
    try {
      const name = $('#import-name').value.trim();
      const r = await api(`/api/import${name ? `?account=${encodeURIComponent(name)}` : ''}`, { method: 'POST', body: await file.arrayBuffer(), raw: true });
      out.insertAdjacentHTML('beforeend', `<p class="notice" style="border-color:var(--good)">✓ ${esc(file.name)}: ${esc(r.format)}-formaat, ${r.added} nieuwe van ${r.total} transacties → <strong>${esc(r.account)}</strong></p>`);
    } catch (err) {
      out.insertAdjacentHTML('beforeend', `<p class="notice" style="border-color:var(--bad)">✕ ${esc(file.name)}: ${esc(err.message)}</p>`);
    }
  }
  await reload();
}

function openManage(tab = 'connect') {
  renderManage();
  switchTab(tab);
  if (!$('#manage').open) $('#manage').showModal();
  if (tab === 'connect' && $('#provider').value && !state.banks.length) loadBanks();
}

function switchTab(tab) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab').forEach((p) => (p.hidden = p.dataset.panel !== tab));
}

// ---------- events ----------
function bind() {
  $$('#period button').forEach((b) =>
    b.addEventListener('click', () => {
      state.period = b.dataset.period;
      state.limit = 50;
      try { localStorage.setItem('fd.period', state.period); } catch {}
      render();
    }),
  );
  $('#account-filter').addEventListener('change', (e) => { state.account = e.target.value; render(); });
  $('#tx-search').addEventListener('input', (e) => { state.search = e.target.value; state.limit = 50; renderTransactions(periodRange()); });
  $('#tx-category').addEventListener('change', (e) => {
    state.category = e.target.value;
    state.limit = 50;
    const range = periodRange();
    renderCategories(range, txInScope().filter((t) => t.date >= range.from && t.date <= range.to));
    renderTransactions(range);
  });
  $('#tx-more').addEventListener('click', () => { state.limit += 100; renderTransactions(periodRange()); });

  $('#tx-body').addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-id]');
    if (!sel) return;
    let category = sel.value;
    if (category === '__new') {
      category = prompt('Naam van de nieuwe categorie:')?.trim();
      if (!category) { render(); return; }
    }
    try {
      const r = await api(`/api/transactions/${sel.dataset.id}`, { method: 'PATCH', body: { category, createRule: $('#learn').checked } });
      toast(r.updated > 1 ? `${r.updated} transacties bijgewerkt naar “${category}”` : `Categorie gewijzigd naar “${category}”`);
      await reload();
    } catch (err) { toast(err.message, true); }
  });

  $('#sync-btn').addEventListener('click', async () => {
    const btn = $('#sync-btn');
    btn.disabled = true;
    btn.classList.add('spinning');
    try {
      const { report } = await api('/api/sync', { method: 'POST' });
      const errors = report.filter((r) => r.error);
      const added = report.reduce((s, r) => s + (r.added || 0), 0);
      toast(errors.length ? `${errors[0].bank}: ${errors[0].error}` : `Bijgewerkt — ${added} nieuwe transactie${added === 1 ? '' : 's'}`, errors.length > 0);
      await reload();
    } catch (err) { toast(err.message, true); }
    btn.disabled = false;
    btn.classList.remove('spinning');
  });

  $('#manage-btn').addEventListener('click', () => openManage());
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => openManage(b.dataset.open)));
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    switchTab(b.dataset.tab);
    if (b.dataset.tab === 'connect' && $('#provider').value && !state.banks.length) loadBanks();
  }));
  $('#manage').addEventListener('click', (e) => { if (e.target === $('#manage')) $('#manage').close(); });

  const loadDemo = async () => {
    await api('/api/demo', { method: 'POST' });
    toast('Demodata geladen');
    await reload();
  };
  $('#demo-btn').addEventListener('click', loadDemo);
  $('#demo-btn-2').addEventListener('click', loadDemo);
  $('#reset-btn').addEventListener('click', async () => {
    if (!confirm('Weet je zeker dat je alle rekeningen, transacties, koppelingen en instellingen wilt wissen?')) return;
    await api('/api/data', { method: 'DELETE' });
    $('#manage').close();
    toast('Alle gegevens gewist');
    await reload();
  });
  $('#logout-btn').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.reload(); });

  $('#provider').addEventListener('change', () => { state.banks = []; loadBanks(); });
  $('#country').addEventListener('change', () => { state.banks = []; loadBanks(); });
  $('#bank-search').addEventListener('input', renderBanks);
  $('#bank-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-bank]');
    if (!b) return;
    b.disabled = true;
    try {
      const { url } = await api('/api/connect', { method: 'POST', body: { provider: $('#provider').value, bank: b.dataset.bank, country: $('#country').value } });
      location.href = url; // door naar de inlogpagina van je bank
    } catch (err) {
      toast(err.message, true);
      b.disabled = false;
    }
  });

  $('#manage').addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.delConn && confirm('Bank ontkoppelen? De bijbehorende rekeningen en transacties worden verwijderd.')) {
        await api(`/api/connections/${t.dataset.delConn}`, { method: 'DELETE' });
        await reload();
      } else if (t.dataset.delAcc && confirm('Rekening en alle transacties verwijderen?')) {
        await api(`/api/accounts/${t.dataset.delAcc}`, { method: 'DELETE' });
        await reload();
      } else if (t.dataset.delRule) {
        const rules = collectRules();
        rules.splice(Number(t.dataset.delRule), 1);
        state.data.rules = rules;
        renderRules();
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#manage').addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.rename) {
        await api(`/api/accounts/${t.dataset.rename}`, { method: 'PATCH', body: { name: t.value } });
        await reload();
      } else if (t.dataset.balance) {
        const v = Number(String(t.value).replace(',', '.'));
        if (t.value !== '' && Number.isFinite(v)) {
          await api(`/api/accounts/${t.dataset.balance}`, { method: 'PATCH', body: { balance: v } });
          toast('Saldo opgeslagen');
          await reload();
        }
      }
    } catch (err) { toast(err.message, true); }
  });

  $('#rule-add').addEventListener('click', () => {
    state.data.rules = [{ match: '', category: '' }, ...collectRules()];
    renderRules();
    $('#rules input').focus();
  });
  $('#rules-save').addEventListener('click', async () => {
    try {
      await api('/api/rules', { method: 'PUT', body: { rules: collectRules() } });
      toast('Regels opgeslagen, transacties opnieuw gecategoriseerd');
      await reload();
    } catch (err) { toast(err.message, true); }
  });
  $('#budget-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const budgets = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v !== ''));
    await api('/api/budgets', { method: 'PUT', body: { budgets } });
    toast('Budgetten opgeslagen');
    await reload();
  });

  const dz = $('#dropzone');
  $('#import-file').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
      start();
    } catch (err) { $('#login-error').textContent = err.message; }
  });

  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.data && !$('#dashboard').hidden && render(), 150);
  });
}

function showLogin() {
  $('#login').hidden = false;
  $('#app').hidden = true;
}

async function start() {
  state.status = await api('/api/status');
  if (!state.status.authed) return showLogin();
  $('#login').hidden = true;
  $('#app').hidden = false;
  await reload();

  const params = new URLSearchParams(location.search);
  if (params.has('connected')) toast(params.get('connected'));
  if (params.has('error')) toast(params.get('error'), true);
  if (params.size) history.replaceState(null, '', location.pathname);
}

bind();
start().catch((err) => toast(err.message, true));
