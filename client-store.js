/*
 * Mood Tracker — shared client store.
 *
 * Loaded by index.html and widget.html via <script src="client-store.js">.
 * Talks to the local shared-log server (http://localhost:8686) when it's up;
 * otherwise falls back to localStorage (key "mood-tracker.local") and pushes
 * any backlog to the server the next time it comes online.
 *
 * Exposes window.MoodStore with an async API:
 *   init()                 -> true if the server is reachable
 *   list()                 -> array of entries
 *   add(entry)             -> adds {id,t,m,why?}, returns the entry
 *   update(id, patch)      -> merges {why?, m?} into an existing entry
 *   remove(id)             -> deletes by id
 *   clear()                -> deletes everything
 */
(function () {
  "use strict";

  const SERVER = "http://localhost:8686";
  const LOCAL_KEY = "mood-tracker.local";

  const localGet = () => {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]"); }
    catch (e) { return []; }
  };
  const localSet = (a) => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); }
    catch (e) {}
  };

  const api = {
    online: false,

    async init() {
      try {
        const r = await fetch(SERVER + "/api/moods", { headers: { "Accept": "application/json" } });
        if (r.ok) {
          this.online = true;
          await this._pushBacklog();
          return true;
        }
      } catch (e) {}
      this.online = false;
      return false;
    },

    async list() {
      if (this.online) {
        try {
          const r = await fetch(SERVER + "/api/moods");
          if (r.ok) return await r.json();
        } catch (e) {}
      }
      return localGet();
    },

    async add(entry) {
      if (this.online) {
        try {
          const r = await fetch(SERVER + "/api/moods", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
          });
          if (r.ok) return await r.json();
        } catch (e) {}
      }
      const arr = localGet();
      arr.push(entry);
      localSet(arr);
      return entry;
    },

    async update(id, patch) {
      if (this.online) {
        try {
          const r = await fetch(SERVER + "/api/moods/" + encodeURIComponent(id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          if (r.ok) return await r.json();
        } catch (e) {}
      }
      const arr = localGet();
      const entry = arr.find((e) => e.id === id);
      if (entry) { Object.assign(entry, patch); localSet(arr); }
      return entry || null;
    },

    async remove(id) {
      if (this.online) {
        try {
          await fetch(SERVER + "/api/moods/" + encodeURIComponent(id), { method: "DELETE" });
          return;
        } catch (e) {}
      }
      localSet(localGet().filter((e) => e.id !== id));
    },

    async clear() {
      if (this.online) {
        try { await fetch(SERVER + "/api/moods", { method: "DELETE" }); return; }
        catch (e) {}
      }
      localSet([]);
    },

    async _pushBacklog() {
      const local = localGet();
      if (local.length === 0) return;
      for (const e of local) {
        try {
          await fetch(SERVER + "/api/moods", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(e),
          });
        } catch (err) {}
      }
      localSet([]);
    },
  };

  window.MoodStore = api;
})();
