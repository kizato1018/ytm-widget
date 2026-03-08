# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full app development (starts Vite + Tauri)
npm run tauri dev

# Build for production
npm run tauri build

# Frontend only (no Tauri, for UI iteration)
npm run dev
```

There are no automated tests in this project.

## Architecture

This is a **Tauri v2** desktop app — a YouTube Music controller widget. It uses **vanilla JS + Vite** for the frontend and **Rust** for the backend.

### Window Structure

Three windows exist at runtime:

| Label | Purpose |
|---|---|
| `main` | The 320x160 transparent widget overlay (defined in `tauri.conf.json`) |
| `settings` | Settings panel (hidden by default, opened from tray menu) |
| `ytm-bg` | A WebviewWindow dynamically created in `lib.rs` `setup()`, loads `music.youtube.com` |

The `ytm-bg` window is the core — it's a real browser tab running YouTube Music. The widget doesn't use any YTM API; it controls playback by injecting JavaScript.

### IPC Flow

1. `src/main.js` calls `invoke('execute_ytm_js', { script })` every 3 seconds to inject an agent script into `ytm-bg`
2. The injected agent script attaches event listeners to the `<video>` element and emits `ytm_status` events via `window.__TAURI__.event.emit()`
3. `src/main.js` listens for `ytm_status` events with `listen('ytm_status', ...)` and updates the UI
4. Playback commands (play/pause/seek/volume/next/prev) are sent by injecting JS snippets via `execute_ytm_js`

### Key Files

- **`src/main.js`** — All widget logic: window management, tray setup, agent script injection, UI state, playback commands
- **`src/index.html`** — Widget UI with inline CSS (no separate stylesheet); theming via CSS variables and `data-theme` attribute
- **`src/settings.js`** — Settings window: dark/light theme toggle, download path picker, autostart toggle
- **`src/assest/`** — Static assets (play/pause/next/back/volume/downloading icons); note the folder name is intentionally misspelled
- **`src-tauri/src/lib.rs`** — Rust backend: registers Tauri commands (`execute_ytm_js`, `download_music`), creates the `ytm-bg` window with platform-specific user agent in `setup()`

### State & Persistence

All persistent state uses `localStorage`:
- `ytm_theme` — `'dark'` or `'light'` (default: `'dark'`)
- `ytm_volume_pref` — float 0–1 (default: `0.5`)
- `download_path` — filesystem path for yt-dlp downloads
- `autostart_initialized` — flag for first-run autostart setup

### Theme System

Theme is applied by setting `data-theme` on `<html>`. Dark/light CSS variables are defined inline in `index.html`. The settings window broadcasts theme changes via Tauri events (`theme_changed`) so the widget updates without restart.

### Ad Handling

The injected agent script in `getAgentScript()` (in `main.js`) detects ads by querying `.ad-showing`, mutes/speeds up/skips them, and auto-dismisses YouTube Music popups (idle check, content warnings, promos). This runs on every `timeupdate` event.

### Tauri Plugins Used

- `tauri-plugin-autostart` — system startup registration
- `tauri-plugin-dialog` — folder picker
- `tauri-plugin-shell` — shell commands (for yt-dlp)
- `tauri-plugin-process` — `exit(0)` from tray menu

### External Dependencies

- **`yt-dlp`** — bundled as a Tauri sidecar (must be present in `src-tauri/binaries/`); used by `download_music` command to download audio as `.m4a`

### Settings Window Lifecycle

The `settings` window is **not** pre-declared in `tauri.conf.json`. It is created on demand via `new WebviewWindow('settings', ...)` when the tray menu item is clicked. If already open, it is shown and focused instead of re-created.
