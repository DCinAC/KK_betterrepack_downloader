# BetterRepack `.zipmod` Bulk Downloader

A Tampermonkey / Violentmonkey userscript that adds a one-click bulk-download toolbar to BetterRepack Sideloader directory listings.

> Pure-CSS download icon — light + dark themes. Preview standalone in [`docs/download-icon.html`](docs/download-icon.html).

## What it does

Injects a sticky toolbar above the file list with a single split **Download** button. Click the main half to fire your saved default; click the caret to pick a mode:

- **Direct download** — sequential browser triggers, no `download=` attribute, so IDM / FDM browser extensions can still sniff the request
- **Copy links to clipboard** — paste straight into IDM or FDM's *Add Batch Download* dialog
- **Save URL list (.txt)** — dump every URL to a text file
- **Send to Motrix / aria2** — JSON-RPC push with optional secret, base directory, and per-page subfolder

On first launch the main button opens the menu and prompts you to pick a default. Your choice persists; the menu shows a `✓` on the current one. Change it any time by reopening the menu and picking a different mode.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Install the script:
   - **Greasy Fork:** *(link once published)*
   - **From this repo:** open [`betterrepack-bulk-dl.user.js`](betterrepack-bulk-dl.user.js) → *Raw* → your userscript manager will offer to install.

## Settings

Open the **Settings…** entry at the bottom of the dropdown.

| Setting | Default | Notes |
|---|---|---|
| RPC URL | `http://localhost:16800/jsonrpc` | Motrix default. Use `:6800/jsonrpc` for plain aria2 / Aria2 Explorer. |
| RPC secret | *(empty)* | Motrix → Preferences → Advanced → *RPC Secret*. Aria2 daemons started with `--rpc-secret=…`. |
| Base download directory | *(empty)* | Absolute path. Empty defers to the download manager's default. |
| Save into subfolder derived from the URL | **on** | Builds e.g. `KKEC-Sideloader%20Modpack-Noble_kale` from the page URL. Live preview in the dialog. RPC mode only. |
| Sequential download delay | `800` ms | Used by *Direct download* mode |

**Test connection** sends an `aria2.getVersion` to the URL + secret currently in the form, with a toast describing the result — handy before committing changes.

## Compatibility

- **Pages:** `http(s)://sideload.betterrepack.com/*`
- **Userscript managers:** Tampermonkey 4.x, Violentmonkey 2.x
- **APIs used:** `GM_setClipboard`, `GM_xmlhttpRequest`, `GM_setValue`/`GM_getValue`, `GM_registerMenuCommand`

## Notes / known limits

- Per-page subfolder and base directory only take effect for **Motrix / aria2** sends. The browser, IDM, and FDM paths can't be told a target folder from a userscript.
- Folder names keep `%20` verbatim rather than decoding to a space. If you prefer decoded names, flip one line in `computeSubfolder()`.

## License

[GPL-3.0-or-later](LICENSE).
