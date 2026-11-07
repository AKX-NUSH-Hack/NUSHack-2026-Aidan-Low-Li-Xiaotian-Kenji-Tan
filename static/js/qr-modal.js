/* qr-modal.js */
(function () {
  "use strict";
  const { ui } = window.App;
  const $ = ui.$;
  let currentCode = "";

  window.QrModal = {
    open(title, code) {
      currentCode = code;
      $("qr-title").textContent = title;
      const img = $("qr-img");
      img.alt = "QR code for " + title;
      img.src = ui.qrUrl(code);
      img.onerror = () => ui.toast("QR needs the server. Copy the code instead.", 3500);
      const svgBtn = $("qr-svg-btn");
      if (svgBtn) svgBtn.href = ui.qrUrl(code);
      $("qr-modal").hidden = false;
    },
    close() { $("qr-modal").hidden = true; },
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("qr-modal")) return;
    $("qr-close-btn").addEventListener("click", QrModal.close);
    $("qr-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) QrModal.close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") QrModal.close(); });
    $("qr-copy-btn").addEventListener("click", () => currentCode && ui.copy(currentCode));
    const png = $("qr-png-btn");
    if (png) png.addEventListener("click", () => ui.busy(png, async () => {
      try {
        const dataUrl = await ui.svgToPng(ui.qrUrl(currentCode), 1024);
        const a = document.createElement("a");
        a.href = dataUrl; a.download = "checklist-qr.png"; document.body.appendChild(a); a.click(); a.remove();
      } catch (_) { ui.toast("Could not make the PNG. Use SVG instead."); }
    }));
  });
})();
