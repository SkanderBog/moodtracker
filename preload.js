"use strict";
// Bridges a small API from the widget renderer to the Electron main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mt", {
  openHistory: () => ipcRenderer.send("open-history"),
  setCollapsed: (c) => ipcRenderer.send("set-collapsed", !!c),
  setExpanded: (e) => ipcRenderer.send("set-expanded", !!e),
  quit: () => ipcRenderer.send("quit"),
});
