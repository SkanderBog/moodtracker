"use strict";
/*
 * Mood Tracker — Electron main process.
 *
 * Creates a small, frameless, transparent, always-on-top widget window in the
 * top-right corner that loads widget.html. It also makes sure the shared-log
 * server (server.js) is running, so the widget (and the userscript / standalone
 * page) all read and write the same log.
 */
const { app, BrowserWindow, screen, Menu, ipcMain } = require("electron");
const path = require("path");
const { startServer } = require("./server.js");

const PORT = 8686;
const BASE = `http://localhost:${PORT}`;

let widget = null;
let collapsed = false;
let expanded = false;

function widgetSize() {
  if (collapsed) return { w: 48, h: 48 };
  return expanded ? { w: 300, h: 104 } : { w: 300, h: 56 };
}
function positionWidget() {
  if (!widget) return;
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, h } = widgetSize();
  widget.setBounds({ x: wa.x + wa.width - w - 14, y: wa.y + 14, width: w, height: h });
}

function openHistory() {
  const win = new BrowserWindow({
    width: 940, height: 780, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(BASE + "/");
}

function createWidget() {
  widget = new BrowserWindow({
    width: 300, height: 56,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, nativeWindowOpen: true,
    },
  });
  widget.setAlwaysOnTop(true, "screen-saver");
  widget.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionWidget();
  widget.loadURL(BASE + "/widget.html");

  widget.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE)) {
      return { action: "allow", overrideBrowserWindowOptions: { width: 940, height: 780, autoHideMenuBar: true } };
    }
    return { action: "deny" };
  });

  widget.webContents.on("context-menu", () => {
    Menu.buildFromTemplate([
      { label: "Open history", click: openHistory },
      { type: "separator" },
      { label: "Quit Mood Tracker", click: () => app.quit() },
    ]).popup({ window: widget });
  });

  widget.on("closed", () => { widget = null; });
}

ipcMain.on("open-history", openHistory);
ipcMain.on("set-collapsed", (e, c) => { collapsed = !!c; expanded = false; positionWidget(); });
ipcMain.on("set-expanded", (e, c) => { expanded = !!c; positionWidget(); });
ipcMain.on("quit", () => app.quit());

app.whenReady().then(async () => {
  // Run the shared-log server in-process (Electron's main process IS Node), so
  // the packaged app has no external `node` dependency. Data lives under the
  // OS's per-user app-data dir, which stays writable inside a packaged app.
  try {
    await startServer({ dataDir: path.join(app.getPath("userData"), "data") });
  } catch (e) {
    console.error("[mood] server failed to start:", e && e.message);
  }
  createWidget();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWidget(); });
});

app.on("window-all-closed", () => app.quit());
