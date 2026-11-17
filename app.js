/* Climbing log: static site. All data comes from data.json, which is updated after each session. */
(() => {
'use strict';

const TRAIN = ['Finger', 'Board', 'Pull', 'Weakness'];
const HEAVY = ['Finger', 'Board'];
const TYPES = [...TRAIN, 'Stretching'];
const DAY = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- small helpers ---------- */
const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const toUTC = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoOf = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(toUTC(iso) + n * DAY);
const diffDays = (a, b) => Math.round((toUTC(a) - toUTC(b)) / DAY);
const pad = n => String(n).padStart(2, '0');
const localISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt = iso => { const t = new Date(toUTC(iso)); return `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MO[t.getUTCMonth()]}`; };
const fmtLong = iso => { const t = new Date(toUTC(iso)); return `${t.getUTCDate()} ${MO[t.getUTCMonth()]} ${t.getUTCFullYear()}`; };
const kg = v => (Math.round(v * 10 + 1e-6) / 10).toFixed(1);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const sinceText = n => n == null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;

const params = new URLSearchParams(location.search);
const state = { data: null, today: params.get('today') || localISO(), tab: 'today', sub: null };

function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  return null;
}

/* ---------- session logic ---------- */
function stateAt(data, day) {
  const out = {};
  for (const t of TYPES) {
    const mine = data.sessions.filter(x => x.type === t && x.date <= day);
    const last = mine.length ? mine.map(x => x.date).sort().pop() : null;
    out[t] = {
      type: t, last,
      count7: mine.filter(x => diffDays(day, x.date) < 7).length,
      target: data.targets[t],
      since: last == null ? null : diffDays(day, last),
    };
  }
  return out;
}

function statusFor(t, st, day) {
  const x = st[t];
  if (x.count7 >= x.target) return { kind: 'done' };
  if (HEAVY.includes(t)) {
    const other = st[t === 'Finger' ? 'Board' : 'Finger'];
    if (other.last && diffDays(day, other.last) < 2) return { kind: 'wait', until: addDays(other.last, 2), after: other.type };
  }
  return { kind: 'go' };
}

function recommend(data, today, readiness) {
  const todays = data.sessions.filter(x => x.date === today);
  const trainedToday = todays.some(x => x.type !== 'Stretching');
  const day = trainedToday ? addDays(today, 1) : today;
  const st = stateAt(data, day);
  const status = Object.fromEntries(TRAIN.map(t => [t, statusFor(t, st, day)]));
  const open = TRAIN.filter(t => status[t].kind === 'go');
  const yest = addDays(day, -1);
  const heavyYest = HEAVY.find(t => data.sessions.some(x => x.date === yest && x.type === t));
  const light = !trainedToday && readiness != null && readiness <= 2;
  let pick = null;
  const why = [];

  if (light) {
    pick = open.includes('Weakness') ? 'Weakness' : (st.Stretching.count7 < st.Stretching.target ? 'Stretching' : null);
    why.push(`You rated today ${readiness} out of 5, so keep it light.`);
  } else if (heavyYest && open.includes('Weakness')) {
    pick = 'Weakness';
    why.push(`Light day after ${heavyYest} on ${fmt(yest)}.`);
  } else if (open.length) {
    pick = open
      .map(t => ({ t, since: st[t].last == null ? Infinity : diffDays(day, st[t].last) }))
      .sort((a, b) => (b.since - a.since) || (TRAIN.indexOf(a.t) - TRAIN.indexOf(b.t)))[0].t;
    why.push(st[pick].last == null
      ? `You haven't logged ${pick} yet.`
      : `Last logged ${fmt(st[pick].last)}, ${sinceText(diffDays(day, st[pick].last))}.`);
  }
  if (!pick) why.unshift(light ? '' : 'Every session is done for the week or waiting on a gap.');
  for (const t of HEAVY) if (status[t].kind === 'wait' && pick !== t) why.push(`${t} is free again on ${fmt(status[t].until)}.`);

  return {
    title: pick || 'Rest or stretch',
    ring: pick ? 'go' : 'rest',
    kicker: trainedToday ? `Tomorrow, ${fmt(day)}` : `Today, ${fmt(day)}`,
    trainedToday,
    why: why.filter(Boolean).join(' '),
    logged: [...new Set(todays.map(x => x.type))],
  };
}

/* ---------- shared pieces ---------- */
function ringIcon(kind, size) {
  const color = kind === 'go' ? 'var(--good)' : kind === 'wait' ? 'var(--warn)' : 'var(--muted)';
  const c = s('svg', { viewBox: '0 0 48 48', width: size, height: size, 'aria-hidden': 'true' },
    s('circle', { cx: 24, cy: 24, r: 19, fill: 'none', stroke: color, 'stroke-width': 5 }));
  if (kind === 'go') c.append(s('circle', { cx: 24, cy: 24, r: 7, fill: color }));
  if (kind === 'wait') c.append(s('path', { d: 'M24 12.5v11.5l7.5 4.5', fill: 'none', stroke: color, 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if (kind === 'done') c.append(s('path', { d: 'M15.5 24.5l6 6 11-12.5', fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 4.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return c;
}

function section(title, sub, ...kids) {
  return h('section', { class: 'section' }, h('h2', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, ...kids);
}

/* ---------- Today ---------- */
function getReadiness(today) {
  const v = store('readiness:' + today);
  const n = v == null ? null : Number(v);
  return n >= 1 && n <= 5 ? n : null;
}

function renderToday() {
  const { data, today } = state;
  const readiness = getReadiness(today);
  const rec = recommend(data, today, readiness);
  const root = h('div');

  root.append(h('section', { class: 'hero' },
    h('p', { class: 'kicker' }, rec.kicker),
    h('h1', { class: 'hero-title' }, ringIcon(rec.ring, 46), rec.title),
    h('p', { class: 'hero-why' }, rec.why),
    rec.logged.length ? h('p', { class: 'hero-logged' }, `Logged today: ${rec.logged.join(', ')}.`) : null));

  if (!rec.trainedToday) {
    const group = h('div', { class: 'scale', role: 'radiogroup', 'aria-label': 'Readiness today, 1 to 5' });
    for (let i = 1; i <= 5; i++) {
      group.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': readiness === i ? 'true' : 'false', 'aria-label': `${i} out of 5`,
        onclick: () => { store('readiness:' + today, readiness === i ? '' : String(i)); mount(); },
      }, String(i)));
    }
    root.append(h('div', { class: 'ask' },
      h('p', { class: 'ask-label' }, 'How ready do you feel?'),
      h('p', { class: 'ask-hint' }, '1 is wrecked, 5 is fresh. A 1 or 2 makes today a light day.'),
      group));
  }
  root.append(h('button', { type: 'button', class: 'btn primary block cta', onclick: () => Log.sessionSheet({
    today, readiness, suggested: TYPES.includes(rec.title) ? rec.title : 'Stretching',
  }) }, 'Log a session'));

  // queue
  const st = stateAt(data, today);
  const rows = TRAIN.map(t => ({ t, st: st[t], status: statusFor(t, st, today) }));
  const rank = { go: 0, wait: 1, done: 2 };
  rows.sort((a, b) => rank[a.status.kind] - rank[b.status.kind]
    || (b.st.since ?? 1e9) - (a.st.since ?? 1e9) || TRAIN.indexOf(a.t) - TRAIN.indexOf(b.t));
  rows.push({ t: 'Stretching', st: st.Stretching, status: { kind: st.Stretching.count7 >= st.Stretching.target ? 'done' : 'go' } });
  const queue = h('ul', { class: 'queue' });
  for (const r of rows) {
    const k = r.status.kind;
    const label = k === 'go' ? 'Go' : k === 'wait' ? `Wait until ${fmt(r.status.until)}` : 'Done this week';
    const filled = Math.min(r.st.count7, r.st.target);
    queue.append(h('li', {},
      h('span', { class: 'ico' }, ringIcon(k, 26)),
      h('span', { class: 'name' }, r.t),
      h('span', { class: `state ${k}` }, label),
      h('span', { class: 'since' }, r.st.since == null ? 'Not logged yet' : `Last done ${sinceText(r.st.since)}`),
      h('span', { class: 'dots', 'aria-label': `${filled} of ${r.st.target} this week` }, '●'.repeat(filled) + '○'.repeat(r.st.target - filled))));
  }
  root.append(section('This week', 'Finger and Board need two days between them. A week is the last 7 days.', queue));

  // recent sessions, newest first
  const recent = [...data.sessions].filter(x => x.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (recent.length) {
    const list = h('ul', { class: 'recent' });
    for (const x of recent) {
      const extra = [x.title && x.title !== x.type ? x.title : null, x.readiness ? `readiness ${x.readiness}` : null].filter(Boolean).join(', ');
      list.append(h('li', {},
        h('span', { class: 'rt' }, `${x.type}, ${fmt(x.date)}`),
        extra ? h('span', { class: 'rm' }, extra) : null,
        x.id ? Log.confirmButton('Remove', 'Tap again to remove', () => Log.submit([{ id: 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), op: 'deleteSession', at: localISO(), target: x.id }])) : null));
    }
    root.append(section('Recent sessions', 'Logged one by mistake? Remove it here.', list));
  }

  // figures
  const trainingDates = data.sessions.filter(x => x.type !== 'Stretching').map(x => x.date);
  const in7 = trainingDates.filter(d => diffDays(today, d) < 7 && diffDays(today, d) >= 0).length;
  const in30 = trainingDates.filter(d => diffDays(today, d) < 30 && diffDays(today, d) >= 0).length;
  const climbs = data.lists.flatMap(l => l.climbs);
  const sent = climbs.filter(c => c.sent).length;
  root.append(section('Training load', null, h('div', { class: 'figs' },
    h('div', { class: 'fig' }, h('b', {}, String(in7)), h('span', {}, plural(in7, 'session', 'sessions') + ' in the last 7 days')),
    h('div', { class: 'fig' }, h('b', {}, String(in30)), h('span', {}, plural(in30, 'session', 'sessions') + ' in the last 30 days')),
    h('div', { class: 'fig' }, h('b', {}, `${sent}/${climbs.length}`), h('span', {}, 'list climbs sent')))));

  root.append(section('Last 8 weeks', null, activityGrid(data, today)));
  return root;
}

function activityGrid(data, today) {
  const t = new Date(toUTC(today));
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -dow - 49);
  const CW = 34, RH = 26, LX = 16, TY = 20;
  const W = LX + 8 * CW, H = TY + 7 * RH;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
    'aria-label': 'Calendar of the last 8 weeks. Filled circles are training days, rings are stretching only.' });
  svg.style.maxWidth = '420px';
  svg.style.display = 'block';
  ['M', 'W', 'F'].forEach((d, i) => svg.append(s('text', { x: 0, y: TY + (i * 2) * RH + 8 + 4, fill: 'var(--muted)', 'font-size': 11, 'font-family': 'var(--font)' }, d)));
  let lastMonth = -1;
  for (let w = 0; w < 8; w++) {
    const wk = addDays(start, w * 7);
    const m = new Date(toUTC(wk)).getUTCMonth();
    if (m !== lastMonth) {
      svg.append(s('text', { x: LX + w * CW + 11, y: 10, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11, 'font-family': 'var(--font)' }, MO[m]));
      lastMonth = m;
    }
    for (let d = 0; d < 7; d++) {
      const iso = addDays(start, w * 7 + d);
      if (iso > today) continue;
      const cx = LX + w * CW + 11, cy = TY + d * RH + 8;
      const ses = data.sessions.filter(x => x.date === iso);
      const train = ses.filter(x => x.type !== 'Stretching');
      let mark;
      if (train.length) mark = s('circle', { cx, cy, r: 8.5, fill: 'var(--ink)' });
      else if (ses.length) mark = s('circle', { cx, cy, r: 7.5, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 });
      else mark = s('circle', { cx, cy, r: 2.5, fill: 'var(--axis)' });
      mark.append(s('title', {}, `${fmt(iso)}: ${ses.length ? [...new Set(ses.map(x => x.type))].join(', ') : 'no session'}`));
      svg.append(mark);
      if (iso === today) svg.append(s('circle', { cx, cy, r: 12, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2 }));
    }
  }
  const key = (node, text) => h('span', {}, node, text);
  const swatch = (inner) => { const v = s('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' }, inner); v.style.verticalAlign = '-3px'; v.style.marginRight = '6px'; return v; };
  return h('div', {}, svg, h('div', { class: 'legend' },
    key(swatch(s('circle', { cx: 8, cy: 8, r: 6, fill: 'var(--ink)' })), 'Training'),
    key(swatch(s('circle', { cx: 8, cy: 8, r: 5.5, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2 })), 'Stretching only'),
    key(swatch(s('circle', { cx: 8, cy: 8, r: 6.5, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2 })), 'Today')));
}

/* ---------- Strength ---------- */
function tests20(data) {
  return data.strength.filter(x => x.type === '20mm half crimp').map(x => {
    const [hh, mm] = x.time ? x.time.split(':').map(Number) : [12, 0];
    return { ...x, t: toUTC(x.date) + (hh * 60 + mm) * 60000, gap: (x.right - x.left) / x.right * 100 };
  }).sort((a, b) => a.t - b.t);
}

function slope(rows, key) { // kg per month, least squares
  const n = rows.length;
  const xs = rows.map(r => r.t / (DAY * 30.4375)), ys = rows.map(r => r[key]);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return num / den;
}

function renderStrength() {
  const { data } = state;
  const bw = data.athlete.bodyweight;
  const rows = tests20(data);
  const last = rows[rows.length - 1];
  const root = h('div');
  root.append(h('section', { class: 'section' },
    h('h2', {}, '20mm half crimp'),
    h('p', { class: 'sub' }, `Latest test ${fmtLong(last.date)}. Goal: ${data.athlete.goal.toLowerCase()}, about ${bw} kg of pull.`),
    h('button', { type: 'button', class: 'btn block cta', onclick: () => Log.testSheet({ today: state.today }) }, 'Add a Tindeq test')));

  const hands = h('div', { class: 'hands' });
  for (const [side, cls, key] of [['Right hand', 's1', 'right'], ['Left hand', 's2', 'left']]) {
    const now = last[key];
    const best = rows.reduce((a, b) => (b[key] > a[key] ? b : a));
    const vsBest = (now / best[key] - 1) * 100;
    const toGo = bw - now;
    const meter = h('div', { class: 'meter', role: 'img', 'aria-label': `${side}: ${Math.round(now / bw * 100)}% of bodyweight, best ${Math.round(best[key] / bw * 100)}%` },
      h('div', { class: `fill ${cls}`, style: `width:${Math.min(100, now / bw * 100)}%` }),
      h('div', { class: 'best', style: `left:calc(${Math.min(100, best[key] / bw * 100)}% - 1px)` }));
    hands.append(h('div', { class: 'hand' },
      h('div', { class: 'who' }, h('i', { class: `key ${cls}` }), side),
      h('div', { class: 'big' }, kg(now), h('small', {}, 'kg')),
      h('div', { class: 'pct' }, `${Math.round(now / bw * 100)}% of bodyweight`),
      meter,
      h('dl', {},
        h('dd', {}, 'Best ', h('b', {}, `${kg(best[key])} kg`), `, ${fmtLong(best.date)}`),
        h('dd', {}, h('b', {}, `${vsBest >= 0 ? '+' : '−'}${Math.abs(vsBest).toFixed(1)}%`), ' vs best'),
        h('dd', {}, h('b', {}, `${kg(Math.max(0, toGo))} kg`), ' to bodyweight'))));
  }
  root.append(hands);
  root.append(h('p', { class: 'foot' }, 'The line on each bar marks that hand’s best test.'));

  // trend chart
  const chartBox = h('div', { class: 'chart', tabindex: '0', role: 'group', 'aria-label': 'Line chart of right and left hand max pull over time. A table version is available below.' });
  const tableWrap = h('div', { hidden: true });
  tableWrap.append(dataTable(rows));
  const toggle = h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'false', onclick: () => {
    const on = tableWrap.hidden;
    tableWrap.hidden = !on; chartBox.hidden = on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Show chart' : 'Show table';
  } }, 'Show table');
  const sr = slope(rows, 'right'), sl = slope(rows, 'left');
  const sgn = v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
  root.append(h('div', { class: 'card' },
    h('h3', {}, 'Max pull over time'),
    h('p', { class: 'sub' }, 'Tindeq peak force, one point per test'),
    h('div', { class: 'legend-row' },
      h('span', {}, h('i', { class: 'key s1' }), 'Right hand'),
      h('span', {}, h('i', { class: 'key s2' }), 'Left hand')),
    chartBox, tableWrap, toggle,
    h('p', { class: 'foot' }, `A straight line through every test moves ${sgn(sr)} kg a month on the right and ${sgn(sl)} kg a month on the left. Single tests swing with how fresh you were, so judge direction over several.`)));
  mountLineChart(chartBox, rows, bw);

  // gap chart
  const gapBox = h('div', { class: 'chart', tabindex: '0', role: 'group', 'aria-label': 'Bar chart of how far the left hand is behind the right, per test.' });
  const now = last.gap;
  root.append(h('div', { class: 'card' },
    h('h3', {}, 'Left hand behind right'),
    h('p', { class: 'sub' }, `${now.toFixed(1)}% behind on the latest test. Lower is more even.`),
    gapBox));
  mountGapChart(gapBox, rows);

  // pinch
  const pinches = data.strength.filter(x => x.type === 'Pinch block').sort((a, b) => a.date.localeCompare(b.date));
  if (pinches.length) {
    const p = pinches[pinches.length - 1], prev = pinches[pinches.length - 2];
    const chg = (a, b) => { const v = (a / b - 1) * 100; return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`; };
    root.append(h('section', { class: 'section' },
      h('h2', {}, 'Pinch block'),
      h('p', { class: 'sub' }, prev
        ? `One-hand max, ${fmtLong(p.date)}. Since ${fmtLong(prev.date)}: ${chg(p.right, prev.right)} right, ${chg(p.left, prev.left)} left.`
        : `One-hand max, ${fmtLong(p.date)}. Retest to see the trend.`),
      h('div', { class: 'figs', style: 'grid-template-columns:1fr 1fr' },
        h('div', { class: 'fig' }, h('b', {}, `${kg(p.right)} kg`), h('span', {}, 'Right hand')),
        h('div', { class: 'fig' }, h('b', {}, `${kg(p.left)} kg`), h('span', {}, 'Left hand')))));
  }
  return root;
}

function dataTable(rows) {
  const t = h('table', { class: 'data' },
    h('caption', { class: 'sub', style: 'text-align:left;caption-side:top' }, 'Max pull, 20mm half crimp (kg)'),
    h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'n' }, 'Right'), h('th', { class: 'n' }, 'Left'), h('th', {}, 'Note'))));
  const body = h('tbody');
  for (const r of [...rows].reverse()) {
    body.append(h('tr', {}, h('td', {}, fmtLong(r.date) + (r.time ? ` ${r.time}` : '')), h('td', { class: 'n' }, kg(r.right)), h('td', { class: 'n' }, kg(r.left)), h('td', {}, r.note || '')));
  }
  t.append(body);
  return t;
}

/* tooltip shared by both charts */
function makeTip(box) {
  const tip = h('div', { class: 'tip', hidden: true });
  box.append(tip);
  return {
    show(x, w, lines) {
      tip.replaceChildren(...lines);
      tip.hidden = false;
      const tw = tip.offsetWidth;
      let left = x + 14;
      if (left + tw > w) left = x - 14 - tw;
      tip.style.left = Math.max(0, left) + 'px';
    },
    hide() { tip.hidden = true; },
  };
}

function mountLineChart(box, rows, bw) {
  const H = 244, M = { t: 14, r: 82, b: 28, l: 34 };
  const vals = rows.flatMap(r => [r.right, r.left]).concat(bw);
  const y0 = Math.floor((Math.min(...vals) - 3) / 5) * 5, y1 = Math.ceil((Math.max(...vals) + 3) / 5) * 5;
  const tMin = rows[0].t, tMax = rows[rows.length - 1].t;
  let idx = null;
  const tip = makeTip(box);
  let svgEl = null;

  function draw() {
    const w = Math.max(260, Math.round(box.clientWidth));
    const pw = w - M.l - M.r, ph = H - M.t - M.b;
    const X = t => M.l + (t - tMin) / (tMax - tMin) * pw;
    const Y = v => M.t + (1 - (v - y0) / (y1 - y0)) * ph;
    const xs = rows.map(r => X(r.t));
    const svg = s('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, 'aria-hidden': 'true' });

    for (let v = Math.ceil(y0 / 10) * 10; v < y1; v += 10) {
      if (Math.abs(v - bw) < 2.5 || v <= y0) continue;
      svg.append(s('line', { class: 'grid', x1: M.l, x2: w - M.r, y1: Y(v), y2: Y(v) }));
      svg.append(s('text', { class: 'ax', x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, v));
    }
    svg.append(s('line', { class: 'base', x1: M.l, x2: w - M.r, y1: Y(y0), y2: Y(y0) }));
    svg.append(s('text', { class: 'ax', x: M.l - 8, y: Y(y0) + 4, 'text-anchor': 'end' }, y0));
    svg.append(s('text', { class: 'ax', x: 0, y: 10 }, 'kg'));

    // x ticks on quarter or half-year starts
    const months = (tMax - tMin) / (DAY * 30.4375);
    const step = (pw * 3 / months) < 50 ? 6 : 3;
    const d0 = new Date(tMin);
    let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
    for (let i = 0; i < 40; i++) {
      const d = new Date(cur);
      if (cur > tMax) break;
      if (cur >= tMin && d.getUTCMonth() % step === 0) {
        const x = X(cur);
        if (x > M.l + 8 && x < w - M.r - 6) {
          svg.append(s('line', { class: 'base', x1: x, x2: x, y1: Y(y0), y2: Y(y0) + 4 }));
          svg.append(s('text', { class: 'ax', x, y: H - 8, 'text-anchor': 'middle' }, `${MO[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`));
        }
      }
      cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }

    // bodyweight reference
    svg.append(s('line', { class: 'goal', x1: M.l, x2: w - M.r, y1: Y(bw), y2: Y(bw) }));
    svg.append(s('text', { x: M.l + 2, y: Y(bw) - 6 }, `Bodyweight ${bw} kg`));

    const cross = s('line', { class: 'cross', y1: M.t, y2: Y(y0), x1: 0, x2: 0, style: 'display:none' });
    svg.append(cross);
    const dots = { right: [], left: [] };
    for (const [key, cls] of [['right', 's1'], ['left', 's2']]) {
      svg.append(s('path', { class: `line ${cls}`, d: rows.map((r, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)} ${Y(r[key]).toFixed(1)}`).join('') }));
      rows.forEach((r, i) => {
        const c = s('circle', { class: `dot ${cls}`, cx: xs[i], cy: Y(r[key]), r: 5 });
        dots[key].push(c); svg.append(c);
      });
    }
    // end labels, kept apart if the hands converge
    const lastR = rows[rows.length - 1];
    let yR = Y(lastR.right), yL = Y(lastR.left);
    if (Math.abs(yR - yL) < 16) { const mid = (yR + yL) / 2, up = yR < yL ? -1 : 1; yR = mid + up * 8; yL = mid - up * 8; }
    svg.append(s('text', { class: 'lbl', x: w - M.r + 10, y: yR + 4 }, `Right ${kg(lastR.right)}`));
    svg.append(s('text', { class: 'lbl', x: w - M.r + 10, y: yL + 4 }, `Left ${kg(lastR.left)}`));

    const hit = s('rect', { x: M.l - 12, y: 0, width: pw + 24, height: H - M.b + 4, fill: 'transparent' });
    svg.append(hit);

    function setIdx(i) {
      idx = i;
      cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.style.display = '';
      for (const k of ['right', 'left']) dots[k].forEach((c, j) => c.setAttribute('r', j === i ? 6.5 : 5));
      const r = rows[i];
      const row = (cls, name, v) => h('div', { class: 'r' }, h('i', { class: `key ${cls}` }), h('b', {}, `${kg(v)} kg`), h('span', {}, `${name}, ${Math.round(v / bw * 100)}% of bodyweight`));
      tip.show(xs[i], w, [
        h('div', { class: 'd' }, fmtLong(r.date) + (r.time ? `, ${r.time}` : '')),
        row('s1', 'Right', r.right), row('s2', 'Left', r.left),
        r.note ? h('div', { class: 'n' }, r.note) : null]);
    }
    function clear() { idx = null; cross.style.display = 'none'; tip.hide(); for (const k of ['right', 'left']) dots[k].forEach(c => c.setAttribute('r', 5)); }
    const nearest = e => {
      const px = e.clientX - svg.getBoundingClientRect().left;
      let best = 0;
      xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
      return best;
    };
    hit.addEventListener('pointermove', e => setIdx(nearest(e)));
    hit.addEventListener('pointerdown', e => setIdx(nearest(e)));
    hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') clear(); });
    box.onkeydown = e => {
      if (e.key === 'ArrowLeft') { setIdx(Math.max(0, (idx ?? rows.length) - 1)); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { setIdx(Math.min(rows.length - 1, (idx ?? -1) + 1)); e.preventDefault(); }
      else if (e.key === 'Escape') clear();
    };
    box.onblur = clear;
    if (svgEl) svgEl.remove();
    svgEl = svg;
    box.prepend(svg);
    if (idx != null) setIdx(Math.min(idx, rows.length - 1));
  }
  draw();
  new ResizeObserver(() => { if (box.clientWidth) draw(); }).observe(box);
}

function mountGapChart(box, rows) {
  const H = 170, M = { t: 14, r: 10, b: 28, l: 34 };
  const top = Math.max(10, Math.ceil(Math.max(...rows.map(r => r.gap)) / 10) * 10);
  const tip = makeTip(box);
  let svgEl = null;
  function draw() {
    const w = Math.max(260, Math.round(box.clientWidth));
    const pw = w - M.l - M.r, ph = H - M.t - M.b;
    const Y = v => M.t + (1 - v / top) * ph;
    const slot = pw / rows.length, bw = Math.min(24, slot * 0.62);
    const svg = s('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, 'aria-hidden': 'true' });
    for (let v = 10; v <= top; v += 10) {
      svg.append(s('line', { class: 'grid', x1: M.l, x2: w - M.r, y1: Y(v), y2: Y(v) }));
      svg.append(s('text', { class: 'ax', x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, `${v}%`));
    }
    svg.append(s('text', { class: 'ax', x: M.l - 8, y: Y(0) + 4, 'text-anchor': 'end' }, '0%'));
    rows.forEach((r, i) => {
      const cx = M.l + slot * (i + 0.5), x = cx - bw / 2, y = Y(r.gap), r4 = Math.min(4, bw / 2);
      const hgt = Y(0) - y;
      const d = `M${x} ${Y(0)}V${y + r4}Q${x} ${y} ${x + r4} ${y}H${x + bw - r4}Q${x + bw} ${y} ${x + bw} ${y + r4}V${Y(0)}Z`;
      const last = i === rows.length - 1;
      const bar = s('path', { class: `bar${last ? ' now' : ''}`, d });
      svg.append(bar);
      const hitR = s('rect', { x: M.l + slot * i, y: M.t, width: slot, height: ph + 14, fill: 'transparent' });
      const on = () => {
        bar.classList.add('hot');
        tip.show(cx, w, [
          h('div', { class: 'd' }, fmtLong(r.date) + (r.time ? `, ${r.time}` : '')),
          h('div', { class: 'r' }, h('b', {}, `${r.gap.toFixed(1)}%`), h('span', {}, 'left behind right')),
          h('div', { class: 'r' }, h('span', {}, `Right ${kg(r.right)} kg, left ${kg(r.left)} kg`)),
          r.note ? h('div', { class: 'n' }, r.note) : null]);
      };
      const off = () => { bar.classList.remove('hot'); tip.hide(); };
      hitR.addEventListener('pointerenter', on);
      hitR.addEventListener('pointerdown', on);
      hitR.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') off(); });
      svg.append(hitR);
      if (last) svg.append(s('text', { class: 'lbl', x: cx, y: y - 6, 'text-anchor': 'middle' }, `${r.gap.toFixed(1)}%`));
    });
    svg.append(s('line', { class: 'base', x1: M.l, x2: w - M.r, y1: Y(0), y2: Y(0) }));
    const lab = (i, anchor) => {
      const r = rows[i], d = new Date(toUTC(r.date));
      svg.append(s('text', { class: 'ax', x: M.l + slot * (i + 0.5), y: H - 8, 'text-anchor': anchor }, `${MO[d.getUTCMonth()]} ’${String(d.getUTCFullYear()).slice(2)}`));
    };
    lab(0, 'start'); lab(rows.length - 1, 'end');
    if (svgEl) svgEl.remove();
    svgEl = svg;
    box.prepend(svg);
  }
  draw();
  new ResizeObserver(() => { if (box.clientWidth) draw(); }).observe(box);
}

/* ---------- Climbs ---------- */
function holdRow(climbs) {
  const n = climbs.length, step = 20, r = 6.5;
  const svg = s('svg', { viewBox: `0 0 ${n * step} 16`, width: n * step, height: 16, 'aria-hidden': 'true' });
  climbs.forEach((c, i) => {
    const cx = i * step + step / 2;
    svg.append(c.sent
      ? s('circle', { cx, cy: 8, r, fill: 'var(--good)' })
      : s('circle', { cx, cy: 8, r: r - 1, fill: 'none', stroke: 'var(--axis)', 'stroke-width': 2 }));
  });
  return svg;
}
function checkIcon(sent) {
  return sent
    ? s('svg', { viewBox: '0 0 18 18', 'aria-hidden': 'true' }, s('circle', { cx: 9, cy: 9, r: 8, fill: 'var(--good)' }), s('path', { d: 'M5 9.3l2.8 2.8L13 6.5', fill: 'none', stroke: '#fff', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    : s('svg', { viewBox: '0 0 18 18', 'aria-hidden': 'true' }, s('circle', { cx: 9, cy: 9, r: 7, fill: 'none', stroke: 'var(--axis)', 'stroke-width': 2 }));
}

function renderClimbs() {
  const { data } = state;
  const all = data.lists.flatMap(l => l.climbs);
  const sends = all.filter(c => c.sent);
  const withTries = sends.filter(c => c.tries != null);
  const avg = withTries.length ? withTries.reduce((a, c) => a + c.tries, 0) / withTries.length : null;
  const flashes = withTries.filter(c => c.tries === 1).length;
  const root = h('div');
  root.append(section('Climb lists', 'Tap a list to see its climbs. Tap a climb to mark it sent or add your tries.'));

  const lists = h('div', { class: 'lists' });
  for (const l of data.lists) {
    const sentN = l.climbs.filter(c => c.sent).length, left = l.climbs.length - sentN;
    let next = '';
    if (!l.climbs.length) next = 'No climbs yet';
    else if (left === 0) next = 'All sent';
    else if (l.building) next = 'Still adding climbs, so no move up yet';
    else if (l.promote && left <= 1) next = 'One left: move up a list';
    const body = h('ul', { class: 'climbs' });
    for (const c of l.climbs) {
      const open = () => Log.climbSheet({ list: l, climb: c, today: state.today });
      body.append(h('li', {
        class: 'tap', role: 'button', tabindex: '0', 'aria-label': `${c.name}, ${c.grade}, ${c.sent ? 'sent' : 'not sent'}. Edit`,
        onclick: open, onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } },
      },
        checkIcon(c.sent),
        h('span', { class: 'cn' }, c.name),
        h('span', { class: 'cg' }, c.grade),
        (c.tries != null || c.note) ? h('span', { class: 'cm' }, [c.sent && c.tries != null ? plural(c.tries, 'try', 'tries') : null, c.note].filter(Boolean).join(', ')) : null));
    }
    body.append(h('li', { class: 'addrow' }, h('button', { type: 'button', class: 'btn quiet', onclick: () => Log.addClimbSheet({ list: l }) }, 'Add a climb')));
    lists.append(h('details', { class: 'list', open: l.id === 'tension-1' || null },
      h('summary', {},
        h('span', { class: 'nm' }, l.name),
        h('span', { class: 'ct' }, `${sentN}/${l.climbs.length} sent`),
        h('span', { class: 'holds' }, holdRow(l.climbs)),
        next ? h('span', { class: 'next' }, next) : null),
      body));
  }
  root.append(lists);

  root.append(section('Tries per send', 'Add the number of tries when you mark a climb sent.', h('div', { class: 'figs' },
    h('div', { class: 'fig' }, h('b', {}, `${sends.length}/${all.length}`), h('span', {}, 'climbs sent')),
    h('div', { class: 'fig' }, h('b', {}, avg == null ? 'none' : avg.toFixed(1)), h('span', {}, `tries per send, from ${plural(withTries.length, 'send', 'sends')} with tries logged`)),
    h('div', { class: 'fig' }, h('b', {}, String(flashes)), h('span', {}, (flashes === 1 ? 'flash' : 'flashes') + ' (sent first try)')))));
  return root;
}

/* ---------- Plan ---------- */
function renderPlan() {
  const { data } = state;
  if (state.sub && data.workouts && data.workouts[state.sub]) return renderWorkout(state.sub);
  const root = h('div');
  const plan = h('ul', { class: 'plan' });
  for (const p of data.plan) {
    const has = data.workouts && data.workouts[p.session];
    const open = () => go('plan', true, p.session);
    plan.append(h('li', has ? { class: 'tap', role: 'button', tabindex: '0', 'aria-label': `${p.session}. Open the workout`, onclick: open,
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } } : {},
      h('h3', {}, p.session), h('p', {}, p.what), h('p', { class: 'meta' }, `${p.load}. ${p.spacing}.`),
      has ? h('p', { class: 'open' }, 'Open the workout') : null));
  }
  root.append(section('The plan', `Weekly targets: ${TYPES.map(t => `${t} ${data.targets[t]}`).join(', ')}.`, plan));

  const rules = h('ul', { class: 'rules' });
  for (const r of data.rules) rules.append(h('li', {}, h('b', {}, r.title + ': '), r.text));
  root.append(h('details', { class: 'fold' }, h('summary', {}, 'Rules'), rules));

  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!standalone) root.append(h('p', { class: 'tip-install' }, h('b', {}, 'Add to your home screen. '), 'In Safari, tap Share, then Add to Home Screen. It opens full screen and keeps working when the gym has no signal.'));
  root.append(Log.settingsCard(() => mount()));
  root.append(h('p', { class: 'foot', style: 'margin-top:24px' }, `Data updated ${fmtLong(data.updated)}. Board screenshots: send them to Claude and they get added for you.`));
  return root;
}

/* ---------- Workouts ---------- */
const fmtClock = sec => { const s = Math.max(0, Math.ceil(sec)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const unitText = (n, u) => `${n} ${u}${n === 1 ? '' : 's'}`;

const T = { end: 0, timeout: 0, bar: null, ac: null, wake: null, label: '' };
function releaseWake() { try { if (T.wake) T.wake.release(); } catch (e) { /* ignore */ } T.wake = null; }
function stopTimer() {
  clearTimeout(T.timeout); releaseWake();
  if (T.bar) { T.bar.remove(); T.bar = null; }
}
function beep() {
  try {
    const ac = T.ac; if (!ac) return;
    [0, 0.28, 0.56].forEach(t => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ac.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.2);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.22);
    });
  } catch (e) { /* ignore */ }
}
function startTimer(label, seconds) {
  stopTimer();
  try {
    T.ac = T.ac || new (window.AudioContext || window.webkitAudioContext)();
    if (T.ac.state === 'suspended') T.ac.resume();
  } catch (e) { T.ac = null; }
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { T.wake = l; }).catch(() => {}); } catch (e) { /* ignore */ }
  const clock = h('span', { class: 't-clock' }, fmtClock(seconds));
  const name = h('span', { class: 't-label' }, label);
  const live = h('span', { class: 'sr', role: 'status' });
  const more = h('button', { type: 'button', onclick: () => { T.end += 30000; tick(); } }, '+30 s');
  const stop = h('button', { type: 'button', onclick: stopTimer }, 'Stop');
  T.bar = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Timer' }, h('div', { class: 't-text' }, name, clock), h('div', { class: 't-btns' }, more, stop), live);
  document.body.append(T.bar);
  T.end = Date.now() + seconds * 1000;
  function tick() {
    const left = (T.end - Date.now()) / 1000;
    if (left <= 0) {
      clock.textContent = '0:00'; name.textContent = 'Time is up'; live.textContent = 'Time is up';
      T.bar.classList.add('done'); stop.textContent = 'Done'; more.hidden = true;
      releaseWake(); beep();
      try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
      return;
    }
    clock.textContent = fmtClock(left);
    T.timeout = setTimeout(tick, 250);
  }
  clearTimeout(T.timeout);
  tick();
}

function exerciseCard(key, e, n) {
  const { today } = state;
  const doneKey = `done:${today}:${e.id}`;
  let done = Math.min(Number(store(doneKey)) || 0, e.sets || 0);
  const unit = e.unit || 'set';
  const li = h('li', { class: 'ex' });
  li.append(h('div', { class: 'ex-head' }, h('span', { class: 'ex-n', 'aria-hidden': 'true' }, String(n)), h('h3', {}, e.name)));
  li.append(e.sets && e.reps
    ? h('p', { class: 'dose' }, `${e.sets} × ${e.reps}`)
    : h('p', { class: 'dose unset' }, 'Sets and reps not set yet'));
  if (e.load || e.needsLoad) li.append(h('p', { class: 'load' }, 'Weight: ', e.load ? h('b', {}, e.load) : 'not set yet'));
  if (e.how) li.append(h('p', { class: 'how' }, e.how));
  if (e.sets) {
    const count = h('p', { class: 'ex-count', 'aria-live': 'polite' });
    const dots = h('div', { class: 'ticks', role: 'group', 'aria-label': `${unitText(e.sets, unit)} to tick off` });
    const draw = () => {
      dots.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-checked', String(i < done)));
      count.textContent = `${done} of ${unitText(e.sets, unit)} done`;
    };
    for (let i = 0; i < e.sets; i++) {
      dots.append(h('button', { type: 'button', role: 'checkbox', 'aria-label': `${unit} ${i + 1} of ${e.sets}`, onclick: () => {
        done = done === i + 1 ? i : i + 1; store(doneKey, String(done)); draw();
      } }, String(i + 1)));
    }
    draw();
    li.append(dots, count);
  }
  if (e.timers && e.timers.length) {
    const row = h('div', { class: 'timers' });
    for (const t of e.timers) {
      row.append(h('button', { type: 'button', class: t.work ? 'work' : '', onclick: () => startTimer(`${e.name}: ${t.label.toLowerCase()}`, t.s) },
        h('span', { class: 'tl' }, t.label), h('span', { class: 'tt' }, fmtClock(t.s))));
    }
    li.append(row);
  }
  li.append(h('button', { type: 'button', class: 'btn quiet ex-edit', onclick: () => Log.exerciseSheet({ workout: key, exercise: e }) }, 'Edit sets, reps and weight'));
  return li;
}

function renderWorkout(key) {
  const { data, today } = state;
  const w = data.workouts[key];
  const root = h('div');
  root.append(h('button', { type: 'button', class: 'back', onclick: () => go('plan', true) },
    s('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true' }, s('path', { d: 'M15 5l-7 7 7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })), 'Plan'));
  root.append(h('section', { class: 'section tight' }, h('h2', {}, w.title), w.intro ? h('p', { class: 'sub' }, w.intro) : null));
  const list = h('ol', { class: 'workout' });
  w.exercises.forEach((e, i) => list.append(exerciseCard(key, e, i + 1)));
  root.append(list);
  root.append(h('button', { type: 'button', class: 'btn primary block cta', onclick: () => Log.sessionSheet({ today, readiness: getReadiness(today), suggested: TYPES.includes(key) ? key : null }) }, 'Log this session'));
  return root;
}

/* ---------- shell ---------- */
const VIEWS = { today: renderToday, strength: renderStrength, climbs: renderClimbs, plan: renderPlan };
const view = document.getElementById('view');

function renderHeader() {
  const n = Log.pendingCount();
  document.getElementById('updated').textContent = `Updated ${fmt(state.data.updated)}` + (n ? `, ${n} not uploaded` : '');
}
function mount() {
  const y = window.scrollY;
  view.replaceChildren(VIEWS[state.tab]());
  window.scrollTo(0, y);
}
function go(tab, fresh, sub) {
  state.tab = VIEWS[tab] ? tab : 'today';
  state.sub = state.tab === 'plan' && sub && state.data.workouts && state.data.workouts[sub] ? sub : null;
  document.querySelectorAll('.tabs button').forEach(b => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  view.replaceChildren(VIEWS[state.tab]());
  if (fresh) window.scrollTo(0, 0);
  history.replaceState(null, '', location.pathname + location.search + '#' + state.tab + (state.sub ? '/' + state.sub.toLowerCase() : ''));
}

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab, true)));
document.addEventListener('pointerdown', e => {
  // tapping outside a chart hides its tooltip (touch has no hover-out)
  document.querySelectorAll('.chart .tip').forEach(t => { if (!t.parentElement.contains(e.target)) t.hidden = true; });
});

function start(data) {
  state.data = data;
  Log.onChange = d => { state.data = d; renderHeader(); mount(); };
  renderHeader();
  const [t0, s0] = location.hash.slice(1).split('/');
  const sub0 = Object.keys(data.workouts || {}).find(k => k.toLowerCase() === (s0 || '').toLowerCase());
  go(t0 || 'today', false, sub0);
  Log.init();
}
fetch('data.json', { cache: 'no-cache' })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(data => start(Log.resolve(data)))
  .catch(() => {
    const saved = Log.resolve(null);
    if (saved) start(saved);
    else view.replaceChildren(h('p', { class: 'loading' }, 'Could not load the data. Check your connection and reload.'));
  });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
})();
