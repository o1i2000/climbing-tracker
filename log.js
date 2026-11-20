/* Logging layer: the forms, the waiting queue and saving to GitHub. Loaded before app.js; exposes window.Log.
   Every change is a small "op". The same function applies an op on the phone (so the screen updates at once)
   and to the latest data.json on GitHub (so nothing is overwritten if Claude edited the file in the meantime). */
(() => {
'use strict';

const CFG = { repo: 'o1i2000/climbing-tracker', branch: 'main', path: 'data.json' };
const KEY = { token: 'gh-token', pending: 'pending-ops', cache: 'data-cache' };
const TYPES = ['Finger', 'Board', 'Pull', 'Weakness', 'Climb', 'Stretching'];
const LB = 0.45359237;
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- helpers ---------- */
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
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const readJSON = (k, fallback) => { try { const v = JSON.parse(ls.get(k)); return v == null ? fallback : v; } catch (e) { return fallback; } };
const clone = x => JSON.parse(JSON.stringify(x));
const uid = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtLong = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MO[m - 1]} ${y}`; };
const round2 = v => Math.round(v * 100) / 100;
const one = v => (Math.round(v * 10 + 1e-6) / 10).toFixed(1);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/* ---------- applying a change ---------- */
function sameTest(a, b) {
  return a.type === b.type && a.date === b.date && Math.abs(a.right - b.right) < 0.011 && Math.abs(a.left - b.left) < 0.011;
}
function applyOp(d, op) {
  if (op.op === 'addSession') {
    if (!d.sessions.some(x => x.id === op.id)) {
      d.sessions.push({ ...op.session, id: op.id });
      d.sessions.sort((a, b) => a.date.localeCompare(b.date));
    }
  } else if (op.op === 'deleteSession') {
    d.sessions = d.sessions.filter(x => x.id !== op.target);
  } else if (op.op === 'addStrength') {
    if (!d.strength.some(x => x.id === op.id || sameTest(x, op.test))) d.strength.push({ ...op.test, id: op.id });
  } else if (op.op === 'deleteStrength') {
    d.strength = d.strength.filter(x => x.id !== op.target);
  } else if (op.op === 'setClimb') {
    const l = d.lists.find(x => x.id === op.list);
    const c = l && l.climbs.find(x => x.name === op.name);
    if (c) Object.assign(c, op.fields);
  } else if (op.op === 'addClimb') {
    const l = d.lists.find(x => x.id === op.list);
    if (l && !l.climbs.some(c => c.name === op.climb.name)) {
      l.climbs.push({ name: op.climb.name, grade: op.climb.grade, sent: false, dateSent: null, tries: null, note: '' });
    }
  } else if (op.op === 'setExercise') {
    const w = d.workouts && d.workouts[op.workout];
    const e = w && w.exercises.find(x => x.id === op.exercise);
    const t = e && (op.variant ? (e.variants || []).find(v => v.id === op.variant) : e);
    if (t) Object.assign(t, op.fields);
  } else if (op.op === 'addPart') {
    d.parts = d.parts || [];
    if (!d.parts.some(x => x.id === op.id || (x.session === op.part.session && x.exercise === op.part.exercise && x.date === op.part.date))) d.parts.push({ ...op.part, id: op.id });
  } else if (op.op === 'addSetLog') {
    d.setLog = d.setLog || [];
    if (!d.setLog.some(x => x.id === op.id)) d.setLog.push({ ...op.entry, id: op.id });
  } else if (op.op === 'deleteSetLog') {
    d.setLog = (d.setLog || []).filter(x => x.id !== op.target);
  } else if (op.op === 'deletePart') {
    d.parts = (d.parts || []).filter(x => x.id !== op.target);
  } else if (op.op === 'deleteClimb') {
    const l = d.lists.find(x => x.id === op.list);
    if (l) l.climbs = l.climbs.filter(c => c.name !== op.name);
  }
  if (op.at && op.at > (d.updated || '')) d.updated = op.at;
  return d;
}
const describe = op => ({
  addSession: () => `log ${op.session.type} session`,
  deleteSession: () => 'remove a session',
  addStrength: () => `add ${op.test.type} test`,
  deleteStrength: () => 'remove a test',
  setClimb: () => `${op.fields.sent === false ? 'unmark' : 'mark'} ${op.name}`,
  addClimb: () => `add climb ${op.climb.name}`,
  deleteClimb: () => `remove climb ${op.name}`,
  setExercise: () => 'edit an exercise',
  addPart: () => `tick off ${op.part.name}`,
  deletePart: () => 'undo a tick',
  addSetLog: () => `log a set of ${op.entry.name}`,
  deleteSetLog: () => 'remove a logged set',
}[op.op] || (() => op.op))();

/* ---------- data held on this phone ---------- */
let base = null; // last data known to be on GitHub (or the file the site loaded)
const pending = () => readJSON(KEY.pending, []);
const setPending = a => ls.set(KEY.pending, JSON.stringify(a));
const current = () => { const d = clone(base); for (const op of pending()) applyOp(d, op); return d; };

function resolve(fetched) {
  const cache = readJSON(KEY.cache, null);
  base = cache && (!fetched || (cache.rev || 0) > (fetched.rev || 0)) ? cache : fetched;
  return base ? current() : null;
}
function emit() { if (api.onChange) api.onChange(current()); }

/* ---------- saving to GitHub ---------- */
class GhError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
const API = () => `https://api.github.com/repos/${CFG.repo}/contents/${CFG.path}`;
const hdr = tok => ({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok}`, 'X-GitHub-Api-Version': '2022-11-28' });
const b64dec = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0)));
const b64enc = s => { let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin); };

async function call(url, opts) {
  try { return await fetch(url, opts); } catch (e) { throw new GhError('network', 'offline'); }
}
async function commitOps(ops) {
  const tok = ls.get(KEY.token);
  if (!tok) throw new GhError('notoken', 'no token');
  for (let attempt = 0; attempt < 3; attempt++) {
    const g = await call(`${API()}?ref=${CFG.branch}`, { headers: hdr(tok), cache: 'no-store' });
    if (g.status === 401 || g.status === 403 || g.status === 404) throw new GhError('auth', `GitHub said ${g.status} when reading the data`);
    if (!g.ok) throw new GhError('other', `GitHub said ${g.status}`);
    const file = await g.json();
    let data;
    try { data = JSON.parse(b64dec(file.content)); } catch (e) { throw new GhError('other', 'data.json could not be read'); }
    for (const op of ops) applyOp(data, op);
    data.rev = (data.rev || 0) + 1;
    const message = ('Site: ' + [...new Set(ops.map(describe))].join(', ')).slice(0, 140);
    const put = await call(API(), {
      method: 'PUT',
      headers: { ...hdr(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64enc(JSON.stringify(data, null, 2) + '\n'), sha: file.sha, branch: CFG.branch }),
    });
    if (put.ok) return data;
    if (put.status === 409 || put.status === 422) continue; // the file changed in between: read it again and retry
    if (put.status === 401 || put.status === 403 || put.status === 404) throw new GhError('auth', `GitHub said ${put.status} when saving`);
    throw new GhError('other', `GitHub said ${put.status}`);
  }
  throw new GhError('conflict', 'the file kept changing');
}

let flushing = null;
function flush() {
  if (flushing) return flushing;
  const ops = pending();
  if (!ops.length) return Promise.resolve({ ok: true, n: 0 });
  if (!ls.get(KEY.token)) return Promise.resolve({ ok: false, kind: 'notoken' });
  flushing = (async () => {
    try {
      const data = await commitOps(ops);
      const sent = new Set(ops.map(o => o.id));
      setPending(pending().filter(o => !sent.has(o.id)));
      base = data;
      ls.set(KEY.cache, JSON.stringify(data));
      emit();
      return { ok: true, n: ops.length };
    } catch (e) {
      return { ok: false, kind: e.kind || 'other', message: e.message };
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function testToken(tok) {
  try {
    const res = await fetch(`${API()}?ref=${CFG.branch}`, { headers: hdr(tok), cache: 'no-store' });
    if (res.ok) return { ok: true };
    return { ok: false, kind: res.status === 401 ? 'bad' : 'access' };
  } catch (e) { return { ok: false, kind: 'network' }; }
}

/* ---------- toast ---------- */
let toastTimer;
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5200);
}
function report(r) {
  if (r.ok) return toast('Saved. Your other devices update in about a minute.');
  if (r.kind === 'notoken') return toast('Saved on this phone only. Add a GitHub token in Plan to upload it.');
  if (r.kind === 'network') return toast('Saved on this phone. It uploads when you are back online.');
  if (r.kind === 'auth') return toast('GitHub refused to save. Check the token in Plan. Your change is kept on this phone.');
  return toast('Could not upload yet. Your change is kept on this phone and will retry.');
}
async function submit(ops) {
  setPending([...pending(), ...ops]);
  emit();
  const r = await flush();
  report(r);
  return r;
}
function init() {
  const after = r => { if (r.ok && r.n) toast('Uploaded your waiting changes.'); };
  addEventListener('online', () => flush().then(after));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pending().length) flush().then(after); });
  if (pending().length) flush().then(after);
}

/* ---------- small UI parts ---------- */
function sheet(title, build) {
  const prev = document.activeElement;
  const back = h('div', { class: 'sheet-back' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' });
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    back.remove();
    document.body.classList.remove('noscroll');
    document.removeEventListener('keydown', onKey);
    if (prev && prev.focus) prev.focus();
  }
  panel.append(h('div', { class: 'sheet-head' },
    h('h2', {}, title),
    h('button', { type: 'button', class: 'sheet-x', 'aria-label': 'Close', onclick: close }, '×')));
  panel.append(build(close));
  back.append(panel);
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.body.append(back);
  document.body.classList.add('noscroll');
  document.addEventListener('keydown', onKey);
  panel.focus();
  return close;
}
function field(label, input, hint) {
  return h('label', { class: 'f' }, h('span', { class: 'f-l' }, label), input, hint ? h('span', { class: 'f-h' }, hint) : null);
}
function chips(options, value, label, allowClear) {
  let val = value;
  const el = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label });
  const draw = () => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === val)));
  for (const o of options) {
    el.append(h('button', { type: 'button', role: 'radio', 'data-v': o, onclick: () => { val = (allowClear && val === o) ? null : o; draw(); } }, o));
  }
  draw();
  return { el, get: () => val };
}
function multiChips(options, values, label) {
  const sel = new Set(values);
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': label });
  const draw = () => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(sel.has(b.dataset.v))));
  for (const o of options) el.append(h('button', { type: 'button', 'data-v': o, 'aria-pressed': 'false', onclick: () => { if (sel.has(o)) sel.delete(o); else sel.add(o); draw(); } }, o));
  draw();
  return { el, get: () => options.filter(o => sel.has(o)) };
}
function confirmButton(label, armed, onConfirm) {
  let timer;
  const b = h('button', { type: 'button', class: 'btn quiet', onclick: () => {
    if (b.dataset.armed) { clearTimeout(timer); onConfirm(); return; }
    b.dataset.armed = '1'; b.textContent = armed; b.classList.add('danger');
    timer = setTimeout(() => { delete b.dataset.armed; b.textContent = label; b.classList.remove('danger'); }, 4000);
  } }, label);
  return b;
}
const saveNote = () => h('p', { class: 'hint' }, ls.get(KEY.token)
  ? 'Saves to your data on GitHub.'
  : 'No token yet, so this saves on this phone only. Add one in Plan.');
function errBox() { return h('p', { class: 'err', role: 'alert', hidden: true }); }
function showErr(box, msg) { box.textContent = msg; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); }

/* ---------- Log a session ---------- */
/* Groups of exercises that should not all land on one day (data.clashes). Only exercises from
   different sessions clash: cuff rows and I Y T belong together on Pull day. */
function findExercise(d, id) {
  for (const [s, w] of Object.entries(d.workouts || {})) {
    const e = w.exercises.find(x => x.id === id);
    if (e) return { id, session: s, ex: e };
  }
  return null;
}
/* Set dots and Mark done are saved on this phone per day (done:<day>:<id>, fin:<day>:<id>). Anything ticked counts as done that day. */
function tickedOn(day) {
  const out = new Set(), dp = 'done:' + day + ':', fp = 'fin:' + day + ':';
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (k.startsWith(dp) && Number(localStorage.getItem(k)) > 0) out.add(k.slice(dp.length));
      else if (k.startsWith(fp) && localStorage.getItem(k) === '1') out.add(k.slice(fp.length));
    }
  } catch (e) { /* storage blocked: only logged work counts */ }
  return out;
}
const ackKey = (day, id) => 'clash-ok:' + day + ':' + id;
function clashFor(d, day, { session, exercise }) {
  const out = [], ticked = tickedOn(day);
  for (const c of d.clashes || []) {
    if (ls.get(ackKey(day, c.id))) continue;
    const members = c.exercises.map(id => findExercise(d, id)).filter(Boolean);
    const adding = exercise ? members.filter(m => m.id === exercise) : members.filter(m => m.session === session);
    if (!adding.length) continue;
    const mine = new Set(adding.map(m => m.session));
    const already = members.filter(m => !mine.has(m.session) && (
      ticked.has(m.id) || (d.parts || []).some(p => p.date === day && p.exercise === m.id) ||
      (d.sessions || []).some(s => s.date === day && s.type === m.session)));
    if (!already.length) continue;
    out.push({ id: c.id, title: c.title, what: c.what, advice: c.advice, ids: [...adding, ...already].map(m => m.id) });
  }
  return out.map(x => withTotals(d, x));
}
function withTotals(d, x) {
  const ex = x.ids.map(id => findExercise(d, id).ex);
  return { ...x, names: ex.map(e => e.name), sets: ex.reduce((n, e) => n + (e.sets || 0), 0) };
}
function clashForSessions(d, day, types) {
  const sim = { ...d, sessions: [...(d.sessions || []), ...types.map(t => ({ date: day, type: t }))] };
  const byId = new Map();
  for (const t of types) for (const hit of clashFor(sim, day, { session: t })) {
    const prev = byId.get(hit.id);
    byId.set(hit.id, prev ? { ...prev, ids: [...new Set([...prev.ids, ...hit.ids])] } : hit);
  }
  return [...byId.values()].map(x => withTotals(d, x));
}
const listNames = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
function warnSheet({ hits, day, confirmLabel, backLabel, onConfirm }) {
  return sheet(hits[0].title, close => h('div', {},
    hits.map(x => h('div', { class: 'warn' },
      h('p', {}, `That puts ${listNames(x.names)} on the same day` + (x.sets ? `: about ${x.sets} sets of ${x.what}.` : '.')),
      h('p', { class: 'sub' }, x.advice))),
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'button', class: 'btn primary block', onclick: close }, backLabel || 'Leave it for another day'),
      h('button', { type: 'button', class: 'btn quiet', onclick: () => { for (const x of hits) if (day) ls.set(ackKey(day, x.id), '1'); close(); onConfirm(); } }, confirmLabel))));
}

function sessionSheet({ today, suggested, readiness, title: prefill }) {
  sheet('Log a session', close => {
    const type = multiChips(TYPES, suggested || [], 'Session type');
    const ready = chips(['1', '2', '3', '4', '5'], readiness ? String(readiness) : null, 'How ready you felt, 1 to 5', true);
    const date = h('input', { type: 'date', value: today });
    const title = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'e.g. Tension 1 problems', value: prefill || '' });
    const notes = h('textarea', { rows: '3', placeholder: 'Optional' });
    const err = errBox();
    const save = h('button', { type: 'button', class: 'btn primary block', onclick: () => {
      const types = type.get();
      if (!types.length) return showErr(err, 'Pick at least one session type.');
      if (!date.value) return showErr(err, 'Pick a date.');
      const r = ready.get() ? Number(ready.get()) : null;
      const day = date.value;
      const doSave = () => {
        if (r) ls.set('readiness:' + day, String(r));
        close();
        submit(types.map(t => ({ id: uid(), op: 'addSession', at: isoToday(), session: {
          date: day, type: t, title: types.length === 1 ? (title.value.trim() || t) : t, readiness: r, details: notes.value.trim(),
        } })));
      };
      const hits = clashForSessions(current(), day, types);
      if (hits.length) warnSheet({ hits, day, confirmLabel: 'Log it anyway', backLabel: 'Go back', onConfirm: doSave });
      else doSave();
    } }, 'Save session');
    return h('div', {},
      h('div', { class: 'f' }, h('span', { class: 'f-l' }, 'Type'), type.el,
        h('span', { class: 'f-h' }, 'Tap more than one to log them together. Each is saved as its own session.')),
      field('Date', date),
      h('div', { class: 'f' }, h('span', { class: 'f-l' }, 'How ready did you feel?'), ready.el,
        h('span', { class: 'f-h' }, '1 is wrecked, 5 is fresh. Optional.')),
      field('What you did', title, 'Used when you log one type.'),
      field('Notes', notes),
      err, saveNote(),
      h('div', { class: 'sheet-actions' }, save));
  });
}

/* ---------- Tindeq CSV ---------- */
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
function parseTindeq(text, data) {
  const rows = parseCsv(text);
  if (!rows.length) return { error: 'That file is empty.' };
  const head = rows.shift().map(x => x.trim().toLowerCase());
  const col = n => head.indexOf(n);
  if (['date', 'left max weight', 'right max weight'].some(n => col(n) < 0)) {
    return { error: 'This does not look like a Tindeq left/right export. It needs date, left max weight and right max weight columns.' };
  }
  const fresh = [], skipped = {}; let dupes = 0, bad = 0;
  const seen = [...data.strength];
  for (const r of rows) {
    const get = n => (col(n) < 0 ? '' : (r[col(n)] || '').trim());
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(get('date'));
    const tag = get('tag').toLowerCase();
    const type = /pinch/.test(tag) ? 'Pinch block' : /20\s*mm/.test(tag) ? '20mm half crimp' : null;
    if (!m) { bad++; continue; }
    if (!type) { const k = get('tag') || 'no tag'; skipped[k] = (skipped[k] || 0) + 1; continue; }
    let left = parseFloat(get('left max weight')), right = parseFloat(get('right max weight'));
    if (!isFinite(left) || !isFinite(right)) { bad++; continue; }
    if (/^(imp|lb)/i.test(get('unit'))) { left *= LB; right *= LB; }
    const body = parseFloat(get('body weight'));
    const t = { date: m[1], time: m[2], type, right: round2(right), left: round2(left), body: isFinite(body) ? body : null, note: get('comment') };
    if (seen.some(x => sameTest(x, t))) { dupes++; continue; }
    seen.push(t);
    fresh.push({ ...t, id: `t-${type === 'Pinch block' ? 'pinch' : '20mm'}-${m[1]}T${m[2]}` });
  }
  fresh.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return { fresh, dupes, skipped, bad };
}

/* ---------- Add a test ---------- */
function testSheet({ today }) {
  sheet('Add a test', close => {
    const root = h('div');

    // import
    const out = h('div', { class: 'import-out', 'aria-live': 'polite' });
    const input = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr', id: 'csv-file', onchange: async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      out.replaceChildren(h('p', { class: 'hint' }, 'Reading the file'));
      let res;
      try { res = parseTindeq(await f.text(), current()); } catch (e) { res = { error: 'Could not read that file.' }; }
      out.replaceChildren(...importResult(res, close));
      input.value = '';
    } });
    root.append(
      h('p', { class: 'f-h', style: 'margin-top:0' }, 'In the Tindeq app, export your data as a CSV and save it to Files. Pick it here. The file can hold every test: ones already logged are skipped.'),
      h('div', { class: 'sheet-actions', style: 'margin-top:12px' }, h('label', { class: 'btn primary block', for: 'csv-file' }, 'Choose Tindeq CSV')),
      input, out);

    // by hand
    const type = chips(['20mm half crimp', 'Pinch block'], '20mm half crimp', 'Test type');
    const date = h('input', { type: 'date', value: today });
    const right = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'kg' });
    const left = h('input', { type: 'number', step: '0.01', min: '0', inputmode: 'decimal', placeholder: 'kg' });
    const note = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'Optional' });
    const err = errBox();
    root.append(
      h('h3', { class: 'sheet-sub' }, 'Or type one in'),
      h('div', { class: 'f', style: 'margin-top:0' }, h('span', { class: 'f-l' }, 'Test'), type.el),
      field('Date', date),
      h('div', { class: 'pair' }, field('Right hand (kg)', right), field('Left hand (kg)', left)),
      field('Note', note),
      err,
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn block', onclick: () => {
        const r = parseFloat(right.value), l = parseFloat(left.value);
        if (!date.value) return showErr(err, 'Pick a date.');
        if (!isFinite(r) || !isFinite(l) || r <= 0 || l <= 0) return showErr(err, 'Enter the right and left maximums in kg.');
        close();
        submit([{ id: uid(), op: 'addStrength', at: isoToday(), test: {
          date: date.value, time: null, type: type.get(), right: round2(r), left: round2(l), body: null, note: note.value.trim(),
        } }]);
      } }, 'Save this test')));

    // recent, so a wrong one can be removed
    const recent = [...current().strength].filter(x => x.id).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).slice(0, 4);
    if (recent.length) {
      const list = h('ul', { class: 'recent' });
      for (const t of recent) {
        list.append(h('li', {},
          h('span', { class: 'rt' }, `${fmtLong(t.date)}, ${t.type === 'Pinch block' ? 'pinch' : '20mm'}`),
          h('span', { class: 'rm' }, `Right ${one(t.right)} kg, left ${one(t.left)} kg`),
          confirmButton('Remove', 'Tap again to remove', () => { close(); submit([{ id: uid(), op: 'deleteStrength', at: isoToday(), target: t.id }]); })));
      }
      root.append(h('h3', { class: 'sheet-sub' }, 'Latest tests'), list);
    }
    return root;
  });
}
function importResult(res, close) {
  if (res.error) return [h('p', { class: 'err', role: 'alert' }, res.error)];
  const bits = [];
  const skippedN = Object.values(res.skipped).reduce((a, b) => a + b, 0);
  const extra = [];
  if (res.dupes) extra.push(`${plural(res.dupes, 'test is', 'tests are')} already logged`);
  if (skippedN) extra.push(`${plural(skippedN, 'row', 'rows')} skipped (tag: ${Object.keys(res.skipped).join(', ')})`);
  if (res.bad) extra.push(`${plural(res.bad, 'row', 'rows')} could not be read`);
  if (!res.fresh.length) {
    bits.push(h('p', { class: 'hint' }, 'Nothing new to add. ' + (extra.join('; ') || '') + (extra.length ? '.' : '')));
    return bits;
  }
  const list = h('ul', { class: 'found' });
  for (const t of res.fresh) {
    list.append(h('li', {}, h('b', {}, `${fmtLong(t.date)}, ${t.type === 'Pinch block' ? 'pinch' : '20mm'}`), ` right ${one(t.right)} kg, left ${one(t.left)} kg`, t.note ? ` (${t.note})` : ''));
  }
  bits.push(h('p', { class: 'f-l', style: 'margin-top:14px' }, `${plural(res.fresh.length, 'new test', 'new tests')} found`), list);
  if (extra.length) bits.push(h('p', { class: 'hint' }, extra.join('; ') + '.'));
  bits.push(saveNote(), h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary block', onclick: () => {
    close();
    submit(res.fresh.map(t => { const { id, ...test } = t; return { id, op: 'addStrength', at: isoToday(), test }; }));
  } }, `Add ${plural(res.fresh.length, 'test', 'tests')}`)));
  return bits;
}

/* ---------- Climbs ---------- */
function climbSheet({ list, climb, today }) {
  sheet(climb.name, close => {
    const tries = h('input', { type: 'number', min: '1', max: '99', step: '1', inputmode: 'numeric', placeholder: 'e.g. 3', value: climb.tries == null ? '' : String(climb.tries) });
    const date = h('input', { type: 'date', value: climb.dateSent || today });
    const note = h('input', { type: 'text', maxlength: '80', autocomplete: 'off', placeholder: 'Optional', value: climb.note || '' });
    const op = fields => submit([{ id: uid(), op: 'setClimb', at: isoToday(), list: list.id, name: climb.name, fields }]);
    const save = h('button', { type: 'button', class: 'btn primary block', onclick: () => {
      const n = tries.value === '' ? null : Math.max(1, Math.round(Number(tries.value)));
      close();
      op({ sent: true, tries: n, dateSent: date.value || today, note: note.value.trim() });
    } }, climb.sent ? 'Save changes' : 'Mark as sent');
    const actions = h('div', { class: 'sheet-actions' }, save);
    if (climb.sent) actions.append(h('button', { type: 'button', class: 'btn block', onclick: () => { close(); op({ sent: false, tries: null, dateSent: null }); } }, 'Mark as not sent'));
    actions.append(confirmButton('Remove from list', 'Tap again to remove', () => { close(); submit([{ id: uid(), op: 'deleteClimb', at: isoToday(), list: list.id, name: climb.name }]); }));
    return h('div', {},
      h('p', { class: 'sub' }, `${list.name}, ${climb.grade}`),
      field('Tries', tries, 'One try is a flash. Optional.'),
      field('Date sent', date),
      field('Note', note),
      saveNote(), actions);
  });
}
function addClimbSheet({ list }) {
  sheet(`Add to ${list.name}`, close => {
    const name = h('input', { type: 'text', maxlength: '60', autocomplete: 'off', autocapitalize: 'words' });
    const grade = h('input', { type: 'text', maxlength: '12', autocomplete: 'off', placeholder: 'e.g. 7a/V6' });
    const err = errBox();
    return h('div', {},
      field('Name', name),
      field('Grade', grade, 'Write it the way the app shows it.'),
      err, saveNote(),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary block', onclick: () => {
        const n = name.value.trim(), g = grade.value.trim();
        if (!n) return showErr(err, 'Enter the climb name.');
        if (!g) return showErr(err, 'Enter the grade.');
        if (list.climbs.some(c => c.name.toLowerCase() === n.toLowerCase())) return showErr(err, 'That climb is already in this list.');
        close();
        submit([{ id: uid(), op: 'addClimb', at: isoToday(), list: list.id, climb: { name: n, grade: g } }]);
      } }, 'Add climb')));
  });
}

/* ---------- Edit an exercise ---------- */
function exerciseSheet({ workout, exercise, variant }) {
  const target = variant || exercise;
  sheet(target.name, close => {
    const sets = h('input', { type: 'number', min: '1', max: '30', step: '1', inputmode: 'numeric', placeholder: 'e.g. 4', value: target.sets == null ? '' : String(target.sets) });
    const reps = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'e.g. 8 each side', value: target.reps || '' });
    const load = h('input', { type: 'text', maxlength: '40', autocomplete: 'off', placeholder: 'e.g. 12 kg', value: target.load || '' });
    const how = h('textarea', { rows: '5', maxlength: '600', placeholder: 'How to do it, in a few lines', value: target.how || '' });
    how.value = target.how || '';
    const hasHold = 'hold' in target;
    const hold = h('input', { type: 'number', min: '1', max: '600', step: '1', inputmode: 'numeric', placeholder: 'e.g. 30', value: target.hold == null ? '' : String(target.hold) });
    const err = h('p', { class: 'err', role: 'alert' });
    err.hidden = true;
    return h('div', {},
      h('div', { class: 'pair' }, field('Sets', sets), field('Reps or time', reps)),
      field('Weight', load, 'Leave empty if it is bodyweight or not set yet.'),
      hasHold ? field('Hold time (seconds)', hold, 'Adds a timer button to the exercise. Leave empty for no timer.') : null,
      field('Description', how),
      err,
      saveNote(),
      h('div', { class: 'sheet-actions' }, h('button', { type: 'button', class: 'btn primary block', onclick: () => {
        const n = sets.value === '' ? null : Math.max(1, Math.round(Number(sets.value)));
        const fields = { sets: n, reps: reps.value.trim() || null, load: load.value.trim() || null, how: how.value.trim() };
        if (hasHold) {
          const hv = hold.value.trim() === '' ? null : Number(hold.value);
          if (hv != null && !(Number.isFinite(hv) && hv >= 1 && hv <= 600)) { err.textContent = 'The hold time must be from 1 to 600 seconds.'; err.hidden = false; hold.focus(); return; }
          fields.hold = hv == null ? null : Math.round(hv);
        }
        close();
        submit([{ id: uid(), op: 'setExercise', at: isoToday(), workout, exercise: exercise.id, variant: variant ? variant.id : undefined, fields }]);
      } }, 'Save')));
  });
}

/* ---------- Plan: saving settings ---------- */
function settingsCard(rerender) {
  const has = !!ls.get(KEY.token);
  const n = pending().length;
  const sec = h('section', { class: 'section' }, h('h2', {}, 'Saving'));
  sec.append(h('p', { class: 'sub' }, has
    ? 'Logging from this page saves to GitHub. Your other devices update about a minute later.'
    : 'Add a GitHub token so the buttons on this page can save your data. Until then, anything you log stays on this phone only.'));
  if (n) {
    sec.append(h('p', { class: 'warn-line' }, `${plural(n, 'change is', 'changes are')} waiting to upload.`));
    if (has) sec.append(h('button', { type: 'button', class: 'btn quiet', onclick: async () => { const r = await flush(); report(r); rerender(); } }, 'Try again now'));
  }
  if (has) {
    sec.append(h('p', { class: 'ok-line' }, 'A token is saved on this device.'),
      confirmButton('Remove token', 'Tap again to remove', () => { ls.del(KEY.token); toast('Token removed from this device.'); rerender(); }));
  } else {
    const input = h('input', { type: 'password', class: 'field', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'GitHub token', placeholder: 'Paste token' });
    const msg = h('p', { class: 'hint', role: 'status' });
    sec.append(
      h('details', { class: 'fold how' },
        h('summary', {}, 'How to get a token'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'GitHub, new fine-grained token'), '. Name it Climbing log and pick the longest expiry.'),
          h('li', {}, 'Repository access: Only select repositories, then choose climbing-tracker.'),
          h('li', {}, 'Permissions, Repository permissions, Contents: Read and write.'),
          h('li', {}, 'Generate token, copy it, and paste it below. On iPhone, do this inside the home screen app, which keeps its own storage. Never send the token in a chat.'))),
      h('div', { class: 'tokenrow' }, input, h('button', { type: 'button', class: 'btn primary', onclick: async () => {
        const tok = input.value.trim();
        if (!tok) { msg.textContent = 'Paste the token first.'; return; }
        msg.textContent = 'Checking';
        const r = await testToken(tok);
        if (r.ok) { ls.set(KEY.token, tok); toast('Token works.'); const f = await flush(); if (f.ok && f.n) toast('Uploaded your waiting changes.'); rerender(); }
        else msg.textContent = r.kind === 'network' ? 'Could not reach GitHub. Check your connection.'
          : r.kind === 'bad' ? 'GitHub did not accept that token. Check that you copied all of it.'
          : 'The token cannot see the climbing-tracker repository. Check the repository access.';
      } }, 'Save token')),
      msg);
  }
  return sec;
}

const api = {
  onChange: null,
  resolve, current, submit, flush, init,
  pendingCount: () => pending().length,
  hasToken: () => !!ls.get(KEY.token),
  sessionSheet, testSheet, climbSheet, addClimbSheet, exerciseSheet, settingsCard, confirmButton, toast,
  _parseTindeq: parseTindeq, _applyOp: applyOp,
};
api.uid = uid;
api.clashFor = clashFor;
api.warnSheet = warnSheet;
window.Log = api;
})();
