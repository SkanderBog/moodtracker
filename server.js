#!/usr/bin/env node
"use strict";
/*
 * Mood Tracker — shared-log server (zero dependencies).
 *
 * The single source of truth for every client (userscript, standalone page,
 * always-on-top widget). Stores to data/moods.json and serves a tiny REST API
 * plus the static files in this folder.
 *
 *   GET    /api/moods        -> all entries
 *   POST   /api/moods        -> add { id?, t, m, why? }
 *   PATCH  /api/moods/:id    -> update { why?, m? }
 *   DELETE /api/moods/:id    -> remove one
 *   DELETE /api/moods        -> clear all
 *   GET    /                -> index.html (standalone page)
 *   GET    /widget.html     -> the always-on-top bar UI
 *
 * Run it:  node server.js
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT) || 8686;
const DIR = __dirname;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS));
  res.end(JSON.stringify(obj));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

function startServer({ port = PORT, dir = DIR, dataDir } = {}) {
  // The log can live outside the source tree (e.g. the OS app-data dir when
  // running inside a packaged Electron app, whose .asar is read-only).
  const dataPath = dataDir || path.join(dir, "data");
  const dataFile = path.join(dataPath, "moods.json");
  function loadEntries() {
    try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); }
    catch (e) { return []; }
  }
  function saveEntries(entries) {
    fs.mkdirSync(dataPath, { recursive: true });
    const tmp = dataFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
    fs.renameSync(tmp, dataFile);
  }
  let entries = loadEntries();

  const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, "http://localhost"); }
    catch (e) { return json(res, 400, { error: "bad url" }); }
    const p = decodeURIComponent(url.pathname);

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    /* ---- collection ---- */
    if (p === "/api/moods") {
      if (req.method === "GET") return json(res, 200, entries);

      if (req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on("end", () => {
          try {
            const e = JSON.parse(body || "{}");
            if (!e || !Number.isInteger(e.m) || e.m < 1 || e.m > 5) {
              return json(res, 400, { error: "mood must be an integer 1..5" });
            }
            const entry = {
              id: (typeof e.id === "string" && e.id) ? e.id : randomUUID(),
              t: Number(e.t) || Date.now(),
              m: e.m,
            };
            if (typeof e.why === "string" && e.why.trim()) entry.why = e.why.trim();
            entries.push(entry);
            saveEntries(entries);
            return json(res, 201, entry);
          } catch (err) { return json(res, 400, { error: "invalid JSON body" }); }
        });
        return;
      }

      if (req.method === "DELETE") {
        entries = [];
        saveEntries(entries);
        return json(res, 200, { ok: true });
      }
    }

    /* ---- single entry ---- */
    if (p.startsWith("/api/moods/")) {
      const id = p.slice("/api/moods/".length);

      if (req.method === "DELETE") {
        const before = entries.length;
        entries = entries.filter((e) => e.id !== id);
        if (entries.length === before) return json(res, 404, { error: "not found" });
        saveEntries(entries);
        return json(res, 200, { ok: true });
      }

      if (req.method === "PATCH") {
        const entry = entries.find((e) => e.id === id);
        if (!entry) return json(res, 404, { error: "not found" });
        let body = "";
        req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
        req.on("end", () => {
          try {
            const patch = JSON.parse(body || "{}");
            if (patch.m !== undefined) {
              if (!Number.isInteger(patch.m) || patch.m < 1 || patch.m > 5) return json(res, 400, { error: "bad m" });
              entry.m = patch.m;
            }
            if (patch.why !== undefined) {
              entry.why = (typeof patch.why === "string" && patch.why.trim()) ? patch.why.trim() : undefined;
              if (entry.why === undefined) delete entry.why;
            }
            saveEntries(entries);
            return json(res, 200, entry);
          } catch (e) { return json(res, 400, { error: "invalid JSON body" }); }
        });
        return;
      }
    }

    /* ---- static files ---- */
    const rel = p === "/" ? "index.html" : p.slice(1);
    const full = path.normalize(path.join(dir, rel));
    if (full !== dir && !full.startsWith(dir + path.sep)) return json(res, 403, { error: "forbidden" });
    fs.readFile(full, (err, data) => {
      if (err) return json(res, 404, { error: "not found" });
      const type = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, Object.assign({ "Content-Type": type }, CORS));
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE") resolve({ alreadyRunning: true, port });
      else throw e;
    });
    server.listen(port, () => resolve({ alreadyRunning: false, port, server }));
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer().then((r) => {
    if (r.alreadyRunning) {
      console.log(`[mood] port ${r.port} is already in use — a server is already running.`);
      process.exit(0);
    }
    console.log(`[mood] server running at http://localhost:${r.port}`);
    console.log(`[mood] log file: ${path.join(DIR, "data", "moods.json")}`);
  });
}
