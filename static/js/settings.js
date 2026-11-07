/* settings.js */
(function () {
  "use strict";
  const { theme, store, ui, api, auth, sync } = window.App;
  const $ = ui.$;

  function renderTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "system";
    document.querySelectorAll(".theme-card").forEach((c) => c.classList.toggle("active", c.dataset.theme === current));
  }

  function renderDevice() {
    $("dev-pending").textContent = sync.pendingCount();
    $("dev-lists").textContent = Object.keys(store.getLists()).length;
    $("dev-accounts").textContent = Object.keys(auth.accounts()).length;
    $("dev-storage").textContent = store.usageKB() + " KB";
    $("dev-crypto").textContent = NHCrypto.usingWebCrypto ? "Fast (Web Crypto)" : "Slower (plain http)";
  }

  function showLogo(svg) {
    $("logo-preview").innerHTML = svg || '<span class="muted small">No logo</span>';
  }

  async function loadLogo() {
    try {
      const svg = (await api.get("/api/manage/logo")).logo_svg;
      $("logo-text").value = svg || "";
      showLogo(svg);
    } catch (err) {
      const hint = $("logo-hint");
      hint.className = "hint";
      hint.textContent = navigator.onLine
        ? "Could not load the logo: " + err.message
        : "You are offline, so the logo cannot be loaded or changed right now.";
    }
  }

  function wireLogo() {
    $("logo-file").addEventListener("change", async () => {
      const file = $("logo-file").files[0];
      if (!file) return;
      if (file.size > 50 * 1024) { ui.toast("That file is bigger than 50 KB"); $("logo-file").value = ""; return; }
      $("logo-text").value = await file.text();
      showLogo($("logo-text").value);
    });

    $("logo-text").addEventListener("input", () => showLogo($("logo-text").value));

    $("logo-save").addEventListener("click", () => ui.busy($("logo-save"), async () => {
      const hint = $("logo-hint");
      if (!navigator.onLine) { hint.className = "hint error"; hint.textContent = "You are offline. Connect to change the logo."; return; }
      try {
        const data = await api.put("/api/manage/logo", { svg: $("logo-text").value });
        $("logo-text").value = data.logo_svg;
        showLogo(data.logo_svg);
        hint.className = "hint ok";
        hint.textContent = "Saved. Every QR code now has it in the middle.";
      } catch (err) { hint.className = "hint error"; hint.textContent = err.message; }
    }));

    $("logo-clear").addEventListener("click", () => ui.busy($("logo-clear"), async () => {
      if (!navigator.onLine) { ui.toast("You are offline. Connect to change the logo."); return; }
      if (!(await ui.confirm("Remove the logo?", "QR codes go back to plain black and white.", "Remove", true))) return;
      try {
        await api.del("/api/manage/logo");
        $("logo-text").value = "";
        showLogo("");
        ui.toast("Removed");
      } catch (err) { ui.toast(err.message, 4000); }
    }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const user = auth.user();
    if (!user) return;

    // The logo belongs to the whole company, so only managers see this card.
    if (auth.isManager()) {
      $("logo-card").hidden = false;
      wireLogo();
      if (navigator.onLine && auth.token()) loadLogo();
      else { $("logo-hint").textContent = "You are offline, so the logo cannot be loaded or changed right now."; }
    }
    $("acc-name").textContent = user.display_name;
    $("acc-sub").textContent = "@" + user.username + " · " + (user.role === "manager" ? "Manager" : "Guard");

    renderTheme();
    renderDevice();
    sync.onChange(renderDevice);

    document.querySelectorAll(".theme-card").forEach((card) => card.addEventListener("click", () => {
      theme.apply(card.dataset.theme);
      renderTheme();
    }));

    $("pw-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const hint = $("pw-hint");
      const current = $("pw-current").value, next = $("pw-new").value, again = $("pw-again").value;
      hint.className = "hint";
      if (next !== again) { hint.className = "hint error"; hint.textContent = "The new passwords do not match."; $("pw-again").focus(); return; }
      if (next === current) { hint.className = "hint error"; hint.textContent = "The new password is the same as the current one."; return; }
      if (!navigator.onLine) { hint.className = "hint error"; hint.textContent = "You are offline. Connect to change your password."; return; }
      ui.busy($("pw-btn"), async () => {
        try {
          const data = await api.post("/api/auth/password", { current, new: next });
          const accounts = auth.accounts();
          if (accounts[user.username]) { accounts[user.username].offline = data.offline; localStorage.setItem("nh.accounts", JSON.stringify(accounts)); }
          $("pw-form").reset();
          hint.className = "hint ok"; hint.textContent = "Password updated.";
          ui.toast("Password updated");
        } catch (err) { hint.className = "hint error"; hint.textContent = err.message; }
      });
    });

    $("sync-now-btn").addEventListener("click", () => {
      if (!navigator.onLine) ui.toast("You are offline");
      sync.push(); sync.pushLists();
    });

    $("logout-btn").addEventListener("click", async () => {
      const n = sync.pendingCount();
      const text = n ? n + " submission" + (n > 1 ? "s are" : " is") + " still waiting to sync. They stay saved on this device and will sync the next time you log in online."
                     : "You can log back in offline on this device.";
      if (await ui.confirm("Log out?", text, "Log out")) auth.logout();
    });

    $("forget-btn").addEventListener("click", async () => {
      const n = sync.pendingCount();
      if (n) { ui.toast("Sync your " + n + " waiting submission" + (n > 1 ? "s" : "") + " first, or they will be lost.", 4500); return; }
      const ok = await ui.confirm("Remove your account from this device?", "Saved checklists, history and your offline login on this device will be deleted. Synced data stays on the server.", "Remove", true);
      if (!ok) return;
      auth.forgetAccount(user.username);
      localStorage.removeItem("nh.session");
      location.href = "/login";
    });
  });
})();
