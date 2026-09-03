# Mood Tracker — progress notes

## 2026-09-02 — packaging for Windows / macOS / Linux

Goal: push to GitHub (private repo) and ship downloadable installers for all three OSes.

- Installed Electron + electron-builder (dev deps) via the China mirror for the
  Electron binary; lockfile generated against the default npm registry so CI is portable.
- Refactored the widget to be fully self-contained (required for a packaged app):
  - `server.js` now runs **in-process** in the Electron main process (was:
    `spawn("node", …)`, which fails on machines without Node installed).
    `startServer()` gained a `dataDir` option.
  - The shared log now lives in the OS per-user app-data dir
    (`app.getPath("userData")/data`), because a packaged `.asar` is read-only.
- Added electron-builder config (appId `com.skanderbog.moodtracker`, productName
  `MoodTracker`): targets dmg+zip (mac), nsis+zip (win), AppImage+deb (linux).
- Added `.github/workflows/build.yml`: builds all 3 OSes on tag `v*` or manual
  dispatch, uploads installers, publishes a draft GitHub Release on tags.
- macOS installers can only be built on macOS (Apple rule) — that's why CI does
  it in the cloud instead of locally.

Next / TODO:
- [x] Run `npm start` on a real desktop to smoke-test the widget.
- [ ] Tag `v1.0.0` and push to trigger the first CI release; check the three installers.
- [ ] macOS is unsigned → first launch needs right-click → Open. Windows may warn → More info → Run anyway.
- [ ] Packaged Linux app still needs the Wayland fix (see below) — `executableArgs` / `--ozone-platform=x11` on the release build, not just dev.

## 2026-09-03 — first smoke test on Linux/Wayland

Three things blocked `npm start` from launching a working always-on-top pill on
this machine (Ubuntu, Wayland/GNOME). All fixed in dev:

1. **Electron binary was never downloaded.** `npm install` had fetched the npm
   packages but the postinstall (which pulls the actual Electron binary from
   GitHub releases) was left incomplete, and it hung on the direct GitHub route.
   Fixed with the China mirror:
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`
2. **`chrome-sandbox` setuid error.** Electron aborts unless `chrome-sandbox` is
   root-owned mode 4755 (needs sudo) or you pass `--no-sandbox`. Dev uses
   `--no-sandbox` in the `start` script; the packaged deb sets the setuid bit
   itself and the AppImage wrapper already uses `--no-sandbox`.
3. **Always-on-top + transparency break on native Wayland.** Electron 44 auto-
   picks the Wayland backend, which has no `_NET_WM_STATE_ABOVE` and (on GNOME)
   no per-pixel alpha, so the pill rendered opaque and didn't float. Forcing
   X11/XWayland restores both. Note: `app.commandLine.appendSwitch('ozone-platform',
   'x11')` in `main.js` is **too late** — Chromium picks its backend before JS
   runs, and the half-applied switch segfaulted the GPU process. The flag has to
   be a real command-line arg, hence `--ozone-platform=x11` in the `start` script.

CI note: the first tag build (2026-09-02) **failed** — the installers actually
built fine, but electron-builder saw the `v*` git tag and auto-published to
GitHub Releases with the build job's read-only `GITHUB_TOKEN` → `403 Forbidden`
("Resource not accessible by integration"). Fix: `"publish": null` in the build
config, so electron-builder never publishes and the `release` job (which has
`contents: write`) uploads the artifacts as a draft release instead.
