# Connect the site to your Google Sheet

One-time setup, about 10 minutes. After this the site reads and writes your master sheet directly: change a score or add a recipe on the site and it lands in the sheet, edit the sheet (or let the daily-find workflow add a row) and it shows up on the site.

Nothing about your data is stored in this repo. The site only knows the sample data until you connect it.

## How the pieces fit

```
Browser (this site)  --passcode-->  Apps Script web app  -->  your Google Sheet
```

- The **Apps Script** (`apps-script/Code.gs`) lives inside your sheet and acts as the API. It only answers requests that carry your passcode.
- The **URL and passcode** are saved in your browser only (localStorage), per device. They are never committed anywhere.

## Steps

1. **Open the master sheet.** Extensions > Apps Script.
2. **Paste the script.** Delete the placeholder `myFunction`, paste the full contents of [`apps-script/Code.gs`](../apps-script/Code.gs), and click Save (name the project anything, e.g. "Cocktail API").
3. **Run setup once.** In the function dropdown at the top pick `setup`, click Run.
   - Google asks for permission. Click Review permissions, pick your account. You'll see "Google hasn't verified this app". That's normal for your own script. Click Advanced > Go to Cocktail API (unsafe) > Allow.
   - When it finishes, open the Execution log. It prints **your passcode**. Copy it somewhere safe (a password manager is ideal).
   - `setup` also adds an **ID** column at the far right of the sheet and gives every row an ID. Columns A to H are not touched, so anything that reads the sheet by position keeps working.
4. **Deploy it.** Deploy > New deployment > gear icon > Web app.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click Deploy, then copy the **Web app URL** (ends in `/exec`).
5. **Connect the site.** Open the site > Settings > paste the URL and the passcode > Save and connect. You should see "Connected" and your real cocktails.
6. **Repeat step 5 on your phone** (each device keeps its own connection).

## Day to day

- **Change a score fast:** expand a card, type the new score, Save score (or press Enter).
- **Edit anything:** expand a card > Edit.
- **Add a recipe:** + Add. New recipes go to the top of the sheet with today's date.
- **Delete:** Edit > Delete (asks twice). If you ever delete the wrong one, recover it from File > Version history in the sheet.
- **See sheet changes:** the site re-reads the sheet when you come back to the tab after 30 seconds. The Refresh button does it immediately.

## Good to know

- **"Anyone" access** means anyone who has the URL can send it requests, but every request needs the passcode and wrong guesses are slowed down. Treat the passcode like a password. Don't paste the URL and passcode together anywhere public.
- **Rotate the passcode:** Apps Script > Project Settings > Script properties > edit `PASSCODE`. Then re-enter it in Settings on each device.
- **If your cocktails aren't on the first tab** of the spreadsheet, add a script property `SHEET_NAME` with the tab's name.
- **Header names matter, order doesn't.** The script finds columns by header: Cocktail, Score, Ingredients, Instructions, BK's Notes, Base Spirit, Source, Date Added. Don't rename those.
- **Rows added outside the site** (typed by hand, or by another tool) get an ID automatically the next time the site loads.
- **Changing the script later:** paste the new code, then Deploy > Manage deployments > pencil icon > Version: New version > Deploy. The URL stays the same.

## If something's off

| What you see | Likely cause |
|---|---|
| "Wrong passcode" | Typo, or the `PASSCODE` script property was changed |
| "Couldn't reach the sheet" | URL typo, or you're offline |
| "The sheet didn't answer properly" | Deployment access isn't set to **Anyone**, or you didn't re-deploy a new version after editing the script |
| "No PASSCODE set" | `setup` hasn't been run yet |
| "Cocktail not found" | It was deleted elsewhere. Hit Refresh |
