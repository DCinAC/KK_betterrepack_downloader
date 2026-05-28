# Changelog

All notable changes to this project will be documented in this file.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-29

### Added
- **Subfolder-from-URL** setting (on by default). Derives a folder name from the current page path — e.g. `/download/KKEC/Sideloader%20Modpack/Noble_kale/` becomes `KKEC-Sideloader%20Modpack-Noble_kale` — and appends it to the base directory for *Send to Motrix / aria2* downloads.
- Live preview of the resolved download path inside the Settings dialog.

### Changed
- Renamed *Download directory* → *Base download directory* in the Settings dialog.

## [1.1.0]

### Added
- Split **Download** button: clicking the main half runs the user's saved default mode; clicking the caret opens the menu.
- Persisted *default action* (one of *Direct download*, *Copy links to clipboard*, *Save URL list*, *Send to Motrix / aria2*).
- Menu items render a `✓` next to the current default; picking any mode both persists it and executes it.
- First-launch flow: clicking the main button without a saved default opens the menu and toasts a "pick a default" hint.
- **Test connection** button in the Settings dialog (sends `aria2.getVersion` against the URL + secret currently in the form).

### Changed
- Detailed RPC error reporting — HTTP status, JSON-RPC error code/message, or network-error reason now surface in the failure toast and console.

## [1.0.0]

### Added
- Initial release.
- Bulk actions: *Copy URLs*, *Save URL list (.txt)*, *Send to Motrix / aria2* (JSON-RPC), *Sequential browser download* (no `download=` so IDM/FDM extensions can sniff).
- Pure-CSS download icon (light + dark themes, `prefers-color-scheme` aware) inlined into the toolbar.
- Settings dialog: RPC URL, RPC secret, download directory, sequential delay.
- Tampermonkey menu commands: copy URLs, send to Motrix / aria2, open Settings.
