# Inspiration Archive — Chrome extension

Save the current tab to your Inspiration Archive in one click. Pick channels (or create one inline) — same UX as Are.na's Connect popup.

## Install (developer mode)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked** and pick this `extension/` directory
4. Pin the icon to the toolbar
5. Open the extension's options page (right-click the icon → Options) and paste:
   - **Archive URL** — e.g. `http://localhost:3000` for local dev or your deployed URL
   - **API token** — any random string. Set the same value as `ARCHIVE_API_TOKEN` in the archive's `.env.local` (and in Vercel env vars when deployed).

## Use

Click the toolbar icon on any page. The popup pre-fills the title from the tab. Type to search for an existing channel or create a new one. Multi-select. Click **Connect to N channels** — the page is saved with the OG image and description fetched server-side.

## Files

- `manifest.json` — Manifest V3
- `popup.html`, `popup.js`, `popup.css` — the Connect modal
- `options.html`, `options.js` — settings page
- `icons/` — toolbar/store icons (placeholder; replace with real artwork later)
