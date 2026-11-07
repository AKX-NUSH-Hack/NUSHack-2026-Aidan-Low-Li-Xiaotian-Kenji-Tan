/* =====================================================================
   create.js
   ===================================================================== */
(function () {
  "use strict";
  const { codec, store, ui, api, auth, wiz } = window.App;
  const $ = ui.$;

  const KIND_OPTIONS = Object.keys(codec.KINDS)
    .map((k) => '<option value="' + k + '">' + codec.KINDS[k] + "</option>").join("");

  let lastCode = "";

  function addRow(name, kind, focus) {
    const li = document.createElement("li");
    li.innerHTML =
      '<input type="text" class="input name-input" placeholder="e.g. Main door locked" maxlength="120" aria-label="Item name">' +
      '<select class="input kind-select" aria-label="Kind of answer">' + KIND_OPTIONS + "</select>" +
      '<button type="button" class="btn btn-ghost btn-icon btn-danger" title="Remove this item" aria-label="Remove this item">✕</button>';
    li.querySelector(".name-input").value = name || "";
    li.querySelector(".kind-select").value = kind || "b";

    li.querySelector("button").addEventListener("click", async () => {
      const typed = li.querySelector(".name-input").value.trim();
      if (typed && !(await ui.confirm("Remove this item?", '"' + typed + '"', "Remove", true))) return;
      li.remove();
      if (!$("builder").children.length) addRow();
    });
    li.querySelector(".name-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addRow("", "b", true); }
    });

    $("builder").appendChild(li);
    if (focus) li.querySelector(".name-input").focus();
    return li;
  }

  function readItems() {
    const items = [];
    $("builder").querySelectorAll("li").forEach((li) => {
      const n = li.querySelector(".name-input").value.trim();
      if (n) items.push({ n, k: li.querySelector(".kind-select").value });
    });
    return items;
  }

  async function makeCode() {
    const hint = $("items-hint");
    hint.className = "hint";
    const items = readItems();
    try {
      lastCode = await codec.encode({ t: $("title-input").value.trim(), i: items });
    } catch (err) {
      hint.className = "hint error";
      hint.textContent = err.message;
      return;
    }

    $("code-heading").textContent = $("title-input").value.trim();
    $("code-lead").textContent = items.length + (items.length === 1 ? " item" : " items") +
      " · share the QR below, or the code underneath it.";
    $("result-code").value = lastCode;
    $("save-label").textContent = store.getLists()[lastCode] ? "Already saved" : "Save it for later";
    $("publish-btn").hidden = !auth.isManager();
    $("publish-label").textContent = "Give it to everyone";

    const qr = $("result-qr");
    qr.hidden = false;
    $("qr-hint").hidden = true;
    qr.src = ui.qrUrl(lastCode);
    $("qr-svg-btn").hidden = false;
    $("qr-svg-btn").href = qr.src;
    $("qr-png-btn").hidden = false;
    qr.onerror = () => {
      qr.hidden = true;
      $("qr-svg-btn").hidden = true;
      $("qr-png-btn").hidden = true;
      $("qr-hint").hidden = false;
      $("qr-hint").textContent = "The QR picture needs the server. The code below still works.";
    };

    wiz.go("code");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!auth.user()) return;

    addRow(); addRow(); addRow();

    $("name-next").addEventListener("click", () => {
      const hint = $("name-hint");
      if (!$("title-input").value.trim()) {
        hint.className = "hint error";
        hint.textContent = "Give it a name first.";
        $("title-input").focus();
        return;
      }
      hint.className = "hint";
      hint.textContent = "";
      wiz.go("items");
    });
    $("title-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("name-next").click(); });

    $("add-item-btn").addEventListener("click", () => addRow("", "b", true));
    $("items-next").addEventListener("click", () => ui.busy($("items-next"), makeCode));

    $("copy-btn").addEventListener("click", () => lastCode && ui.copy(lastCode));
    $("qr-png-btn").addEventListener("click", () => ui.busy($("qr-png-btn"), async () => {
      try {
        const a = document.createElement("a");
        a.href = await ui.svgToPng(ui.qrUrl(lastCode), 1024);
        a.download = "checklist-qr.png";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (_) { ui.toast("Could not make the PNG. Use SVG instead."); }
    }));

    $("do-now").addEventListener("click", () => {
      location.href = "/checklist?code=" + encodeURIComponent(lastCode);
    });

    $("save-btn").addEventListener("click", () => ui.busy($("save-btn"), async () => {
      if (!lastCode) return;
      store.saveList(lastCode, await codec.decode(lastCode));
      $("save-label").textContent = "Saved ✓";
      ui.toast("Saved under My checklists");
    }));

    $("publish-btn").addEventListener("click", () => ui.busy($("publish-btn"), async () => {
      if (!lastCode) return;
      if (!navigator.onLine) { ui.toast("Publishing needs internet."); return; }
      const ok = await ui.confirm("Give this to everyone?",
        "Every user will see it under company checklists.", "Publish");
      if (!ok) return;
      try {
        await api.post("/api/manage/checklists", { code: lastCode });
        $("publish-label").textContent = "Published ✓";
        ui.toast("Published to everyone");
      } catch (err) { ui.toast(err.message, 4000); }
    }));

    $("make-another").addEventListener("click", () => {
      $("title-input").value = "";
      $("builder").innerHTML = "";
      addRow(); addRow(); addRow();
      lastCode = "";
      wiz.restart("name");
    });

    const edit = new URLSearchParams(location.search).get("edit");
    if (edit) {
      codec.decode(edit).then((checklist) => {
        $("title-input").value = checklist.t;
        $("builder").innerHTML = "";
        checklist.i.forEach((it) => addRow(it.n, it.k));
        wiz.restart("name");
      }).catch((err) => { ui.toast(err.message, 3500); wiz.restart("name"); });
    } else {
      wiz.restart("name");
    }
  });
})();
