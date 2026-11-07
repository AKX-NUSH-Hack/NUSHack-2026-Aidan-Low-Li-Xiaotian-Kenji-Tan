/* =====================================================================
   manage.js
   ===================================================================== */
(function () {
  "use strict";
  const { ui, api, auth, wiz } = window.App;
  const $ = ui.$;
  const me = auth.user();

  let users = [], submissions = [];

  function renderMenu() {
    $("users-sub").textContent = users.length
      ? users.length + (users.length === 1 ? " person" : " people") + " · roles, passwords, access"
      : "Change roles, reset passwords, turn accounts off";
    $("subs-sub").textContent = submissions.length
      ? submissions.length + (submissions.length === 1 ? " submission" : " submissions") + " received"
      : "Everything your guards have sent in";
  }

  async function loadUsers() {
    const tbody = $("users-table").querySelector("tbody");
    try { users = (await api.get("/api/manage/users")).users; }
    catch (err) { tbody.innerHTML = '<tr><td colspan="4" class="hint error">' + ui.escape(err.message) + "</td></tr>"; return; }

    if (!users.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">Nobody yet.</td></tr>'; return; }

    tbody.innerHTML = users.map((u) =>
      '<tr data-id="' + u.id + '"><td><strong>' + ui.escape(u.display_name) + "</strong>" +
      '<div class="meta">@' + ui.escape(u.username) + (u.id === me.id ? " (you)" : "") + "</div></td>" +
      '<td><span class="badge ' + (u.role === "manager" ? "badge-role" : "badge-off") + '">' +
      (u.role === "manager" ? "Everything" : "Checklists") + "</span></td>" +
      '<td><span class="badge ' + (u.active ? "badge-synced" : "badge-error") + '">' + (u.active ? "On" : "Off") + "</span></td>" +
      '<td class="nowrap"><div class="row">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="role">' + (u.role === "manager" ? "Make guard" : "Make manager") + "</button>" +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="reset">New password</button>' +
      '<button type="button" class="btn ' + (u.active ? "btn-danger" : "btn-ghost") + ' btn-sm" data-act="active">' +
      (u.active ? "Turn off" : "Turn on") + "</button></div></td></tr>").join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      const u = users.find((x) => x.id === tr.dataset.id);
      tr.querySelector('[data-act="role"]').addEventListener("click", (e) => ui.busy(e.currentTarget, async () => {
        const role = u.role === "manager" ? "guard" : "manager";
        const text = role === "manager"
          ? u.display_name + " will be able to add people, change the company logo, publish checklists and read every submission."
          : u.display_name + " will only be able to fill in checklists.";
        if (!(await ui.confirm("Change what they can do?", text, "Change"))) return;
        await patch(u.id, { role });
      }));
      tr.querySelector('[data-act="active"]').addEventListener("click", (e) => ui.busy(e.currentTarget, async () => {
        const text = u.active
          ? u.display_name + " will not be able to log in. Everything they have sent is kept."
          : u.display_name + " will be able to log in again.";
        if (!(await ui.confirm(u.active ? "Turn this account off?" : "Turn it back on?", text,
          u.active ? "Turn off" : "Turn on", u.active))) return;
        await patch(u.id, { active: !u.active });
      }));
      tr.querySelector('[data-act="reset"]').addEventListener("click", () => openReset(u));
    });

    const sel = $("filter-user");
    const keep = sel.value;
    sel.innerHTML = '<option value="">Everyone</option>' + users.map((u) =>
      '<option value="' + ui.escape(u.username) + '">' + ui.escape(u.display_name) + "</option>").join("");
    sel.value = keep;
    renderMenu();
  }

  async function patch(id, changes) {
    try { await api.patch("/api/manage/users/" + id, changes); ui.toast("Saved"); await loadUsers(); }
    catch (err) { ui.toast(err.message, 4000); }
  }

  function openReset(u) {
    $("reset-who").textContent = u.display_name + " (@" + u.username + ")";
    $("reset-password").value = "";
    $("reset-modal").hidden = false;
    $("reset-password").focus();
    $("reset-ok").onclick = () => ui.busy($("reset-ok"), async () => {
      try {
        await api.post("/api/manage/users/" + u.id + "/password", { password: $("reset-password").value });
        $("reset-modal").hidden = true;
        ui.toast("Done. Tell " + u.display_name + " the new password.", 4000);
      } catch (err) { ui.toast(err.message, 4000); }
    });
  }

  async function loadSubs() {
    const tbody = $("subs-table").querySelector("tbody");
    try { submissions = (await api.get("/api/manage/submissions?limit=500")).submissions; }
    catch (err) { tbody.innerHTML = '<tr><td colspan="4" class="hint error">' + ui.escape(err.message) + "</td></tr>"; return; }
    renderSubs();
    renderMenu();
  }

  function filtered() {
    const who = $("filter-user").value;
    const text = $("filter-text").value.trim().toLowerCase();
    const problems = $("filter-problems").value;
    return submissions.filter((s) => {
      if (who && s.username !== who) return false;
      if (text && !((s.checklist_title || "") + " " + (s.notes || "")).toLowerCase().includes(text)) return false;
      if (problems === "no" && !(s.results || []).some((r) => r.k === "b" && r.v === false)) return false;
      return true;
    });
  }

  function renderSubs() {
    const rows = filtered();
    const tbody = $("subs-table").querySelector("tbody");
    $("subs-count").textContent = rows.length + " of " + submissions.length + " shown";
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="muted">Nothing matches.</td></tr>'; return; }

    tbody.innerHTML = rows.slice(0, 300).map((s, i) => {
      const bools = (s.results || []).filter((r) => r.k === "b");
      const no = bools.filter((r) => r.v === false).length;
      const tag = bools.length
        ? (no ? '<span class="badge badge-error">' + no + " No</span>" : '<span class="badge badge-synced">All yes</span>')
        : '<span class="muted small">' + (s.results || []).length + " items</span>";
      return '<tr data-i="' + i + '" style="cursor:pointer"><td class="nowrap">' + ui.fmtTime(s.submitted_at) +
        "</td><td>" + ui.escape(s.guard || s.username || "") + "</td><td>" + ui.escape(s.checklist_title || "") +
        "</td><td>" + tag + "</td></tr>";
    }).join("");

    tbody.querySelectorAll("tr").forEach((tr) =>
      tr.addEventListener("click", () => openSub(rows[Number(tr.dataset.i)])));
  }

  function openSub(s) {
    $("sub-title").textContent = s.checklist_title || "Submission";
    $("sub-meta").textContent = (s.guard || s.username) + " · filled in " + ui.fmtTime(s.submitted_at) +
      " · reached the server " + ui.fmtTime(s.received_at);
    $("sub-results").innerHTML = (s.results || []).map((r) => {
      let v;
      if (r.k === "b") v = r.v === true ? '<span class="r-val r-yes">Yes</span>'
        : r.v === false ? '<span class="r-val r-no">No</span>' : '<span class="r-val muted">—</span>';
      else v = '<span class="r-val">' + ui.escape(r.v === null || r.v === undefined || r.v === "" ? "—" : r.v) + "</span>";
      return '<li><span class="r-name">' + ui.escape(r.n) + "</span>" + v + "</li>";
    }).join("");
    $("sub-notes").textContent = s.notes ? "Note: " + s.notes : "";
    $("sub-modal").hidden = false;
  }

  function exportCsv() {
    const rows = filtered();
    if (!rows.length) { ui.toast("Nothing to export"); return; }
    const esc = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
    const lines = [["submitted_at", "received_at", "username", "name", "checklist", "item", "type", "answer", "note"].join(",")];
    rows.forEach((s) => (s.results || []).forEach((r) =>
      lines.push([s.submitted_at, s.received_at, s.username, s.guard, s.checklist_title, r.n, r.k, r.v, s.notes].map(esc).join(","))));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "submissions.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!me) return;
    if (!auth.isManager()) { $("not-manager").hidden = false; return; }
    if (!navigator.onLine || !auth.token()) {
      if (navigator.onLine && !auth.token()) {
        $("manage-offline-title").textContent = "Please log in again";
        $("manage-offline-text").textContent = "Your login expired, so this page cannot load your people or submissions yet.";
        $("manage-login-btn").hidden = false;
      }
      $("manage-offline").hidden = false;
      return;
    }
    $("manage-body").hidden = false;

    loadUsers(); loadSubs();

    $("go-adduser").addEventListener("click", () => wiz.go("adduser"));
    $("go-users").addEventListener("click", () => { loadUsers(); wiz.go("users"); });
    $("go-subs").addEventListener("click", () => { loadSubs(); wiz.go("subs"); });

    $("nu-name").addEventListener("input", () => {
      const suggested = $("nu-name").value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "").slice(0, 32);
      if (!$("nu-username").dataset.touched) $("nu-username").value = suggested;
    });
    $("nu-username").addEventListener("input", () => { $("nu-username").dataset.touched = "1"; });
    $("nu-btn").addEventListener("click", () => ui.busy($("nu-btn"), async () => {
      const hint = $("nu-hint");
      try {
        const data = await api.post("/api/manage/users", {
          username: $("nu-username").value, display_name: $("nu-name").value,
          password: $("nu-password").value, role: $("nu-role").value,
        });
        hint.className = "hint ok";
        hint.textContent = "Created. Tell " + data.user.display_name + ' to log in as "' + data.user.username + '".';
        ["nu-name", "nu-username", "nu-password"].forEach((id) => { $(id).value = ""; });
        delete $("nu-username").dataset.touched;
        await loadUsers();
      } catch (err) { hint.className = "hint error"; hint.textContent = err.message; }
    }));

    ["filter-user", "filter-text", "filter-problems"].forEach((id) => $(id).addEventListener("input", renderSubs));
    $("refresh-subs").addEventListener("click", loadSubs);
    $("export-csv").addEventListener("click", exportCsv);
    $("sub-close").addEventListener("click", () => { $("sub-modal").hidden = true; });
    $("sub-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) $("sub-modal").hidden = true; });
    $("reset-cancel").addEventListener("click", () => { $("reset-modal").hidden = true; });
    $("reset-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) $("reset-modal").hidden = true; });

    wiz.restart("menu");
  });
})();
