# Mood Tracker

A tiny mood tracker with a 5-level scale (😢 🙁 😐 🙂 😄) and an optional
**"why"** note per entry. Every client below writes to **one shared log**, so a
mood recorded anywhere shows up everywhere else.

## Download a prebuilt app (Windows / macOS / Linux)

Binaries are built automatically by GitHub Actions. On the repo's **Releases**
page, grab:

- **Windows** — `MoodTracker Setup x.y.z.exe`
- **macOS** — `MoodTracker x.y.z.dmg` (or the `.zip`)
- **Linux** — `MoodTracker x.y.z.AppImage` (or the `.deb`)

No Node.js needed — download, run, done. macOS builds are unsigned, so the
first launch needs **right-click → Open** (Apple's Gatekeeper). Windows may show
a "Windows protected your PC" prompt → **More info → Run anyway**.

## What's in the folder

| File | What it is |
|------|-------------|
| `server.js` | The shared-log server (zero dependencies). Single source of truth — `data/moods.json`. |
| `client-store.js` | Shared JS the page + widget use to talk to the server. |
| `index.html` | The full timeline page (chart, stats, log). |
| `mood-tracker.user.js` | Tampermonkey userscript — floats a pill over every site. |
| `widget.html` + `main.js` + `preload.js` | The always-on-top desktop widget (Electron). |
| `package.json` | Electron config + scripts. |

## The shared log

The three clients can't share a log on their own — a browser can't write a disk
file, and each site has its own storage. So `server.js` is the single source of
truth: a tiny local web server at `http://localhost:8686`. Every client reads
and writes it. If the server isn't running, each client falls back to its own
local storage and syncs back when it reconnects.

## Quick start

### 1. Start the shared server (pick one)

```bash
node server.js                 # just the server
# OR start the widget, which auto-starts the server for you (step 4)
```

### 2. Standalone page (the full timeline)

Open **`http://localhost:8686/`** in your browser. Log moods in the top bar;
the chart, stats, and log update live.

### 3. Floating bar on every site (userscript)

1. Install **Tampermonkey** (or Violentmonkey).
2. Icon → **Create a new script** → paste all of `mood-tracker.user.js` → **Ctrl/Cmd-S**.

A pill now sits in the top-right of every page. Click a mood, type an optional
"why" (Enter to save, Esc to skip). 📊 opens the timeline. **—** collapses it.

### 4. Always-on-top widget (desktop) ⭐

Floats over **every app** (browser, Word, …), not just web pages.

```bash
# Install Electron + the packager once. In China use the mirror to avoid the GitHub block:
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  npm install --save-dev electron electron-builder --registry=https://registry.npmmirror.com

npm start                      # launches the always-on-top bar (the server runs inside it)
npm run dist                   # builds installers for the current OS into dist/
```

- The bar sits in the top-right, **above all windows**. Drag it to move it.
- Click 😢…😄 to log; a "why" box appears underneath (Enter saves, Esc skips).
- **—** collapses it to a tiny 🌤. **✕** quits (or right-click → Quit).
- **📊** opens the full timeline.

Stopping the widget (✕) also stops the server it runs.

## Notes

- **Scale/colors**: 5 levels with a diverging blue→gray→orange ramp, defined
  once in the `MOODS` array (userscript) / top of each script.
- **Storage**: the server writes `data/moods.json` next to the source when run
  standalone (`node server.js`), or to the OS per-user app-data dir when run
  inside the widget/package. Offline fallback is per-client (key
  `mood-tracker.local`) and syncs back on reconnect.
- **Export**: the timeline page exports CSV (includes the "why" column).
- **Port**: 8686 by default; override with `PORT=… node server.js`.

## Troubleshooting

**The widget won't stay on top / shows a black or opaque background (Linux).**
This happens on Wayland desktops (GNOME, KDE Plasma, etc.): Electron's native
Wayland backend has no "always on top" and many compositors lack per-pixel
transparency. The `start` script and the packaged Linux build already force
X11/XWayland for you. If you launch `electron .` by hand, add
`--ozone-platform=x11`.

**"The SUID sandbox helper binary ... is not configured correctly" (Linux).**
Electron refuses to start unless its `chrome-sandbox` is root-owned with the
setuid bit, or you pass `--no-sandbox`. `npm start` already passes
`--no-sandbox`; the packaged `.deb` sets the sandbox up on install and the
AppImage skips it internally, so this only bites when running the raw binary.

**macOS: "can't be opened because Apple cannot check it for malicious software."**
The build is unsigned. Right-click the app → **Open**, or System Settings →
Privacy & Security → **Open Anyway**.

**Windows: "Windows protected your PC" (SmartScreen).**
Also because the build is unsigned. Click **More info → Run anyway**.

**`npm install` hangs while "Downloading Electron binary..." (China).**
GitHub's release host is blocked/dropped on some networks. Use the mirror:
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```
(or `ELECTRON_MIRROR=… node node_modules/electron/install.js` if the packages
are already installed).

**`EADDRINUSE` / "port 8686 is already in use".**
Another copy of the server (or the widget, which runs it in-process) is still
running. Close it, or run standalone on a different port with
`PORT=8687 node server.js` (and point clients at the new port).

**The status dot is gray / "saving locally only".**
The shared-log server isn't reachable, so the client fell back to its local
store. It will push the backlog back to the server the next time it connects.
Check the terminal that launched the widget for a server error (usually the
port being taken).
