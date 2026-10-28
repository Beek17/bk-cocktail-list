/**
 * BK's Cocktail List: backend API.
 *
 * Container-bound script that lives inside the master Google Sheet.
 * Deploy it as a Web app (Execute as: Me, Who has access: Anyone).
 * Every request must carry the PASSCODE stored in Script properties,
 * so the URL alone gets a stranger nothing.
 *
 * The site talks to it with POST requests whose body is JSON:
 *   { action: 'list' | 'add' | 'update' | 'delete', key: '<passcode>', ... }
 *
 * Columns are matched by header name, so column order doesn't matter.
 * A column named "ID" is added at the end on first run.
 */

const FIELDS = {
  name: 'cocktail',
  score: 'score',
  ingredients: 'ingredients',
  instructions: 'instructions',
  notes: 'bksnotes',
  base: 'basespirit',
  source: 'source',
  added: 'dateadded',
};
const TEXT_LIMIT = 5000;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/* ---------- One-time setup (run this from the editor) ---------- */

function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('PASSCODE');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('PASSCODE', key);
  }
  const sh = sheet_();
  const col = layout_(sh);
  const items = readAll_(sh, col);
  Logger.log('Sheet "%s": %s cocktails ready, IDs assigned.', sh.getName(), items.length);
  Logger.log('Your passcode is: %s', key);
  Logger.log('(Change it any time: Project Settings > Script properties > PASSCODE.)');
}

/* ---------- Web app entry points ---------- */

function doGet() {
  // Deliberately returns no data.
  return json_({ ok: true, service: 'cocktail-list' });
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(req.key);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      out = route_(req);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(given) {
  const want = PropertiesService.getScriptProperties().getProperty('PASSCODE');
  if (!want) throw new Error('No PASSCODE set. Run setup() once in the Apps Script editor.');
  const a = String(given || '');
  let diff = a.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (a.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  if (diff !== 0) {
    Utilities.sleep(1000); // slow down guessing
    throw new Error('Wrong passcode');
  }
}

function route_(req) {
  switch (req.action) {
    case 'list': return list_();
    case 'add': return add_(req);
    case 'update': return update_(req);
    case 'delete': return delete_(req);
    default: throw new Error('Unknown action: ' + req.action);
  }
}

/* ---------- Actions ---------- */

function list_() {
  const sh = sheet_();
  const col = layout_(sh);
  return { ok: true, items: readAll_(sh, col) };
}

function add_(req) {
  const item = clean_(req.item || {});
  if (!item.name) throw new Error('Name is required');
  if (item.added === undefined) item.added = today_();

  const sh = sheet_();
  const col = layout_(sh);
  const width = sh.getLastColumn();
  const row = new Array(width).fill('');
  setFields_(row, col, item);
  const id = newId_();
  row[col.id] = id;

  // Newest on top, matching how the sheet is kept. Copy the look of the row below.
  sh.insertRowBefore(2);
  if (sh.getLastRow() > 2) {
    sh.getRange(3, 1, 1, width).copyTo(sh.getRange(2, 1, 1, width), SpreadsheetApp.CopyPasteType.PASTE_FORMAT);
  }
  sh.getRange(2, 1, 1, width).setValues([row]);
  return { ok: true, item: toItem_(row, col) };
}

function update_(req) {
  const patch = clean_(req.patch || {});
  if ('name' in patch && !patch.name) throw new Error('Name can\'t be blank');
  const sh = sheet_();
  const col = layout_(sh);
  const r = findRow_(sh, col, req.id);

  Object.keys(patch).forEach(function (k) {
    const c = col[FIELDS[k]];
    if (c === undefined) return;
    sh.getRange(r, c + 1).setValue(cellValue_(k, patch[k]));
  });
  const row = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
  return { ok: true, item: toItem_(row, col) };
}

function delete_(req) {
  const sh = sheet_();
  const col = layout_(sh);
  sh.deleteRow(findRow_(sh, col, req.id));
  return { ok: true };
}

/* ---------- Sheet helpers ---------- */

function sheet_() {
  const name = PropertiesService.getScriptProperties().getProperty('SHEET_NAME');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = name ? ss.getSheetByName(name) : ss.getSheets()[0];
  if (!sh) throw new Error('Sheet tab not found: ' + name);
  return sh;
}

function norm_(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Header name -> 0-based column index. Adds an ID column if missing.
function layout_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  head.forEach(function (h, i) {
    const k = norm_(h);
    if (k && !(k in col)) col[k] = i;
  });
  if (!('cocktail' in col)) throw new Error('No "Cocktail" column found in row 1');
  if (!('id' in col)) {
    sh.getRange(1, lastCol + 1).setValue('ID');
    col.id = lastCol;
  }
  return col;
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function today_() {
  const d = new Date();
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'M/d/yyyy');
}

function readAll_(sh, col) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const width = sh.getLastColumn();
  const range = sh.getRange(2, 1, lastRow - 1, width);
  const values = range.getValues();

  // Rows added by hand (or by another tool) have no ID yet: give them one.
  let needIds = false;
  const ids = values.map(function (row) {
    const hasName = String(row[col.cocktail]).trim() !== '';
    if (hasName && !row[col.id]) {
      needIds = true;
      row[col.id] = newId_();
    }
    return [row[col.id]];
  });
  if (needIds) sh.getRange(2, col.id + 1, ids.length, 1).setValues(ids);

  return values
    .filter(function (row) { return String(row[col.cocktail]).trim() !== ''; })
    .map(function (row) { return toItem_(row, col); });
}

function toItem_(row, col) {
  const get = function (key) { return row[col[FIELDS[key]]]; };
  const raw = get('score');
  const num = typeof raw === 'number' ? raw : parseFloat(raw);
  const added = get('added');
  return {
    id: String(row[col.id]),
    name: String(get('name') || '').trim(),
    score: isFinite(num) ? num : null,
    ingredients: String(get('ingredients') || ''),
    instructions: String(get('instructions') || ''),
    notes: String(get('notes') || ''),
    base: String(get('base') || '').trim(),
    source: String(get('source') || '').trim(),
    added: Object.prototype.toString.call(added) === '[object Date]'
      ? Utilities.formatDate(added, Session.getScriptTimeZone(), 'M/d/yyyy')
      : String(added || '').trim(),
  };
}

function findRow_(sh, col, id) {
  if (!id) throw new Error('Missing id');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('Cocktail not found (it may have been deleted)');
  const ids = sh.getRange(2, col.id + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  throw new Error('Cocktail not found (it may have been deleted)');
}

function setFields_(row, col, item) {
  Object.keys(item).forEach(function (k) {
    const c = col[FIELDS[k]];
    if (c !== undefined) row[c] = cellValue_(k, item[k]);
  });
}

// Stop text that starts with = + - @ from being treated as a formula.
function cellValue_(key, v) {
  if (key === 'score') return v;
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Validate and trim incoming fields. Only keys that were sent are kept.
function clean_(src) {
  const out = {};
  ['name', 'base', 'source'].forEach(function (k) {
    if (k in src) out[k] = String(src[k] == null ? '' : src[k]).trim().slice(0, 200);
  });
  ['ingredients', 'instructions', 'notes'].forEach(function (k) {
    if (k in src) out[k] = String(src[k] == null ? '' : src[k]).replace(/\s+$/, '').slice(0, TEXT_LIMIT);
  });
  if ('score' in src) {
    if (src.score === '' || src.score === null) {
      out.score = '';
    } else {
      const n = Number(src.score);
      if (!isFinite(n) || n < 0 || n > 10) throw new Error('Score must be a number from 0 to 10');
      out.score = Math.round(n * 100) / 100;
    }
  }
  if ('added' in src) {
    const a = String(src.added || '').trim();
    if (a && !DATE_RE.test(a)) throw new Error('Date must look like 10/28/2026');
    out.added = a;
  }
  return out;
}
