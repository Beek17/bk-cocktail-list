'use strict';

const CSV_PATH = 'data/cocktails.csv';   // sample data, shown until you connect your sheet
const REFRESH_AFTER_MS = 30000;          // re-read the sheet when you come back to the tab after this long

const state = {
  all: [],
  query: '',
  spirit: 'All',
  minScore: 0,
  sort: 'score',
  mode: 'demo',          // 'demo' = sample CSV, read-only. 'live' = your sheet, editable.
  open: new Set(),       // ids of expanded cards, kept across re-renders
  pending: 0,            // writes in flight
  lastLoad: 0,
  editingId: null,       // null = adding
};

const $ = (id) => document.getElementById(id);
const listEl = $('list'), countEl = $('count'), emptyEl = $('empty'), bannerEl = $('banner'), toastEl = $('toast');
const searchEl = $('search'), chipsEl = $('spirit-chips'), minScoreEl = $('min-score'), minScoreOut = $('min-score-out'), sortEl = $('sort');
const addBtn = $('add-btn'), refreshBtn = $('refresh-btn'), settingsBtn = $('settings-btn');
const editDialog = $('edit-dialog'), editForm = $('edit-form'), editError = $('edit-error'), deleteBtn = $('delete-btn'), editSave = $('edit-save');
const settingsDialog = $('settings-dialog'), settingsForm = $('settings-form'), settingsMsg = $('settings-msg');

/* ---------- Small helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer;
function toast(message, kind = '') {
  toastEl.textContent = message;
  toastEl.className = 'toast ' + kind;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, kind === 'error' ? 6000 : 2800);
}

function showBanner(message, kind = 'info') {
  bannerEl.textContent = message;
  bannerEl.className = 'banner ' + kind;
  bannerEl.hidden = false;
}
const hideBanner = () => { bannerEl.hidden = true; };

/* ---------- CSV (demo data only) ---------- */

// Handles quoted fields, commas and line breaks inside quotes, and "" as an escaped quote.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function csvToRaw(rows) {
  const [header, ...body] = rows;
  const col = {};
  header.forEach((h, i) => { col[normKey(h)] = i; });
  const get = (r, key) => (r[col[key]] ?? '').trim();
  return body
    .filter((r) => get(r, 'cocktail') !== '')
    .map((r, i) => ({
      id: 'demo-' + i,
      name: get(r, 'cocktail'),
      score: get(r, 'score'),
      ingredients: get(r, 'ingredients'),
      instructions: get(r, 'instructions'),
      notes: get(r, 'bksnotes'),
      base: get(r, 'basespirit'),
      source: get(r, 'source'),
      added: get(r, 'dateadded'),
    }));
}

/* ---------- Data model ---------- */

function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : 0;
}

// raw = what the sheet (or CSV) gives us. c = what the page works with.
function normalize(raw) {
  const n = raw.score === null || raw.score === '' || raw.score === undefined ? NaN : Number(raw.score);
  const c = {
    id: String(raw.id),
    name: String(raw.name || '').trim(),
    score: Number.isFinite(n) ? n : null,
    ingredientsText: String(raw.ingredients || ''),
    instructions: String(raw.instructions || ''),
    notes: String(raw.notes || ''),
    baseRaw: String(raw.base || '').trim(),
    source: String(raw.source || '').trim(),
    added: String(raw.added || '').trim(),
  };
  c.base = c.baseRaw || 'Other';
  c.addedTs = parseDate(c.added);
  c.ingredients = c.ingredientsText.split('\n').map((l) => l.trim()).filter(Boolean);
  c.haystack = [c.name, c.ingredientsText, c.notes].join(' ').toLowerCase();
  return c;
}

const toRaw = (c) => ({
  id: c.id, name: c.name, score: c.score, ingredients: c.ingredientsText, instructions: c.instructions,
  notes: c.notes, base: c.baseRaw, source: c.source, added: c.added,
});

const indexOfId = (id) => state.all.findIndex((c) => c.id === id);

/* ---------- Filtering + sorting ---------- */

const byName = (a, b) => a.name.localeCompare(b.name);
const SORTERS = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || byName(a, b),
  newest: (a, b) => b.addedTs - a.addedTs || byName(a, b),
  name: byName,
};

function visible() {
  let out = state.all.slice();
  const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) out = out.filter((c) => terms.every((t) => c.haystack.includes(t)));
  if (state.spirit !== 'All') out = out.filter((c) => c.base === state.spirit);
  if (state.minScore > 0) out = out.filter((c) => c.score !== null && c.score >= state.minScore);
  return out.sort(SORTERS[state.sort]);
}

/* ---------- Rendering ---------- */

function scoreTier(score) {
  if (score === null) return ' none';
  if (score >= 9) return ' gold';
  if (score >= 8) return ' amber';
  return '';
}

function card(c) {
  const details = el('details', 'card');
  details.dataset.id = c.id;
  details.open = state.open.has(c.id);
  details.addEventListener('toggle', () => {
    if (details.open) state.open.add(c.id); else state.open.delete(c.id);
  });

  const summary = el('summary');
  summary.append(el('span', 'score' + scoreTier(c.score), c.score === null ? '–' : String(c.score)));
  const title = el('span', 'title');
  title.append(el('span', 'name', c.name));
  title.append(el('span', 'meta', [c.base, c.source].filter(Boolean).join(' · ')));
  summary.append(title);
  details.append(summary);

  const body = el('div', 'body');
  if (c.ingredients.length) {
    const ul = el('ul', 'ingredients');
    c.ingredients.forEach((line) => ul.append(el('li', '', line)));
    body.append(ul);
  }
  if (c.instructions) body.append(el('p', 'instructions', c.instructions));
  if (c.notes) {
    const note = el('p', 'notes');
    note.append(el('strong', '', "BK's notes: "), document.createTextNode(c.notes));
    body.append(note);
  }
  if (c.added) body.append(el('p', 'added', `Added ${c.added}`));

  if (state.mode === 'live') {
    const bar = el('div', 'card-actions');
    const input = el('input', 'quick-score');
    input.type = 'number'; input.min = '0'; input.max = '10'; input.step = '0.1';
    input.inputMode = 'decimal';
    input.value = c.score === null ? '' : String(c.score);
    input.setAttribute('aria-label', `Score for ${c.name}`);
    const saveScoreBtn = el('button', 'btn small', 'Save score');
    saveScoreBtn.type = 'button';
    const go = () => saveScore(c, input.value);
    saveScoreBtn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    const editBtn = el('button', 'btn small', 'Edit');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openEditor(c));
    bar.append(input, saveScoreBtn, editBtn);
    body.append(bar);
  }
  details.append(body);
  return details;
}

function render(list) {
  const frag = document.createDocumentFragment();
  list.forEach((c) => frag.append(card(c)));
  listEl.replaceChildren(frag);

  const total = state.all.length;
  countEl.textContent = list.length === total ? `${total} cocktails` : `${list.length} of ${total} cocktails`;
  emptyEl.hidden = list.length > 0 || total === 0;
}

const update = () => render(visible());

function syncChips() {
  chipsEl.querySelectorAll('.chip').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.value === state.spirit));
  });
}

function buildChips() {
  const counts = new Map();
  state.all.forEach((c) => counts.set(c.base, (counts.get(c.base) || 0) + 1));
  if (state.spirit !== 'All' && !counts.has(state.spirit)) state.spirit = 'All';
  const names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));

  const make = (value, label) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.dataset.value = value;
    b.addEventListener('click', () => { state.spirit = value; syncChips(); update(); });
    return b;
  };
  chipsEl.replaceChildren(make('All', `All (${state.all.length})`), ...names.map((n) => make(n, `${n} (${counts.get(n)})`)));
  syncChips();
}

function dataChanged() {
  buildChips();
  update();
}

function setChrome() {
  const live = state.mode === 'live';
  addBtn.hidden = !live;
  refreshBtn.hidden = !live;
  settingsBtn.textContent = live ? 'Connected' : 'Settings';
  settingsBtn.classList.toggle('connected', live);
}

/* ---------- Loading ---------- */

async function loadDemo() {
  state.mode = 'demo';
  setChrome();
  try {
    const res = await fetch(CSV_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.all = csvToRaw(parseCSV(await res.text())).map(normalize);
    showBanner('Showing sample data (read-only). Open Settings to connect your sheet.', 'info');
  } catch (err) {
    state.all = [];
    showBanner(`Couldn't load the sample data (${err.message}).`, 'error');
  }
  dataChanged();
}

async function load({ silent = false } = {}) {
  const cfg = api.config();
  if (!cfg) return loadDemo();

  state.mode = 'live';
  setChrome();
  if (!silent) countEl.textContent = 'Loading your sheet…';
  try {
    const items = await api.list(cfg);
    state.all = items.map(normalize);
    state.lastLoad = Date.now();
    hideBanner();
  } catch (err) {
    if (silent) {
      toast(`Couldn't refresh: ${err.message}`, 'error');
      return;
    }
    state.all = [];
    showBanner(`Couldn't load your sheet: ${err.message} Open Settings to check the URL and passcode.`, 'error');
  }
  dataChanged();
}

/* ---------- Writes ---------- */

async function guarded(fn) {
  state.pending++;
  try { return await fn(); } finally { state.pending--; }
}

// Quick score change on a card: shows immediately, rolls back if the sheet says no.
async function saveScore(c, value) {
  const trimmed = String(value).trim();
  let score = '';
  if (trimmed !== '') {
    score = Number(trimmed);
    if (!Number.isFinite(score) || score < 0 || score > 10) {
      toast('Score has to be a number from 0 to 10.', 'error');
      return;
    }
  }
  const i = indexOfId(c.id);
  if (i < 0) return;
  const old = state.all[i];
  if ((score === '' ? null : score) === old.score) return;
  state.all[i] = normalize({ ...toRaw(old), score });
  update();
  try {
    const item = await guarded(() => api.update(c.id, { score }));
    const j = indexOfId(c.id);
    if (j >= 0) state.all[j] = normalize(item);
    update();
    toast(`${c.name}: ${item.score ?? 'no score'} saved`);
  } catch (err) {
    const j = indexOfId(c.id);
    if (j >= 0) state.all[j] = old;
    update();
    toast(`Not saved: ${err.message}`, 'error');
  }
}

/* ---------- Add / edit dialog ---------- */

function fillDatalists() {
  const fill = (id, values) => {
    $(id).replaceChildren(...[...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => {
      const o = document.createElement('option'); o.value = v; return o;
    }));
  };
  fill('base-list', state.all.map((c) => c.baseRaw));
  fill('source-list', state.all.map((c) => c.source));
}

function openEditor(c) {
  state.editingId = c ? c.id : null;
  $('edit-title').textContent = c ? 'Edit cocktail' : 'Add a cocktail';
  editForm.reset();
  fillDatalists();
  if (c) {
    editForm.name.value = c.name;
    editForm.score.value = c.score === null ? '' : String(c.score);
    editForm.base.value = c.baseRaw;
    editForm.ingredients.value = c.ingredientsText;
    editForm.instructions.value = c.instructions;
    editForm.notes.value = c.notes;
    editForm.source.value = c.source;
  }
  deleteBtn.hidden = !c;
  resetDeleteBtn();
  editError.hidden = true;
  editSave.disabled = false;
  editSave.textContent = 'Save';
  editDialog.showModal();
  editForm.name.focus();
}

function formValues() {
  const f = editForm;
  const s = f.score.value.trim();
  return {
    name: f.name.value.trim(),
    score: s === '' ? '' : Number(s),
    base: f.base.value.trim(),
    ingredients: f.ingredients.value,
    instructions: f.instructions.value,
    notes: f.notes.value,
    source: f.source.value.trim(),
  };
}

editForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const values = formValues();
  if (!values.name) { editError.textContent = 'Give it a name.'; editError.hidden = false; return; }
  if (values.score !== '' && (!Number.isFinite(values.score) || values.score < 0 || values.score > 10)) {
    editError.textContent = 'Score has to be a number from 0 to 10.'; editError.hidden = false; return;
  }

  editSave.disabled = true;
  editSave.textContent = 'Saving…';
  editError.hidden = true;
  try {
    if (state.editingId === null) {
      const item = await guarded(() => api.add(values));
      state.all.unshift(normalize(item));
      state.open.add(item.id);
      toast(`Added ${item.name}`);
    } else {
      const old = state.all[indexOfId(state.editingId)];
      const rawOld = toRaw(old);
      const patch = {};
      Object.keys(values).forEach((k) => {
        const before = k === 'score' ? (rawOld.score === null ? '' : rawOld.score) : rawOld[k];
        if (values[k] !== before) patch[k] = values[k];
      });
      if (Object.keys(patch).length === 0) { editDialog.close(); return; }
      const item = await guarded(() => api.update(state.editingId, patch));
      const j = indexOfId(state.editingId);
      if (j >= 0) state.all[j] = normalize(item);
      toast(`${item.name} saved`);
    }
    editDialog.close();
    dataChanged();
  } catch (err) {
    editError.textContent = err.message;   // keep the dialog open so nothing typed is lost
    editError.hidden = false;
    editSave.disabled = false;
    editSave.textContent = 'Save';
  }
});

$('edit-cancel').addEventListener('click', () => editDialog.close());

// Delete needs a second click.
let deleteArmed = false, deleteTimer;
function resetDeleteBtn() {
  deleteArmed = false;
  clearTimeout(deleteTimer);
  deleteBtn.textContent = 'Delete';
  deleteBtn.classList.remove('armed');
}
deleteBtn.addEventListener('click', async () => {
  if (!deleteArmed) {
    deleteArmed = true;
    deleteBtn.textContent = 'Click again to delete';
    deleteBtn.classList.add('armed');
    deleteTimer = setTimeout(resetDeleteBtn, 4000);
    return;
  }
  resetDeleteBtn();
  deleteBtn.disabled = true;
  try {
    const id = state.editingId;
    const name = state.all[indexOfId(id)]?.name;
    await guarded(() => api.remove(id));
    state.all = state.all.filter((c) => c.id !== id);
    state.open.delete(id);
    editDialog.close();
    dataChanged();
    toast(`Deleted ${name || 'cocktail'}`);
  } catch (err) {
    editError.textContent = err.message;
    editError.hidden = false;
  } finally {
    deleteBtn.disabled = false;
  }
});

/* ---------- Settings dialog ---------- */

function openSettings() {
  const cfg = api.config();
  settingsForm.url.value = cfg ? cfg.url : '';
  settingsForm.key.value = '';
  settingsForm.key.required = !cfg;
  settingsForm.key.placeholder = cfg ? 'Saved. Leave blank to keep it.' : '';
  $('disconnect-btn').hidden = !cfg;
  settingsMsg.hidden = true;
  $('settings-save').disabled = false;
  $('settings-save').textContent = 'Save and connect';
  settingsDialog.showModal();
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const previous = api.config();
  const url = settingsForm.url.value.trim();
  const key = settingsForm.key.value || (previous ? previous.key : '');
  const btn = $('settings-save');

  if (!api.isValidUrl(url)) {
    settingsMsg.textContent = 'That doesn\'t look like a Google Apps Script web app link. It should start with https://script.google.com/ and end in /exec.';
    settingsMsg.hidden = false;
    return;
  }
  btn.disabled = true; btn.textContent = 'Connecting…'; settingsMsg.hidden = true;
  try {
    const items = await api.list({ url, key });   // test before saving anything
    api.setConfig({ url, key });
    state.all = items.map(normalize);
    state.mode = 'live';
    state.lastLoad = Date.now();
    hideBanner(); setChrome(); dataChanged();
    settingsDialog.close();
    toast(`Connected. ${items.length} cocktails loaded.`);
  } catch (err) {
    settingsMsg.textContent = err.message;
    settingsMsg.hidden = false;
    btn.disabled = false; btn.textContent = 'Save and connect';
  }
});

$('disconnect-btn').addEventListener('click', async () => {
  api.setConfig(null);
  settingsDialog.close();
  state.open.clear();
  await loadDemo();
  toast('Disconnected. This browser forgot the passcode.');
});
$('settings-cancel').addEventListener('click', () => settingsDialog.close());

/* ---------- Wiring ---------- */

searchEl.addEventListener('input', () => { state.query = searchEl.value; update(); });
minScoreEl.addEventListener('input', () => {
  state.minScore = parseFloat(minScoreEl.value);
  minScoreOut.textContent = state.minScore.toFixed(1).replace(/\.0$/, '');
  update();
});
sortEl.addEventListener('change', () => { state.sort = sortEl.value; update(); });

addBtn.addEventListener('click', () => openEditor(null));
settingsBtn.addEventListener('click', openSettings);
refreshBtn.addEventListener('click', async () => { await load(); toast('Refreshed from your sheet'); });

// Pick up edits made in the sheet itself (or by the daily-find workflow) when you come back to the tab.
function maybeRefresh() {
  if (document.visibilityState !== 'visible') return;
  if (state.mode !== 'live' || state.pending > 0) return;
  if (editDialog.open || settingsDialog.open) return;
  if (Date.now() - state.lastLoad < REFRESH_AFTER_MS) return;
  load({ silent: true });
}
document.addEventListener('visibilitychange', maybeRefresh);
window.addEventListener('focus', maybeRefresh);

load();
