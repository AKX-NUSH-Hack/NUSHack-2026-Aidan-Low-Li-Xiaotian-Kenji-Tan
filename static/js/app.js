/* =====================================================================
   app.js (v1.3)
   ===================================================================== */
(function () {
  "use strict";

  const CODE_PREFIX = "CL1.";
  const KINDS = { b: "Yes / No", i: "Whole number", f: "Decimal", s: "Text" };
  const THEMES = ["system", "light", "dark", "novus"];

  function bytesToB64url(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlToBytes(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function pipeThrough(bytes, stream) {
    const writer = stream.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    return new Uint8Array(await new Response(stream.readable).arrayBuffer());
  }
  function normalise(obj) {
    if (!obj || typeof obj !== "object") throw new Error("Checklist must be an object");
    const title = String(obj.t || obj.title || "").trim();
    if (!title) throw new Error("Give the checklist a title");
    if (title.length > 80) throw new Error("Title is too long (max 80 characters)");
    const rawItems = obj.i || obj.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("Add at least one item");
    if (rawItems.length > 200) throw new Error("Too many items (max 200)");
    const items = rawItems.map((it, idx) => {
      const n = String((it && (it.n || it.name)) || "").trim();
      const k = String((it && (it.k || it.kind)) || "b").trim().toLowerCase();
      if (!n) throw new Error("Item " + (idx + 1) + " has no name");
      if (n.length > 120) throw new Error("Item " + (idx + 1) + " name is too long");
      if (!KINDS[k]) throw new Error("Item " + (idx + 1) + " has an unknown type");
      return { n, k };
    });
    return { v: 1, t: title, i: items };
  }
  async function encode(checklist) {
    const clean = normalise(checklist);
    if (typeof CompressionStream === "function") {
      const packed = await pipeThrough(new TextEncoder().encode(JSON.stringify(clean)), new CompressionStream("deflate"));
      return CODE_PREFIX + bytesToB64url(packed);
    }
    const data = await api.post("/api/encode", { checklist: clean }, { auth: false });
    return data.code;
  }
  async function decode(code) {
    code = String(code || "").trim();
    if (!code.startsWith(CODE_PREFIX)) throw new Error("That is not a checklist code (it should start with " + CODE_PREFIX + ")");
    if (typeof DecompressionStream === "function") {
      try {
        const raw = await pipeThrough(b64urlToBytes(code.slice(CODE_PREFIX.length)), new DecompressionStream("deflate"));
        return normalise(JSON.parse(new TextDecoder().decode(raw)));
      } catch (err) {
        if (/^(Give|Add|Item|Title|Too many|Checklist)/.test(err.message || "")) throw err;
        throw new Error("This code is damaged or incomplete. Copy it again.");
      }
    }
    const data = await api.post("/api/decode", { code }, { auth: false });
    return data.checklist;
  }
  const codec = { PREFIX: CODE_PREFIX, KINDS, encode, decode, normalise };

  function getJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
    catch (_) { return fallback; }
  }
  function setJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (err) { console.warn("storage write failed", err); ui.toast("Device storage is full – free some space"); return false; }
  }

  const theme = {
    LIST: THEMES,
    get: () => localStorage.getItem("nh.theme") || "system",
    apply(name) {
      if (!THEMES.includes(name)) name = "system";
      document.documentElement.setAttribute("data-theme", name);
      localStorage.setItem("nh.theme", name);             // device default (used on the login page)
      if (auth.user()) store.set("theme", name);          // and this account's preference
    },
  };

  // nh.session  = { token, user:{id, username, display_name, role} }
  // nh.accounts = { username: { user, offline:{iterations,salt,hash}, lastLogin } }
  const auth = {
    session: () => getJSON("nh.session", null),
    user: () => (getJSON("nh.session", null) || {}).user || null,
    token: () => (getJSON("nh.session", null) || {}).token || "",
    isManager: () => (auth.user() || {}).role === "manager",
    accounts: () => getJSON("nh.accounts", {}),

    _start(session) {
      setJSON("nh.session", session);
      const accounts = auth.accounts();
      const existing = accounts[session.user.username] || {};
      accounts[session.user.username] = { ...existing, user: session.user, lastLogin: new Date().toISOString() };
      setJSON("nh.accounts", accounts);
      const pref = store.get("theme", null);
      if (pref) theme.apply(pref);
    },

    async login(username, password) {
      username = String(username || "").trim().toLowerCase();
      if (!username || !password) throw new Error("Enter your username and password");

      if (navigator.onLine) {
        try {
          const data = await api.post("/api/auth/login", { username, password }, { auth: false });
          const accounts = auth.accounts();
          accounts[username] = { user: data.user, offline: data.offline, token: data.token, lastLogin: new Date().toISOString() };
          setJSON("nh.accounts", accounts);
          auth._start({ token: data.token, user: data.user });
          return { mode: "online" };
        } catch (err) {
          if (!err.offline) throw err;
        }
      }
      const cached = auth.accounts()[username];
      if (!cached || !cached.offline) {
        throw new Error(navigator.onLine ? "Cannot reach the server. Check the Wi-Fi and try again."
                                         : "No connection. This account has to log in online once before it can be used offline.");
      }
      const ok = await auth._verifyOffline(password, cached.offline);
      if (!ok) throw new Error("Wrong username or password");
      auth._start({ token: cached.token || "", user: cached.user, offline: true });
      return { mode: "offline" };
    },

    async _verifyOffline(password, offline) {
      const salt = b64urlToBytes(offline.salt);
      const derived = await NHCrypto.pbkdf2(new TextEncoder().encode(password), salt, offline.iterations, 32);
      return bytesToB64url(derived) === offline.hash;
    },

    rememberToken() {
      const s = auth.session();
      if (!s || !s.token) return;
      const accounts = auth.accounts();
      if (accounts[s.user.username]) { accounts[s.user.username].token = s.token; setJSON("nh.accounts", accounts); }
    },

    logout() {
      localStorage.removeItem("nh.session");
      location.href = "/login";
    },

    forgetAccount(username) {
      const accounts = auth.accounts();
      const user = (accounts[username] || {}).user;
      delete accounts[username];
      setJSON("nh.accounts", accounts);
      if (user) {
        const prefix = "nh.u." + user.id + ".";
        Object.keys(localStorage).filter((k) => k.startsWith(prefix)).forEach((k) => localStorage.removeItem(k));
      }
    },

    requireLogin() {
      if (!auth.user()) { location.replace("/login?next=" + encodeURIComponent(location.pathname + location.search)); return false; }
      return true;
    },
  };

  // keys: lists {code:{title,items,savedAt}} · pending [] · history [] · draft.<code> · theme · guard · listsDirty {added:{},removed:{}}
  const store = {
    key(name) {
      const u = auth.user();
      return "nh.u." + (u ? u.id : "nobody") + "." + name;
    },
    get: (name, fallback) => getJSON(store.key(name), fallback),
    set: (name, value) => setJSON(store.key(name), value),
    remove: (name) => localStorage.removeItem(store.key(name)),

    getLists: () => store.get("lists", {}),
    saveList(code, checklist) {
      const lists = store.getLists();
      lists[code] = { title: checklist.t, items: checklist.i.length, savedAt: new Date().toISOString() };
      store.set("lists", lists);
      const dirty = store.get("listsDirty", { added: {}, removed: {} });
      dirty.added[code] = { code, title: checklist.t, saved_at: lists[code].savedAt };
      delete dirty.removed[code];
      store.set("listsDirty", dirty);
      sync.pushLists();
    },
    removeList(code) {
      const lists = store.getLists();
      delete lists[code];
      store.set("lists", lists);
      store.remove("draft." + code);
      if (store.get("current", "") === code) store.remove("current");
      const dirty = store.get("listsDirty", { added: {}, removed: {} });
      delete dirty.added[code];
      dirty.removed[code] = true;
      store.set("listsDirty", dirty);
      sync.pushLists();
    },

    getPending: () => store.get("pending", []),
    setPending: (arr) => store.set("pending", arr),
    getHistory: () => store.get("history", []),
    setHistory: (arr) => store.set("history", arr.slice(0, 100)),
    getDraft: (code) => store.get("draft." + code, null),
    setDraft: (code, draft) => store.set("draft." + code, draft),
    clearDraft: (code) => store.remove("draft." + code),

    usageKB() {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); bytes += k.length + (localStorage.getItem(k) || "").length; }
      return Math.round(bytes * 2 / 1024);
    },
  };

  function apiError(message, extra) { const e = new Error(message); Object.assign(e, extra || {}); return e; }

  const api = {
    async request(method, path, body, opts) {
      opts = opts || {};
      const headers = { "Content-Type": "application/json" };
      if (opts.auth !== false) {
        const token = auth.token();
        if (!token) throw apiError("Please log in again", { status: 401, needLogin: true });
        headers.Authorization = "Bearer " + token;
      }
      let res;
      try {
        res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (_) {
        throw apiError("No connection to the server", { offline: true });
      }
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok || data.ok === false) {
        const message = data.error || ("Server error " + res.status);
        if (res.status === 401 && opts.auth !== false) ui.sessionExpired();
        throw apiError(message, { status: res.status, needLogin: res.status === 401 });
      }
      return data;
    },
    get: (path, opts) => api.request("GET", path, undefined, opts),
    post: (path, body, opts) => api.request("POST", path, body, opts),
    put: (path, body, opts) => api.request("PUT", path, body, opts),
    patch: (path, body, opts) => api.request("PATCH", path, body, opts),
    del: (path, opts) => api.request("DELETE", path, undefined, opts),
  };

  let pushing = false;
  const listeners = [];
  function notify() { listeners.forEach((fn) => { try { fn(); } catch (_) {} }); }

  function uuid() {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function submit(submission) {
    submission.id = submission.id || uuid();
    submission.submitted_at = submission.submitted_at || new Date().toISOString();
    submission.prev_hash = submission.prev_hash || "";
    submission.hash = submission.hash || "";
    const pending = store.getPending();
    pending.push(submission);
    store.setPending(pending);
    const history = store.getHistory();
    history.unshift({ id: submission.id, title: submission.checklist_title, at: submission.submitted_at, status: "pending" });
    store.setHistory(history);
    notify();
    push();
    return submission.id;
  }

  async function push() {
    if (pushing || !auth.user()) return;
    const pending = store.getPending();
    if (!pending.length || !navigator.onLine) { notify(); return; }
    if (!auth.token()) { notify(); return; }   // offline login without a cached token: wait for an online login
    pushing = true;
    try {
      const data = await api.post("/api/sync", { submissions: pending });
      const synced = new Set(data.synced || []);
      const failed = {};
      (data.failed || []).forEach((f) => { failed[f.id] = f.error; });
      store.setPending(pending.filter((s) => !synced.has(s.id)));
      store.setHistory(store.getHistory().map((h) => {
        if (synced.has(h.id)) return { ...h, status: "synced", mode: data.mode };
        if (failed[h.id]) return { ...h, status: "error", error: failed[h.id] };
        return h;
      }));
      if (synced.size) ui.toast("Synced " + synced.size + " submission" + (synced.size === 1 ? "" : "s"));
    } catch (err) {
      console.info("sync postponed:", err.message);
    } finally {
      pushing = false;
      notify();
    }
  }

  let pushingLists = false;
  async function pushLists() {
    if (pushingLists || !navigator.onLine || !auth.token()) return;
    const dirty = store.get("listsDirty", { added: {}, removed: {} });
    pushingLists = true;
    try {
      const data = await api.post("/api/me/checklists", { added: Object.values(dirty.added), removed: Object.keys(dirty.removed) });
      store.set("listsDirty", { added: {}, removed: {} });
      const lists = store.getLists();
      const serverCodes = new Set();
      for (const item of data.checklists || []) {
        serverCodes.add(item.code);
        if (!lists[item.code]) {
          let count = 0;
          try { count = (await codec.decode(item.code)).i.length; } catch (_) { continue; }
          lists[item.code] = { title: item.title, items: count, savedAt: item.saved_at || new Date().toISOString() };
        }
      }
      for (const code of Object.keys(lists)) if (!serverCodes.has(code)) delete lists[code];
      store.set("lists", lists);
      notify();
    } catch (err) {
      console.info("list sync postponed:", err.message);
    } finally {
      pushingLists = false;
    }
  }

  const sync = {
    submit, push, pushLists, uuid,
    pendingCount: () => (auth.user() ? store.getPending().length : 0),
    onChange: (fn) => listeners.push(fn),
  };

  let toastTimer = null;
  const ui = {
    $: (id) => document.getElementById(id),

    toast(msg, ms) {
      const el = document.getElementById("toast");
      if (!el) return;
      el.textContent = msg;
      el.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove("show"), ms || 2400);
    },

    confirm(title, text, okLabel, danger) {
      return new Promise((resolve) => {
        const modal = document.getElementById("confirm-modal");
        if (!modal) { resolve(window.confirm(title + "\n\n" + (text || ""))); return; }
        modal.querySelector("h3").textContent = title;
        modal.querySelector("p").textContent = text || "";
        const okBtn = modal.querySelector("[data-ok]");
        okBtn.textContent = okLabel || "OK";
        okBtn.className = "btn grow " + (danger ? "btn-danger" : "btn-primary");
        modal.hidden = false;
        const done = (value) => { modal.hidden = true; okBtn.onclick = null; modal.querySelector("[data-cancel]").onclick = null; resolve(value); };
        okBtn.onclick = () => done(true);
        modal.querySelector("[data-cancel]").onclick = () => done(false);
        modal.onclick = (e) => { if (e.target === modal) done(false); };
        okBtn.focus();
      });
    },

    async copy(text) {
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
        else {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
        }
        ui.toast("Copied");
      } catch (_) { ui.toast("Copy failed – select the text and copy it manually"); }
    },

    async busy(btn, fn) {
      if (!btn || btn.classList.contains("busy")) return;
      btn.classList.add("busy"); btn.disabled = true;
      try { return await fn(); }
      finally { btn.classList.remove("busy"); btn.disabled = false; }
    },

    escape: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),

    fmtTime(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return iso || "";
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " +
             d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    },

    qrUrl: (code) => "/qr.svg?code=" + encodeURIComponent(code),

    async svgToPng(svgUrl, size) {
      const svgText = await (await fetch(svgUrl)).text();
      const blob = new Blob([svgText], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; img.src = url; });
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size || 1024;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png");
      } finally { URL.revokeObjectURL(url); }
    },

    updateStatus() {
      const pill = document.getElementById("status-pill");
      const text = document.getElementById("status-text");
      if (!pill || !text) return;
      const n = sync.pendingCount();
      pill.classList.remove("online", "offline", "pending");
      if (!navigator.onLine) { pill.classList.add("offline"); text.textContent = n ? "Offline · " + n + " waiting" : "Offline"; }
      else if (n) { pill.classList.add("pending"); text.textContent = n + " waiting to sync"; }
      else { pill.classList.add("online"); text.textContent = "Online"; }
    },

    sessionExpired() {
      const s = auth.session();
      if (!s || !s.token) return;
      s.token = "";
      setJSON("nh.session", s);
      ui.toast("Your login expired – log in again to keep syncing", 4000);
      ui.renderRelogin();
    },

    renderRelogin() {
      const el = document.getElementById("relogin-banner");
      if (!el) return;
      const user = auth.user();
      if (!user || auth.token() || !navigator.onLine) { el.hidden = true; return; }

      const waiting = sync.pendingCount();
      const title = document.getElementById("relogin-title");
      const text = document.getElementById("relogin-text");
      const btn = document.getElementById("relogin-btn");
      if (title) title.textContent = "Please log in again";
      if (text) {
        text.textContent = waiting
          ? "Your login expired. " + waiting + " finished checklist" + (waiting === 1 ? "" : "s") +
            " on this device are waiting to upload."
          : "Your login expired. Everything on this device is safe.";
      }
      if (btn) btn.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
      el.hidden = false;
    },

    renderHeader() {
      const u = auth.user();
      const who = document.getElementById("who");
      if (who && u) who.textContent = u.display_name + (u.role === "manager" ? " · Manager" : "");
      const manageTab = document.getElementById("tab-manage");
      if (manageTab) manageTab.hidden = !(u && u.role === "manager");
    },
  };

  function storageNotice() {
    const el = document.getElementById("storage-notice");
    if (!el) return;
    if (localStorage.getItem("nh.noticeSeen") === "1") return;
    el.hidden = false;
    const more = document.getElementById("notice-more");
    more.addEventListener("click", () => {
      const detail = document.getElementById("notice-detail");
      detail.hidden = !detail.hidden;
      more.textContent = detail.hidden ? "What is stored?" : "Hide";
    });
    document.getElementById("notice-ok").addEventListener("click", () => {
      try { localStorage.setItem("nh.noticeSeen", "1"); } catch (_) {}
      el.hidden = true;
    });
  }

  window.App = { codec, theme, auth, store, api, sync, ui };

  sync.onChange(ui.updateStatus);
  sync.onChange(ui.renderRelogin);
  window.addEventListener("online", () => {
    ui.toast("Back online – syncing…");
    push(); pushLists();
    ui.renderRelogin();
  });
  window.addEventListener("offline", () => { ui.updateStatus(); ui.renderRelogin(); });

  document.addEventListener("DOMContentLoaded", () => {
    const isLogin = document.body.dataset.page === "login";
    if (!isLogin && !auth.requireLogin()) return;
    const u = auth.user();
    if (u) { const pref = store.get("theme", null); if (pref) document.documentElement.setAttribute("data-theme", pref); }
    ui.renderHeader();
    ui.updateStatus();
    ui.renderRelogin();
    storageNotice();
    push(); pushLists();
    setInterval(push, 30000);
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
})();
