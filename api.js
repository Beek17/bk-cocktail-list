'use strict';

/*
 * Talks to the Google Apps Script web app that sits on the sheet.
 * The URL and passcode live only in this browser's localStorage.
 * They are never in the repo.
 */
const api = (() => {
  const KEY = 'cocktail-list-connection';
  let memory = null; // fallback if localStorage is blocked

  // Passcodes only ever go to Google's script host (or localhost, for testing).
  const URL_OK = /^(https:\/\/script\.google\.com\/.+\/exec|http:\/\/(localhost|127\.0\.0\.1):\d+\/.*)$/;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* blocked or corrupt: fall through */ }
    return memory;
  }

  function save(cfg) {
    memory = cfg;
    try {
      if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
      else localStorage.removeItem(KEY);
    } catch (e) { /* in-memory only this session */ }
  }

  async function call(cfg, action, payload) {
    if (!cfg || !URL_OK.test(cfg.url)) {
      throw new Error('That URL doesn\'t look like a Google Apps Script web app link (it should end in /exec).');
    }
    let res;
    try {
      res = await fetch(cfg.url, {
        method: 'POST',
        // text/plain keeps this a "simple" request, so no CORS preflight (Apps Script can't answer one).
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, key: cfg.key, ...payload }),
        redirect: 'follow',
      });
    } catch (e) {
      throw new Error('Couldn\'t reach the sheet. Check your connection and the web app URL.');
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('The sheet didn\'t answer properly. Is the web app deployed with access set to "Anyone"?');
    }
    if (!data.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    config: load,
    setConfig: save,
    isValidUrl: (u) => URL_OK.test(u),
    list: (cfg = load()) => call(cfg, 'list').then((d) => d.items),
    add: (item) => call(load(), 'add', { item }).then((d) => d.item),
    update: (id, patch) => call(load(), 'update', { id, patch }).then((d) => d.item),
    remove: (id) => call(load(), 'delete', { id }),
  };
})();
