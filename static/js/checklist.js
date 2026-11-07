/* =====================================================================
   checklist.js
   ===================================================================== */
(function () {
  "use strict";
  const { codec, store, sync, ui, api, auth, wiz } = window.App;
  const $ = ui.$;

  let current = null;    // { code, checklist }
  function companyLists() { return (store.get("company", { checklists: [] }).checklists) || []; }

  function renderChoices() {
    const company = companyLists().length;
    const saved = Object.keys(store.getLists()).length;
    $("pick-company-sub").textContent = company
      ? company + (company === 1 ? " checklist, set by a manager" : " checklists, set by a manager")
      : "None published yet";
    $("pick-saved-sub").textContent = saved
      ? saved + (saved === 1 ? " checklist you kept" : " checklists you kept")
      : "Nothing saved yet";
  }

  async function refreshCompany() {
    if (!navigator.onLine || !auth.token()) return;
    try {
      const data = await api.get("/api/company");
      store.set("company", { name: data.name, checklists: data.checklists || [], at: Date.now() });
      renderChoices();
      if (wiz.current === "list" && listKind === "company") renderList();
    } catch (_) { /* offline: the cached copy stays */ }
  }

  let listKind = "company";

  function listItems(kind) {
    return kind === "company"
      ? companyLists().map((c) => ({ code: c.code, title: c.title, id: c.id,
                                     sub: "Set by " + (c.created_by || "a manager") }))
      : Object.entries(store.getLists()).map(([code, l]) => ({ code, title: l.title,
                                     sub: l.items + " items · kept " + ui.fmtTime(l.savedAt) }));
  }

  function renderList() {
    const kind = listKind;
    const items = listItems(kind);
    const manager = auth.isManager();

    $("list-title").textContent = kind === "company" ? "Company checklists" : "Saved on this account";
    $("list-lead").textContent = kind === "company"
      ? (manager ? "Everyone can see these. You can change them because you are a manager."
                 : "Set by your manager. Everyone sees the same ones.")
      : "Only you can see these. They follow you to other devices once you are online.";

    const rows = $("list-rows");
    if (!items.length) {
      rows.innerHTML = '<li class="muted">' + (kind === "company"
        ? "No company checklists yet." : "You have not kept any checklists yet.") + "</li>";
      $("list-hint").innerHTML = kind === "company"
        ? (manager ? 'Make one on the <a href="/create">Create</a> screen, then choose “Give it to everyone”.'
                   : "Ask a manager to publish one, or paste a code instead.")
        : 'Checklists you submit are kept here automatically. You can also <a href="/create">create one</a>.';
      return;
    }
    $("list-hint").textContent = "";

    rows.innerHTML = items.map((it, i) => {
      let extra = '<button type="button" class="btn btn-ghost btn-sm" data-act="qr">Share</button>';
      if (kind === "saved") {
        extra += '<a class="btn btn-ghost btn-sm" href="/create?edit=' + encodeURIComponent(it.code) + '">Edit</a>' +
                 '<button type="button" class="btn btn-danger btn-sm" data-act="remove">Remove</button>';
      } else if (manager) {
        extra += '<a class="btn btn-ghost btn-sm" href="/create?edit=' + encodeURIComponent(it.code) + '">Edit</a>' +
                 '<button type="button" class="btn btn-danger btn-sm" data-act="unpublish">Unpublish</button>';
      }
      return '<li data-i="' + i + '"><div><div><strong>' + ui.escape(it.title) + "</strong></div>" +
        '<div class="muted small">' + ui.escape(it.sub) + "</div></div>" +
        '<div class="row row-wrap"><button type="button" class="btn btn-primary btn-sm" data-act="do">Do it</button>' +
        extra + "</div></li>";
    }).join("");

    rows.querySelectorAll("li[data-i]").forEach((li) => {
      const it = items[Number(li.dataset.i)];
      const on = (act, fn) => { const b = li.querySelector('[data-act="' + act + '"]'); if (b) b.addEventListener("click", fn); };

      on("do", () => open(it.code));
      on("qr", () => QrModal.open(it.title, it.code));
      on("remove", async () => {
        const ok = await ui.confirm("Remove this checklist?",
          '"' + it.title + '" goes from your account. Any code you still have keeps working.', "Remove", true);
        if (!ok) return;
        store.removeList(it.code);
        renderChoices();
        renderList();
        ui.toast("Removed");
      });
      on("unpublish", async () => {
        if (!navigator.onLine) { ui.toast("Unpublishing needs internet."); return; }
        const ok = await ui.confirm("Unpublish for everyone?",
          '"' + it.title + '" disappears from company checklists on every device.', "Unpublish", true);
        if (!ok) return;
        try {
          await api.del("/api/manage/checklists/" + it.id);
          await refreshCompany();
          renderList();
          ui.toast("Unpublished");
        } catch (err) { ui.toast(err.message, 4000); }
      });
    });
  }

  function showList(kind) {
    listKind = kind;
    renderList();
    wiz.go("list");
  }

  let stream = null;
  let scanTimer = null;

  async function makeReader() {
    if (typeof window.BarcodeDetector === "function") {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes("qr_code")) {
          const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
          return async (video) => (await detector.detect(video)).map((r) => r.rawValue || "");
        }
      } catch (_) { /* fall through to jsQR */ }
    }

    if (typeof window.jsQR === "function") {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      return async (video) => {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return [];
        const scale = Math.min(1, 640 / Math.max(vw, vh)); // smaller frame = faster
        canvas.width = Math.round(vw * scale);
        canvas.height = Math.round(vh * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
        return hit ? [hit.data] : [];
      };
    }
    return null;
  }

  function cameraProblem() {
    if (!window.isSecureContext) {
      return "Your browser only allows the camera on a secure (https) address. This page is on " +
             location.protocol + "//" + location.host + ", so scanning is blocked here. " +
             "Open the app on this computer at localhost, or paste the code instead.";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "This browser does not give pages access to the camera.";
    }
    return null;
  }

  const NO_READER =
    "This browser cannot read QR codes on its own - Chrome only manages it on Android, " +
    "ChromeOS and macOS, not on Windows. One small file switches it on: see " +
    "static/js/vendor/PUT-jsQR.js-HERE.txt, it takes about thirty seconds. " +
    "Until then, scan with your phone's camera app and paste the code.";

  function stopCamera(message) {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
    const video = $("scan-video");
    if (video) video.srcObject = null;
    $("scan-live").hidden = true;
    $("scan-intro").hidden = false;
    const hint = $("scan-intro-hint");
    hint.className = message ? "hint error" : "hint";
    hint.textContent = message || "";
  }

  async function startCamera() {
    const problem = cameraProblem();
    if (problem) {
      const hint = $("scan-intro-hint");
      hint.className = "hint error";
      hint.textContent = problem;
      return;
    }

    const read = await makeReader();
    if (!read) {
      const hint = $("scan-intro-hint");
      hint.className = "hint error";
      hint.textContent = NO_READER;
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false,
      });
    } catch (err) {
      const denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      stopCamera(denied
        ? "You said no to the camera. Allow it in your browser's address bar and try again, or paste the code instead."
        : "No camera was available. Paste the code instead.");
      return;
    }

    const video = $("scan-video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    try { await video.play(); } catch (_) {}

    $("scan-intro").hidden = true;
    $("scan-live").hidden = false;
    $("scan-hint").className = "hint";
    $("scan-hint").textContent = "Looking for a code…";

    let misses = 0;
    const look = async () => {
      if (!stream) return;
      try {
        const found = await read(video);
        const code = found.find((value) => (value || "").trim().startsWith(codec.PREFIX));
        if (code) {
          const other = found.length > 1 ? " " : "";
          stopCamera();
          $("scan-intro-hint").className = "hint ok";
          $("scan-intro-hint").textContent = "Found it." + other;
          const ok = await open(code.trim(), { silent: true });
          if (ok) { wiz.go("answer"); return; }
          $("scan-intro-hint").className = "hint error";
          $("scan-intro-hint").textContent = "That QR code is damaged or is not a checklist.";
          return;
        }
        if (found.length) {
          misses += 1;
          $("scan-hint").className = "hint error";
          $("scan-hint").textContent = "That is a QR code, but not a checklist one. A checklist code starts with " + codec.PREFIX;
        } else if (misses === 0) {
          $("scan-hint").className = "hint";
          $("scan-hint").textContent = "Looking for a code…";
        }
      } catch (_) { /* a frame failed to decode; just try the next one */ }
      scanTimer = setTimeout(look, 220);
    };
    look();
  }

  async function open(code, opts) {
    opts = opts || {};
    code = (code || "").trim();
    if (!code) return false;
    try {
      const checklist = await codec.decode(code);
      current = { code, checklist };
      store.set("current", code);
      $("answer-title").textContent = checklist.t;
      const draft = store.getDraft(code);
      renderItems(checklist, draft);
      $("notes-input").value = (draft && draft.notes) || "";
      $("answer-hint").textContent = "";
      $("answer-hint").className = "hint";
      if (!opts.silent) wiz.go("answer");
      return true;
    } catch (err) {
      if (opts.into) {
        const hint = $(opts.into);
        hint.className = "hint error";
        hint.textContent = err.message;
      } else {
        ui.toast(err.message, 3500);
      }
      return false;
    }
  }

  function renderItems(checklist, draft) {
    const list = $("items");
    list.innerHTML = "";
    const values = (draft && draft.values) || {};

    checklist.i.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "item" + (item.k === "s" ? " wide" : "");
      li.dataset.idx = idx;

      const label = document.createElement("div");
      label.innerHTML = '<div class="item-name">' + ui.escape(item.n) + '</div><div class="item-kind">' + codec.KINDS[item.k] + "</div>";
      li.appendChild(label);

      let control;
      if (item.k === "b") {
        control = document.createElement("div");
        control.className = "seg";
        control.setAttribute("role", "group");
        control.innerHTML = '<button type="button" data-v="true">Yes</button><button type="button" data-v="false">No</button>';
        control.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
          control.querySelectorAll("button").forEach((b) => b.classList.remove("on-yes", "on-no"));
          btn.classList.add(btn.dataset.v === "true" ? "on-yes" : "on-no");
          li.classList.remove("missing");
          saveDraft();
        }));
        if (values[idx] === true) control.children[0].classList.add("on-yes");
        if (values[idx] === false) control.children[1].classList.add("on-no");
      } else {
        control = document.createElement("input");
        control.className = "input";
        if (item.k === "i") { control.type = "number"; control.step = "1"; control.inputMode = "numeric"; control.placeholder = "0"; }
        if (item.k === "f") { control.type = "number"; control.step = "any"; control.inputMode = "decimal"; control.placeholder = "0.0"; }
        if (item.k === "s") { control.type = "text"; control.placeholder = "Type here…"; control.maxLength = 200; }
        control.setAttribute("aria-label", item.n);
        if (values[idx] !== undefined && values[idx] !== null) control.value = values[idx];
        control.addEventListener("input", () => { li.classList.remove("missing"); saveDraft(); });
      }
      li.appendChild(control);
      list.appendChild(li);
    });
  }

  function readValues() {
    const values = {}, missing = [];
    document.querySelectorAll("#items .item").forEach((li) => {
      const idx = Number(li.dataset.idx);
      const kind = current.checklist.i[idx].k;
      let v = null;
      if (kind === "b") {
        const on = li.querySelector(".seg .on-yes, .seg .on-no");
        v = on ? on.dataset.v === "true" : null;
      } else {
        const raw = li.querySelector("input").value.trim();
        if (raw !== "") {
          if (kind === "i") v = Number.isInteger(Number(raw)) ? parseInt(raw, 10) : NaN;
          else if (kind === "f") v = parseFloat(raw);
          else v = raw;
          if ((kind === "i" || kind === "f") && !Number.isFinite(v)) v = null;
        }
      }
      values[idx] = v;
      if (v === null && kind !== "s") missing.push(idx);
    });
    return { values, missing };
  }

  function saveDraft() {
    if (!current) return;
    store.setDraft(current.code, { values: readValues().values, notes: $("notes-input").value });
  }

  function renderReview() {
    const { values } = readValues();
    const notes = $("notes-input").value.trim();
    $("review-list").innerHTML = current.checklist.i.map((item, idx) => {
      const v = values[idx];
      let shown;
      if (item.k === "b") shown = v === true ? '<span class="r-val r-yes">Yes</span>' : '<span class="r-val r-no">No</span>';
      else if (v === null || v === "") shown = '<span class="r-val muted">—</span>';
      else shown = '<span class="r-val">' + ui.escape(v) + "</span>";
      return '<li><span class="r-name">' + ui.escape(item.n) + "</span>" + shown + "</li>";
    }).join("");

    const noWarnings = current.checklist.i.filter((item, idx) => item.k === "b" && values[idx] === false).length;
    $("review-lead").textContent = noWarnings
      ? noWarnings + (noWarnings === 1 ? " item is" : " items are") + " marked No. Your manager will see this."
      : "Make sure this is right, then submit.";
    $("review-notes").textContent = notes ? "Your note: " + notes : "";
  }

  function doSubmit() {
    if (!current) return;
    const { values } = readValues();
    sync.submit({
      checklist_title: current.checklist.t,
      checklist_code: current.code,
      results: current.checklist.i.map((item, idx) => ({ n: item.n, k: item.k, v: values[idx] })),
      notes: $("notes-input").value.trim(),
    });
    store.clearDraft(current.code);

    if (!store.getLists()[current.code]) store.saveList(current.code, current.checklist);

    const offline = !navigator.onLine || !auth.token();
    $("done-mark").classList.toggle("waiting", offline);
    $("done-title").textContent = offline ? "Saved on this device" : "Submitted";
    $("done-sub").textContent = offline
      ? "No internet right now, so it is waiting here. It uploads by itself the moment you are back online."
      : "Sent to " + (store.get("company", {}).name || "your company") + ".";
    $("done-when").textContent = current.checklist.t + " · " + ui.fmtTime(new Date().toISOString());
    $("again-same-sub").textContent = current.checklist.t;

    wiz.restart("done");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!auth.user()) return;

    renderChoices();
    refreshCompany();

    $("pick-code").addEventListener("click", () => wiz.go("code"));
    $("pick-scan").addEventListener("click", () => { stopCamera(); wiz.go("scan"); });
    $("scan-start").addEventListener("click", () => ui.busy($("scan-start"), startCamera));
    $("scan-stop").addEventListener("click", () => stopCamera());
    $("scan-paste-instead").addEventListener("click", () => wiz.swap("code"));

    // The camera must never outlive the screen it belongs to.
    document.querySelectorAll("[data-step]").forEach((panel) => {
      if (panel.dataset.step !== "scan") panel.addEventListener("stepshow", () => stopCamera());
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) stopCamera(); });
    window.addEventListener("pagehide", () => stopCamera());
    $("pick-company").addEventListener("click", () => showList("company"));
    $("pick-saved").addEventListener("click", () => showList("saved"));

    $("code-next").addEventListener("click", () => ui.busy($("code-next"), async () => {
      await open($("code-input").value, { into: "code-hint" });
    }));
    $("code-input").addEventListener("input", () => { $("code-hint").className = "hint"; $("code-hint").textContent = ""; });

    $("answer-next").addEventListener("click", () => {
      const { missing } = readValues();
      if (missing.length) {
        document.querySelectorAll("#items .item").forEach((li) =>
          li.classList.toggle("missing", missing.includes(Number(li.dataset.idx))));
        const hint = $("answer-hint");
        hint.className = "hint error";
        hint.textContent = missing.length + (missing.length === 1 ? " item" : " items") + " still need an answer (marked in red).";
        const first = document.querySelector("#items .item.missing");
        if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      wiz.go("notes");
    });

    $("notes-next").addEventListener("click", () => { saveDraft(); wiz.go("review"); });
    document.querySelector('[data-step="review"]').addEventListener("stepshow", renderReview);
    $("submit-btn").addEventListener("click", () => ui.busy($("submit-btn"), doSubmit));

    $("again-same").addEventListener("click", () => {
      renderItems(current.checklist, null);
      $("notes-input").value = "";
      wiz.restart("answer");
    });
    $("again-other").addEventListener("click", () => { renderChoices(); wiz.restart("choose"); });

    sync.onChange(ui.updateStatus);

    const fromUrl = new URLSearchParams(location.search).get("code");
    if (fromUrl) {
      open(fromUrl, { silent: true }).then((ok) => wiz.restart(ok ? "answer" : "choose"));
    } else {
      wiz.restart("choose");
    }
  });
})();
