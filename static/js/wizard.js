/* =====================================================================
   wizard.js
   ===================================================================== */
(function () {
  "use strict";

  const stack = [];
  let homeHref = "/";

  function panels() {
    return Array.from(document.querySelectorAll("[data-step]"));
  }

  function find(id) {
    return panels().find((p) => p.dataset.step === id) || null;
  }

  function paint(panel) {
    const title = document.getElementById("wiz-title");
    const count = document.getElementById("wiz-count");
    const bar = document.getElementById("wiz-bar");
    const back = document.getElementById("wiz-back");

    if (title) title.textContent = panel.dataset.title || "";

    const progress = panel.dataset.progress || "";       // e.g. "2/4"
    const [stepNo, total] = progress.split("/").map(Number);
    const haveProgress = Number.isFinite(stepNo) && Number.isFinite(total) && total > 0;

    if (count) {
      count.textContent = haveProgress ? "Step " + stepNo + " of " + total : "";
      count.hidden = !haveProgress;
    }
    if (bar) {
      bar.style.width = haveProgress ? Math.round((stepNo / total) * 100) + "%" : "0%";
      bar.parentElement.hidden = !haveProgress;
    }
    if (back) {
      back.textContent = stack.length ? "Back" : "Home";
      back.setAttribute("aria-label", stack.length ? "Back to the previous step" : "Back to the home screen");
    }
  }

  const wiz = {
    current: null,

    go(id, opts) {
      opts = opts || {};
      const target = find(id);
      if (!target) { console.warn("wizard: no step named", id); return; }

      if (wiz.current && wiz.current !== id && !opts.replace) stack.push(wiz.current);
      panels().forEach((p) => { p.hidden = p !== target; });
      wiz.current = id;
      paint(target);

      window.scrollTo({ top: 0, behavior: opts.instant ? "auto" : "smooth" });
      target.dispatchEvent(new CustomEvent("stepshow"));

      const focus = target.querySelector("[data-autofocus]");
      if (focus && !opts.noFocus) setTimeout(() => { try { focus.focus(); } catch (_) {} }, 60);
    },

    back() {
      if (stack.length) wiz.go(stack.pop(), { replace: true, noFocus: true });
      else location.href = homeHref;
    },

    restart(id) {
      stack.length = 0;
      wiz.current = null;
      wiz.go(id, { replace: true, instant: true });
    },

    swap(id) { wiz.go(id, { replace: true }); },

    depth: () => stack.length,
  };

  window.App.wiz = wiz;

  document.addEventListener("DOMContentLoaded", () => {
    const back = document.getElementById("wiz-back");
    if (back) back.addEventListener("click", (e) => { e.preventDefault(); wiz.back(); });

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-go]");
      if (!trigger || trigger.disabled) return;
      e.preventDefault();
      wiz.go(trigger.dataset.go);
    });
  });
})();
