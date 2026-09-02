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
- [ ] Run `npm start` on a real desktop to smoke-test the widget (no display in the build env).
- [ ] Tag `v1.0.0` and push to trigger the first CI release; check the three installers.
- [ ] macOS is unsigned → first launch needs right-click → Open. Windows may warn → More info → Run anyway.
