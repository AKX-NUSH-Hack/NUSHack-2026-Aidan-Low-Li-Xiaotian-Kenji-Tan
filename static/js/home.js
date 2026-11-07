/* =====================================================================
   home.js
   ===================================================================== */
(function () {
  "use strict";
  const { codec, store, sync, ui, auth } = window.App;
  const $ = ui.$;

  async function renderContinue() {
    const code = store.get("current", "");
    if (!code) return;
    const draft = store.getDraft(code);
    if (!draft || !draft.values) return;

    let checklist;
    try { checklist = await codec.decode(code); } catch (_) { return; }

    const total = checklist.i.length;
    const answered = checklist.i.reduce((count, item, idx) => {
      const v = draft.values[idx];
      return count + (v !== null && v !== undefined && v !== "" ? 1 : 0);
    }, 0);
    if (answered === 0 || answered === total) return;

    $("continue-title").textContent = "Carry on: " + checklist.t;
    $("continue-sub").textContent = answered + " of " + total + " items answered";
    $("continue-btn").href = "/checklist?code=" + encodeURIComponent(code);
    $("continue-btn").hidden = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!auth.user()) return;
    $("btn-manage").hidden = !auth.isManager();
    renderContinue();
    sync.onChange(ui.updateStatus);
  });
})();
