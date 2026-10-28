# BK's Cocktail List

A searchable, scored cocktail collection. Static site, no build step, hosted on GitHub Pages.

## How it works

- `data/cocktails.csv` is the whole database. It's a straight export of the master Google Sheet.
- `app.js` loads that file in the browser, parses it, and renders the cards.
- `index.html` and `style.css` are the page and the look.

Columns the site expects, in any order: `Cocktail`, `Score`, `Ingredients`, `Instructions`, `BK's Notes`, `Base Spirit`, `Source`, `Date Added`.

## Updating the list

1. In the Google Sheet: File > Download > Comma Separated Values (.csv).
2. Create a branch, upload the file over `data/cocktails.csv`, open a pull request, merge.
3. GitHub Pages republishes in about a minute.

## Running it locally

Browsers block `fetch` on `file://` pages, so serve the folder instead of double-clicking `index.html`:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Heads up

This repo is public, so everything in the CSV is public, including scores and notes.
