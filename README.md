# BK's Cocktail List

A searchable, scored cocktail collection. Static site, no build step, hosted on GitHub Pages.

## How it works

- `index.html`, `style.css`, `app.js`, `api.js` are the whole site. No build step.
- Until you connect it, the site shows sample data from `data/cocktails.csv`, read-only.
- Once connected (Settings), it reads and writes your Google Sheet through a small Apps Script web app (`apps-script/Code.gs`). Add recipes, edit anything, change scores from the site. Edits made in the sheet show up on the site.
- The web app URL and passcode live only in your browser. Your real data is never in this repo.

Setup guide: [docs/SETUP.md](docs/SETUP.md).

## Running it locally

Browsers block `fetch` on `file://` pages, so serve the folder instead of double-clicking `index.html`:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Heads up

This repo is public. The CSV in it is sample data only. Don't put your real list here; it belongs in the Google Sheet, behind the passcode.
