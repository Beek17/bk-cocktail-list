'use strict';

const CSV_PATH = 'data/cocktails.csv';

const state = {
  all: [],
  query: '',
  spirit: 'All',
  minScore: 0,
  sort: 'score',
};

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
/* ---------- CSV ---------- */

// Proper CSV parser: handles quoted fields, commas and newlines inside
// quotes, and "" as an escaped quote. Google Sheets exports need all of it.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normKey = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, ''); // "BK's Notes" -> "bksnotes"

function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : 0;
}

function toCocktails(rows) {
  const [header, ...body] = rows;
  const col = {};
  header.forEach((h, i) => { col[normKey(h)] = i; });
  const get = (r, key) => (r[col[key]] ?? '').trim();

  return body
    .filter((r) => get(r, 'cocktail') !== '')
    .map((r) => {
      const rawScore = parseFloat(get(r, 'score'));
      const c = {
        name: get(r, 'cocktail'),
        score: Number.isFinite(rawScore) ? rawScore : null,
        ingredients: get(r, 'ingredients').split('\n').map((l) => l.trim()).filter(Boolean),
        instructions: get(r, 'instructions'),
        notes: get(r, 'bksnotes'),
        base: get(r, 'basespirit') || 'Other',
        source: get(r, 'source'),
        added: get(r, 'dateadded'),
        addedTs: parseDate(get(r, 'dateadded')),
      };
      c.haystack = [c.name, c.ingredients.join(' '), c.notes].join(' ').toLowerCase();
      return c;
    });
}

/* ---------- Filtering + sorting ---------- */

const byName = (a, b) => a.name.localeCompare(b.name);

const SORTERS = {
  // unscored drinks sink to the bottom
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1) || byName(a, b),
  newest: (a, b) => b.addedTs - a.addedTs || byName(a, b),
  name: byName,
};

function visible() {
  let out = state.all.slice();

  return out.sort(SORTERS[state.sort]);
}

/* ---------- Rendering ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scoreTier(score) {
  if (score === null) return ' none';
  if (score >= 9) return ' gold';
  if (score >= 8) return ' amber';
  return '';
}

function card(c) {
  const details = el('details', 'card');

  const summary = el('summary');
  summary.append(el('span', 'score' + scoreTier(c.score), c.score === null ? '–' : c.score.toFixed(1)));
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
  details.append(body);

  return details;
}

function render(list) {
  const frag = document.createDocumentFragment();
  list.forEach((c) => frag.append(card(c)));
  listEl.replaceChildren(frag);

  const total = state.all.length;
  countEl.textContent = list.length === total
    ? `${total} cocktails`
    : `${list.length} of ${total} cocktails`;
  emptyEl.hidden = list.length > 0;
}

function update() {
  render(visible());
}

/* ---------- Controls ---------- */

/* ---------- Boot ---------- */

async function init() {
  try {
    const res = await fetch(CSV_PATH);
    if (!res.ok) throw new Error(`Couldn't load ${CSV_PATH} (HTTP ${res.status})`);
    state.all = toCocktails(parseCSV(await res.text()));
    update();
  } catch (err) {
    countEl.textContent = 'Something broke loading the list. Check data/cocktails.csv.';
    console.error(err);
  }
}

init();
