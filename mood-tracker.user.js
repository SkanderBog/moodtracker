// ==UserScript==
// @name         Mood Tracker
// @namespace    https://github.com/SkanderBog
// @version      1.1.0
// @description  Floating mood bar (😢→😄) with optional "why" notes and a full timeline, sharing one log via the local server.
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

/*
 * Mood Tracker — floating bar version.
 *
 * A small pill sits in the top-right of every page. Click a mood to log it
 * (with the time + optional "why") to ONE shared log served by the local
 * server (server.js / the always-on-top widget). If that server isn't running,
 * it falls back to Tampermonkey's own storage and syncs back later.
 *
 * Install: Tampermonkey (or Violentmonkey) -> "Create a new script" -> paste
 * this whole file -> Ctrl/Cmd-S.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Config                                                              */
  /* ------------------------------------------------------------------ */
  const SERVER = "http://localhost:8686";
  const LOCAL_KEY = "mood-tracker.local";
  const GAP_MS = 2 * 60 * 60 * 1000;

  const MOODS = [
    { level: 1, emoji: "😢", label: "Very sad"  },
    { level: 2, emoji: "🙁", label: "Sad"       },
    { level: 3, emoji: "😐", label: "Neutral"   },
    { level: 4, emoji: "🙂", label: "Happy"     },
    { level: 5, emoji: "😄", label: "Very happy" },
  ];
  const mood = (m) => MOODS[m - 1];
  const genId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2));

  /* ------------------------------------------------------------------ */
  /* Storage: shared server first, GM/local fallback                     */
  /* ------------------------------------------------------------------ */
  const hasGM = typeof GM_setValue === "function" && typeof GM_getValue === "function";
  const localGet = () => {
    try { return JSON.parse((hasGM ? GM_getValue(LOCAL_KEY, null) : localStorage.getItem(LOCAL_KEY)) || "[]"); }
    catch (e) { return []; }
  };
  const localSet = (a) => {
    const s = JSON.stringify(a);
    try { if (hasGM) GM_setValue(LOCAL_KEY, s); else localStorage.setItem(LOCAL_KEY, s); }
    catch (e) {}
  };

  const store = {
    online: false,
    async init() {
      try {
        const r = await fetch(SERVER + "/api/moods", { headers: { "Accept": "application/json" } });
        if (r.ok) { this.online = true; await this._pushBacklog(); return true; }
      } catch (e) {}
      this.online = false;
      return false;
    },
    async list() {
      if (this.online) { try { const r = await fetch(SERVER + "/api/moods"); if (r.ok) return await r.json(); } catch (e) {} }
      return localGet();
    },
    async add(entry) {
      if (this.online) {
        try {
          const r = await fetch(SERVER + "/api/moods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
          if (r.ok) return await r.json();
        } catch (e) {}
      }
      const a = localGet(); a.push(entry); localSet(a); return entry;
    },
    async update(id, patch) {
      if (this.online) {
        try {
          const r = await fetch(SERVER + "/api/moods/" + encodeURIComponent(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
          if (r.ok) return await r.json();
        } catch (e) {}
      }
      const a = localGet(); const en = a.find((e) => e.id === id);
      if (en) { Object.assign(en, patch); localSet(a); }
      return en || null;
    },
    async remove(id) {
      if (this.online) { try { await fetch(SERVER + "/api/moods/" + encodeURIComponent(id), { method: "DELETE" }); return; } catch (e) {} }
      localSet(localGet().filter((e) => e.id !== id));
    },
    async clear() {
      if (this.online) { try { await fetch(SERVER + "/api/moods", { method: "DELETE" }); return; } catch (e) {} }
      localSet([]);
    },
    async _pushBacklog() {
      const local = localGet();
      if (local.length === 0) return;
      for (const e of local) {
        try { await fetch(SERVER + "/api/moods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) }); } catch (err) {}
      }
      localSet([]);
    },
  };

  let state = { entries: [], collapsed: false };

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function todayKey() { return dayKey(Date.now()); }
  function yesterdayKey() { return dayKey(Date.now() - 86400000); }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function fmtTimeFull(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
  function fmtDate(key) {
    if (key === todayKey()) return "Today";
    if (key === yesterdayKey()) return "Yesterday";
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function distinctDays() { return [...new Set(state.entries.map(e => dayKey(e.t)))].sort().reverse(); }

  /* ------------------------------------------------------------------ */
  /* Styles                                                              */
  /* ------------------------------------------------------------------ */
  function injectStyle() {
    const css = `
      :root {
        --mt-surface: #fcfcfb; --mt-page: #f9f9f7;
        --mt-ink: #0b0b0b; --mt-ink2: #52514e; --mt-muted: #898781;
        --mt-grid: #e1e0d9; --mt-axis: #c3c2b7; --mt-ring: rgba(11,11,11,0.12);
        --mt-mood1: #1c5cab; --mt-mood2: #86b6ef; --mt-mood3: #898781;
        --mt-mood4: #f0a35a; --mt-mood5: #eb6834;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --mt-surface: #1a1a19; --mt-page: #0d0d0d;
          --mt-ink: #ffffff; --mt-ink2: #c3c2b7; --mt-muted: #898781;
          --mt-grid: #2c2c2a; --mt-axis: #383835; --mt-ring: rgba(255,255,255,0.14);
          --mt-mood1: #5598e7; --mt-mood2: #9ec5f4; --mt-mood3: #b8b7b1;
          --mt-mood4: #f0a35a; --mt-mood5: #eb6834;
        }
      }

      #mt-bar {
        position: fixed; top: 12px; right: 12px; z-index: 2147483000;
        display: flex; align-items: center; gap: 2px; padding: 5px;
        border-radius: 999px; background: color-mix(in srgb, var(--mt-surface) 92%, transparent);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        box-shadow: 0 2px 14px rgba(0,0,0,0.22); border: 1px solid var(--mt-ring);
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      #mt-bar button {
        width: 32px; height: 32px; border: none; border-radius: 50%;
        background: transparent; cursor: pointer; font-size: 17px; line-height: 1;
        padding: 0; color: inherit; transition: background .12s ease, transform .08s ease;
      }
      #mt-bar button:hover { background: color-mix(in srgb, var(--mt-ink) 10%, transparent); }
      #mt-bar button:active { transform: scale(.9); }
      #mt-bar button.mt-active { background: color-mix(in srgb, var(--mt-ink) 14%, transparent); }
      #mt-bar .mt-sep { width: 1px; height: 18px; background: var(--mt-ring); margin: 0 3px; }
      #mt-status { width: 9px; height: 9px; border-radius: 50%; background: #c3c2b7; margin: 0 5px 0 3px; flex: none; }
      #mt-status.mt-online { background: #0ca30c; }
      #mt-bar.mt-collapsed button.mt-hide, #mt-bar.mt-collapsed .mt-sep, #mt-bar.mt-collapsed #mt-status { display: none; }

      #mt-why { position: fixed; top: 54px; right: 12px; z-index: 2147483100; }
      #mt-why input {
        font: inherit; font-size: 13px; color: var(--mt-ink);
        background: var(--mt-surface); border: 1px solid var(--mt-ring);
        border-radius: 10px; padding: 7px 11px; width: 190px; outline: none;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
      }

      #mt-toast {
        position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
        z-index: 2147483200; background: var(--mt-ink); color: var(--mt-surface);
        padding: 7px 14px; border-radius: 999px; font-size: 13px; font-family: inherit;
        opacity: 0; pointer-events: none; transition: opacity .18s ease; white-space: nowrap;
      }
      #mt-toast.mt-show { opacity: 1; }

      #mt-ovl {
        position: fixed; inset: 0; z-index: 2147484000; background: var(--mt-page);
        color: var(--mt-ink); overflow-y: auto; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      #mt-ovl .mt-inner { max-width: 880px; margin: 0 auto; padding: 22px 22px 60px; }
      #mt-ovl .mt-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
      #mt-ovl h1 { font-size: 20px; margin: 0; }
      #mt-ovl .mt-sub { color: var(--mt-muted); font-size: 13px; }
      #mt-ovl select { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--mt-ring); background: var(--mt-surface); color: var(--mt-ink); }
      #mt-ovl .mt-close { position: absolute; top: 16px; right: 20px; font-size: 24px; line-height: 1; background: none; border: none; cursor: pointer; color: var(--mt-muted); }
      #mt-ovl .mt-close:hover { color: var(--mt-ink); }
      #mt-ovl .mt-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
      #mt-ovl .mt-stat { background: var(--mt-surface); border: 1px solid var(--mt-ring); border-radius: 12px; padding: 12px 14px; }
      #mt-ovl .mt-stat .k { font-size: 11px; color: var(--mt-muted); text-transform: uppercase; letter-spacing: .04em; }
      #mt-ovl .mt-stat .v { font-size: 20px; font-weight: 650; margin-top: 4px; }
      #mt-ovl .mt-stat .v small { font-weight: 400; color: var(--mt-muted); font-size: 13px; }
      #mt-ovl .mt-takeaway { font-size: 14px; color: var(--mt-ink2); margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: color-mix(in srgb, var(--mt-ink) 4%, var(--mt-surface)); }
      #mt-ovl .mt-chart { position: relative; }
      #mt-ovl svg { width: 100%; height: auto; display: block; }
      #mt-ovl .mt-tip { position: absolute; display: none; pointer-events: none; background: var(--mt-ink); color: var(--mt-surface); padding: 5px 10px; border-radius: 8px; font-size: 12.5px; white-space: nowrap; z-index: 10; }
      #mt-ovl h2 { font-size: 15px; margin: 22px 0 10px; }
      #mt-ovl table { width: 100%; border-collapse: collapse; font-size: 14px; }
      #mt-ovl th, #mt-ovl td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--mt-grid); vertical-align: top; }
      #mt-ovl th { color: var(--mt-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
      #mt-ovl td.mt-time { font-variant-numeric: tabular-nums; color: var(--mt-ink2); white-space: nowrap; }
      #mt-ovl .mt-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 7px; }
      #mt-ovl .mt-why { color: var(--mt-muted); font-size: 12.5px; font-style: italic; margin-top: 2px; }
      #mt-ovl td.mt-del { width: 40px; text-align: right; }
      #mt-ovl td.mt-del button { border: none; background: none; color: var(--mt-muted); cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 6px; }
      #mt-ovl td.mt-del button:hover { color: var(--mt-ink); background: color-mix(in srgb, var(--mt-ink) 8%, transparent); }
      #mt-ovl .mt-empty { text-align: center; color: var(--mt-muted); padding: 60px 20px; }
      #mt-ovl .mt-empty .big { font-size: 40px; display: block; margin-bottom: 12px; }
      #mt-ovl .mt-tools { display: flex; gap: 8px; margin-top: 18px; }
      #mt-ovl .mt-tool { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--mt-ring); background: var(--mt-surface); color: var(--mt-ink2); font: inherit; font-size: 13px; cursor: pointer; }
      #mt-ovl .mt-tool:hover { color: var(--mt-ink); }
      #mt-ovl .mt-tool:disabled { opacity: .4; cursor: default; }
    `;
    const style = document.createElement("style");
    style.id = "mt-style";
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* Floating bar                                                        */
  /* ------------------------------------------------------------------ */
  function buildBar() {
    const bar = document.createElement("div");
    bar.id = "mt-bar";
    bar.innerHTML =
      `<span id="mt-status" class="mt-hide" title="shared log"></span>` +
      `<button class="mt-hide" data-m="1" title="Very sad">😢</button>` +
      `<button class="mt-hide" data-m="2" title="Sad">🙁</button>` +
      `<button class="mt-hide" data-m="3" title="Neutral">😐</button>` +
      `<button class="mt-hide" data-m="4" title="Happy">🙂</button>` +
      `<button class="mt-hide" data-m="5" title="Very happy">😄</button>` +
      `<span class="mt-sep mt-hide"></span>` +
      `<button id="mt-hist" class="mt-hide" title="History">📊</button>` +
      `<button id="mt-collapse" title="Collapse">${state.collapsed ? "🌤" : "—"}</button>`;
    document.body.appendChild(bar);

    bar.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => logMood(Number(b.dataset.m))));
    bar.querySelector("#mt-hist").addEventListener("click", openHistory);
    bar.querySelector("#mt-collapse").addEventListener("click", toggleCollapse);
    renderBar();
  }
  function toggleCollapse() { state.collapsed = !state.collapsed; renderBar(); }
  function renderBar() {
    const bar = document.getElementById("mt-bar");
    if (!bar) return;
    bar.classList.toggle("mt-collapsed", state.collapsed);
    bar.querySelector("#mt-collapse").textContent = state.collapsed ? "🌤" : "—";
    const latest = state.entries[state.entries.length - 1];
    bar.querySelectorAll("[data-m]").forEach(b => b.classList.toggle("mt-active", latest != null && Number(b.dataset.m) === latest.m));
  }

  /* ------------------------------------------------------------------ */
  /* Logging + optional "why"                                            */
  /* ------------------------------------------------------------------ */
  function logMood(level) {
    const entry = { id: genId(), t: Date.now(), m: level };
    state.entries.push(entry);
    store.add(entry);
    renderBar();
    toast(`${mood(level).emoji} ${mood(level).label} · ${fmtTimeFull(entry.t)}`);
    askWhy(entry);
  }

  function askWhy(entry) {
    closeWhy();
    const box = document.createElement("div");
    box.id = "mt-why";
    box.innerHTML = `<input placeholder="Why? (optional) — Enter to save">`;
    document.body.appendChild(box);
    const input = box.querySelector("input");
    let done = false;
    const finish = (saveIt) => {
      if (done) return; done = true;
      if (saveIt && input.value.trim()) { entry.why = input.value.trim(); store.update(entry.id, { why: entry.why }); toast("Saved note ✍️"); }
      closeWhy();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(input.value.trim() !== ""));
    setTimeout(() => finish(input.value.trim() !== ""), 20000);
    input.focus();
  }
  function closeWhy() { const b = document.getElementById("mt-why"); if (b) b.remove(); }

  let toastTimer = null;
  function toast(text) {
    let t = document.getElementById("mt-toast");
    if (!t) { t = document.createElement("div"); t.id = "mt-toast"; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add("mt-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("mt-show"), 1800);
  }

  /* ------------------------------------------------------------------ */
  /* History overlay                                                     */
  /* ------------------------------------------------------------------ */
  function visibleEntries() {
    const sel = document.getElementById("mt-daySelect");
    if (!sel || sel.value === "all") return state.entries;
    return state.entries.filter(e => dayKey(e.t) === sel.value);
  }

  function openHistory() {
    let ovl = document.getElementById("mt-ovl");
    if (!ovl) {
      ovl = document.createElement("div");
      ovl.id = "mt-ovl";
      ovl.innerHTML = `
        <button class="mt-close" title="Close">✕</button>
        <div class="mt-inner">
          <div class="mt-head">
            <div><h1 id="mt-title">Today</h1><div class="mt-sub" id="mt-sub">—</div></div>
            <select id="mt-daySelect"></select>
          </div>
          <div class="mt-stats" id="mt-stats"></div>
          <p class="mt-takeaway" id="mt-takeaway" hidden></p>
          <div class="mt-chart" id="mt-chartWrap">
            <svg id="mt-chart" viewBox="0 0 880 380" role="img" aria-label="Mood over time"></svg>
            <div class="mt-tip" id="mt-tip"></div>
          </div>
          <h2>Log</h2>
          <div id="mt-list"></div>
          <div class="mt-tools">
            <button class="mt-tool" id="mt-export">Export CSV</button>
            <button class="mt-tool" id="mt-clear">Clear all</button>
          </div>
        </div>`;
      document.body.appendChild(ovl);
      ovl.querySelector(".mt-close").addEventListener("click", closeHistory);
      ovl.querySelector("#mt-daySelect").addEventListener("change", renderHistory);
      ovl.querySelector("#mt-export").addEventListener("click", exportCsv);
      ovl.querySelector("#mt-clear").addEventListener("click", clearAll);
    }
    ovl.style.display = "block";
    document.body.style.overflow = "hidden";
    renderHistory();
  }
  function closeHistory() { const ovl = document.getElementById("mt-ovl"); if (ovl) ovl.style.display = "none"; document.body.style.overflow = ""; }

  function renderHistory() { renderHeader(); renderStats(); renderChart(); renderList(); }

  function renderHeader() {
    const sel = document.getElementById("mt-daySelect");
    const days = distinctDays();
    const prev = sel.value || days[0] || "all";
    sel.innerHTML = days.map(d => `<option value="${d}">${fmtDate(d)}</option>`).join("") + `<option value="all">All time</option>`;
    sel.value = days.includes(prev) || prev === "all" ? prev : (days[0] || "all");
    document.getElementById("mt-title").textContent = sel.value === "all" ? "All time" : fmtDate(sel.value);
  }

  function renderStats() {
    const entries = visibleEntries().sort((a, b) => a.t - b.t);
    const box = document.getElementById("mt-stats");
    const sub = document.getElementById("mt-sub");
    const takeaway = document.getElementById("mt-takeaway");
    if (entries.length === 0) { box.innerHTML = ""; sub.textContent = "No moods logged yet."; takeaway.hidden = true; return; }

    const first = entries[0], last = entries[entries.length - 1];
    const duration = last.t - first.t;
    const avg = entries.reduce((s, e) => s + e.m, 0) / entries.length;
    const avgMood = mood(Math.round(avg));
    sub.textContent = `${entries.length} log${entries.length === 1 ? "" : "s"} · ${fmtTime(first.t)} – ${fmtTime(last.t)}`;
    box.innerHTML = [
      stat("Entries", `${entries.length}`),
      stat("Duration", `${fmtDuration(duration)}`),
      stat("Average", `${avgMood.emoji} ${avgMood.label}`, `(${avg.toFixed(1)} / 5)`),
      stat("Latest", `${mood(last.m).emoji} ${mood(last.m).label}`),
    ].join("");

    const allSame = entries.every(e => e.m === entries[0].m);
    const diff = last.m - first.m;
    let msg;
    if (entries.length === 1)  msg = "Just one log so far — keep clicking as you go.";
    else if (allSame)          msg = `A steady ${mood(entries[0].m).label.toLowerCase()} stretch.`;
    else if (diff > 0)         msg = "You ended up happier than you started.";
    else if (diff < 0)         msg = "You ended a bit lower than you started — take a breather.";
    else                       msg = "Started and ended on the same note, with some movement in between.";
    takeaway.textContent = msg;
    takeaway.hidden = false;
  }
  function stat(k, v, small) {
    return `<div class="mt-stat"><div class="k">${k}</div><div class="v">${v}${small ? ` <small>${small}</small>` : ""}</div></div>`;
  }

  function renderChart() {
    const svg = document.getElementById("mt-chart");
    svg.innerHTML = "";
    hideTip();
    const entries = visibleEntries().sort((a, b) => a.t - b.t);
    if (entries.length === 0) return;

    const W = 880, H = 380, left = 120, right = 24, top = 24, bottom = 44;
    const plotW = W - left - right, plotH = H - top - bottom;
    const tMin = entries[0].t, tMax = entries[entries.length - 1].t;
    let lo = tMin - Math.max(5 * 60 * 1000, (tMax - tMin) * 0.15);
    let hi = tMax + Math.max(5 * 60 * 1000, (tMax - tMin) * 0.15);
    if (hi - lo < 10 * 60 * 1000) { const mid = (lo + hi) / 2; lo = mid - 5 * 60 * 1000; hi = mid + 5 * 60 * 1000; }

    const x = (t) => left + (t - lo) / (hi - lo) * plotW;
    const y = (lvl) => top + (5 - lvl) * (plotH / 4);
    const NS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

    for (const m of MOODS) {
      const yy = y(m.level);
      svg.appendChild(el("line", { x1: left, y1: yy, x2: W - right, y2: yy, stroke: "var(--mt-grid)", "stroke-width": 1 }));
      const label = el("text", { x: left - 10, y: yy + 4, "text-anchor": "end", fill: "var(--mt-ink2)", "font-size": 13 });
      label.textContent = `${m.emoji} ${m.label}`;
      svg.appendChild(label);
    }
    for (let i = 0; i < 4; i++) {
      const t = lo + (hi - lo) * (i / 3), xx = x(t);
      svg.appendChild(el("line", { x1: xx, y1: top, x2: xx, y2: H - bottom, stroke: "var(--mt-grid)", "stroke-width": 1 }));
      const tick = el("text", { x: xx, y: H - bottom + 22, "text-anchor": "middle", fill: "var(--mt-muted)", "font-size": 12 });
      tick.textContent = fmtTime(t);
      svg.appendChild(tick);
    }
    svg.appendChild(el("line", { x1: left, y1: H - bottom, x2: W - right, y2: H - bottom, stroke: "var(--mt-axis)", "stroke-width": 1 }));

    for (let i = 0; i < entries.length - 1; i++) {
      if (entries[i + 1].t - entries[i].t > GAP_MS) continue;
      svg.appendChild(el("line", { x1: x(entries[i].t), y1: y(entries[i].m), x2: x(entries[i + 1].t), y2: y(entries[i + 1].m), stroke: "var(--mt-axis)", "stroke-width": 2, "stroke-linecap": "round" }));
    }
    for (const e of entries) {
      const dot = el("circle", { cx: x(e.t), cy: y(e.m), r: 6, fill: `var(--mt-mood${e.m})`, stroke: "var(--mt-surface)", "stroke-width": 2 });
      dot.style.cursor = "pointer";
      dot.addEventListener("mouseenter", () => showTip(dot, e));
      dot.addEventListener("mouseleave", hideTip);
      svg.appendChild(dot);
    }
  }

  function showTip(node, entry) {
    const tip = document.getElementById("mt-tip");
    tip.textContent = `${fmtTimeFull(entry.t)} · ${mood(entry.m).emoji} ${mood(entry.m).label}${entry.why ? " — " + entry.why : ""}`;
    tip.style.display = "block";
    const wrap = document.getElementById("mt-chartWrap").getBoundingClientRect();
    const r = node.getBoundingClientRect();
    tip.style.left = (r.left - wrap.left + r.width / 2) + "px";
    tip.style.top = (r.top - wrap.top - 10) + "px";
    tip.style.transform = "translate(-50%, -100%)";
  }
  function hideTip() { const t = document.getElementById("mt-tip"); if (t) t.style.display = "none"; }

  function renderList() {
    const box = document.getElementById("mt-list");
    const entries = visibleEntries().sort((a, b) => b.t - a.t);
    if (entries.length === 0) { box.innerHTML = `<div class="mt-empty"><span class="big">😐</span>Click a mood in the bar to start tracking.</div>`; return; }
    const rows = entries.map(e => `
      <tr>
        <td class="mt-time">${fmtTimeFull(e.t)}</td>
        <td><span class="mt-dot" style="background:var(--mt-mood${e.m})"></span>${mood(e.m).emoji} ${mood(e.m).label}${e.why ? `<div class="mt-why">${escapeHtml(e.why)}</div>` : ""}</td>
        <td class="mt-del"><button data-del="${e.id}" title="Delete" aria-label="Delete">×</button></td>
      </tr>`).join("");
    box.innerHTML = `<table><thead><tr><th>Time</th><th>Mood</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteEntry(b.dataset.del)));
  }

  function deleteEntry(id) {
    state.entries = state.entries.filter(e => e.id !== id);
    store.remove(id);
    renderBar();
    renderHistory();
  }
  function clearAll() {
    if (state.entries.length === 0) return;
    if (!confirm("Delete ALL mood history? This cannot be undone.")) return;
    state.entries = [];
    store.clear();
    renderBar();
    renderHistory();
  }
  function exportCsv() {
    if (state.entries.length === 0) return;
    const sorted = [...state.entries].sort((a, b) => a.t - b.t);
    const rows = [["timestamp", "iso", "mood_level", "mood_label", "why"]];
    for (const e of sorted) rows.push([e.t, new Date(e.t).toISOString(), e.m, mood(e.m).label, e.why || ""]);
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mood-${todayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  injectStyle();
  buildBar();
  (async () => {
    const online = await store.init();
    const status = document.getElementById("mt-status");
    status.classList.toggle("mt-online", online);
    status.title = online ? "Shared log online" : "Server not running — saving locally only";
    state.entries = await store.list();
    renderBar();
  })();
})();
