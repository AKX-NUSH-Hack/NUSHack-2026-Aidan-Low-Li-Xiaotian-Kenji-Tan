/* login.js */
(function () {
  "use strict";
  const { auth, ui } = window.App;
  const $ = ui.$;

  function renderAccounts() {
    const accounts = auth.accounts();
    const names = Object.keys(accounts).sort((a, b) => (accounts[b].lastLogin || "").localeCompare(accounts[a].lastLogin || ""));
    $("accounts-block").hidden = names.length === 0;
    $("accounts").innerHTML = names.map((n) => {
      const u = accounts[n].user || {};
      const initial = (u.display_name || n).trim().charAt(0).toUpperCase();
      return '<button type="button" class="account-chip" data-u="' + ui.escape(n) + '">' +
             '<span class="avatar">' + ui.escape(initial) + "</span>" + ui.escape(u.display_name || n) +
             (accounts[n].offline ? "" : ' <span class="muted small">(online only)</span>') + "</button>";
    }).join("");
    $("accounts").querySelectorAll(".account-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        $("accounts").querySelectorAll(".account-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        $("username").value = chip.dataset.u;
        $("password").focus();
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const signedIn = auth.user();
    if (signedIn && auth.token()) { location.replace(nextUrl()); return; }

    if (signedIn) {
      $("username").value = signedIn.username;
      const hint = $("login-hint");
      hint.className = "hint";
      hint.textContent = "Your login needs renewing, " + signedIn.display_name.split(" ")[0] +
        ". Enter your password to carry on. Nothing on this device has been lost.";
    }

    renderAccounts();
    if (signedIn) setTimeout(() => $("password").focus(), 60);

    $("show-pw").addEventListener("click", () => {
      const pw = $("password");
      const showing = pw.type === "password";
      pw.type = showing ? "text" : "password";
      $("show-pw").textContent = showing ? "Hide" : "Show";
      $("show-pw").setAttribute("aria-pressed", showing ? "true" : "false");
    });

    $("login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const hint = $("login-hint");
      hint.className = "hint";
      hint.textContent = navigator.onLine ? "Checking…" : "Checking offline…";
      ui.busy($("login-btn"), async () => {
        try {
          const result = await auth.login($("username").value, $("password").value);
          hint.className = "hint ok";
          hint.textContent = result.mode === "offline" ? "Logged in offline" : "Logged in";
          location.replace(nextUrl());
        } catch (err) {
          hint.className = "hint error";
          hint.textContent = err.message;
          $("password").value = "";
          $("password").focus();
        }
      });
    });
  });

  function nextUrl() {
    const next = new URLSearchParams(location.search).get("next") || "/";
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }
})();
