// ===== Helpers =====
const $ = sel => document.querySelector(sel);
function setStatus(msg) { $("#status").textContent = msg; }

// Safe event attach
function on(sel, evt, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(evt, fn);
}

// Simple in-popup modal (replaces prompt/confirm)
function showNameDialog(defaultValue = "Default") {
  return new Promise(resolve => {
    const ov = $("#overlay");
    $("#dlgTitle").textContent = "Sebov Autofill";
    $("#dlgBody").innerHTML = `
      <label for="nameInput">Save as profile name:</label>
      <input id="nameInput" type="text" />
    `;
    $("#dlgOk").textContent = "Save";
    $("#dlgCancel").textContent = "Cancel";
    ov.style.display = "flex";
    const input = $("#nameInput");
    input.value = defaultValue;
    input.focus();
    input.select();

    const done = (val) => { ov.style.display = "none"; resolve(val); };
    $("#dlgOk").onclick = () => done(input.value.trim());
    $("#dlgCancel").onclick = () => done(null);
    ov.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
      if (e.key === "Escape") { e.preventDefault(); done(null); }
    };
  });
}

function showConfirm(message) {
  return new Promise(resolve => {
    const ov = $("#overlay");
    $("#dlgTitle").textContent = "Confirm";
    $("#dlgBody").innerHTML = `<div style="margin-bottom:10px">${message}</div>`;
    $("#dlgOk").textContent = "OK";
    $("#dlgCancel").textContent = "Cancel";
    ov.style.display = "flex";
    const done = (val) => { ov.style.display = "none"; resolve(val); };
    $("#dlgOk").onclick = () => done(true);
    $("#dlgCancel").onclick = () => done(false);
    ov.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(true); }
      if (e.key === "Escape") { e.preventDefault(); done(false); }
    };
  });
}

// ===== UI wiring =====
document.addEventListener("DOMContentLoaded", refreshList);

on("#saveBtn", "click", async () => {
  try {
    const name = await showNameDialog("Default");
    if (!name) return;
    setStatus("Saving…");
    const resp = await browser.runtime.sendMessage({ type: "BG_CAPTURE", name });
    if (!resp?.ok) return setStatus(`Error: ${resp?.reason || "unknown"}`);
    setStatus(`Saved ${resp.count} fields as "${resp.profile}"`);
    await refreshList();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

on("#fillBtn", "click", async () => {
  try {
    setStatus("Filling…");
    const resp = await browser.runtime.sendMessage({ type: "BG_FILL" });
    if (!resp?.ok) return setStatus(`Error: ${resp?.reason || "unknown"}`);
    setStatus(`Filled ${resp.filled} fields (${resp.profile})`);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

// Keep dropdown open while interacting
const changeBtn = $("#changeBtn");
const dropdown = $("#dropdown");
let hoverTimer = null;

if (changeBtn && dropdown) {
  changeBtn.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimer);
    dropdown.style.display = "block";
  });
  changeBtn.addEventListener("mouseleave", () => {
    hoverTimer = setTimeout(() => (dropdown.style.display = "none"), 150);
  });
  dropdown.addEventListener("mouseenter", () => {
    clearTimeout(hoverTimer);
    dropdown.style.display = "block";
  });
  dropdown.addEventListener("mouseleave", () => {
    hoverTimer = setTimeout(() => (dropdown.style.display = "none"), 150);
  });
}

// ===== Refresh list =====
async function refreshList() {
  const resp = await browser.runtime.sendMessage({ type: "BG_LIST" });
  const container = $("#dropdown");
  container.innerHTML = "";

  if (!resp?.ok) {
    $("#currentProfile").textContent = "none";
    container.innerHTML = `<div class="item"><span class="name">No saved forms for this site</span></div>`;
    return;
  }

  const { active, profiles = [] } = resp;
  $("#currentProfile").textContent = active || "none";

  if (!profiles.length) {
    container.innerHTML = `<div class="item"><span class="name">No saved forms</span></div>`;
    return;
  }

  for (const name of profiles) {
    const row = document.createElement("div");
    row.className = "item";
    row.title = `Make "${name}" active`;

    const label = document.createElement("div");
    label.className = "name";
    label.textContent = name;

    if (name === active) {
      const badge = document.createElement("span");
      badge.className = "active-badge";
      badge.textContent = "active";
      label.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "actions";

    // 📥 export this profile
    const dlBtn = document.createElement("span");
    dlBtn.className = "icon-btn";
    dlBtn.textContent = "📥";
    dlBtn.title = `Export "${name}" as JSON`;
    dlBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      setStatus(`Exporting "${name}"…`);
      const res = await browser.runtime.sendMessage({ type: "BG_EXPORT_AND_SAVE", name });
      if (res?.ok) {
        setStatus(`Saved "${name}"`);
        return;
      }
      // fallback: export payload, copy or open tab
      const exp = await browser.runtime.sendMessage({ type: "BG_EXPORT", name });
      if (!exp?.ok) return setStatus(`Export failed: ${exp?.reason || "unknown"}`);
      const json = JSON.stringify(exp.payload, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        setStatus("Download blocked — JSON copied to clipboard");
      } catch {
        const url = "data:application/json;charset=utf-8," + encodeURIComponent(json);
        await browser.tabs.create({ url });
        setStatus("Opened JSON in a new tab (use Save Page As…)");
      }
    });

    // × delete this profile
    const delBtn = document.createElement("span");
    delBtn.className = "link btn-danger";
    delBtn.textContent = "×";
    delBtn.title = `Delete "${name}"`;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await showConfirm(`Delete saved form "${name}"?`))) return;
      const delResp = await browser.runtime.sendMessage({ type: "BG_DELETE", name });
      if (!delResp?.ok) return setStatus(`Error: ${delResp?.reason || "unknown"}`);
      setStatus(`Deleted "${name}"`);
      await refreshList();
    });

    actions.appendChild(dlBtn);
    actions.appendChild(delBtn);

    // Clicking the row sets active AND autofills immediately
    row.addEventListener("click", async () => {
      try {
        setStatus(`Switching to "${name}"…`);
        const setResp = await browser.runtime.sendMessage({ type: "BG_SET_ACTIVE", name });
        if (!setResp?.ok) return setStatus(`Error: ${setResp?.reason || "unknown"}`);

        // Immediately autofill using that profile
        const fillResp = await browser.runtime.sendMessage({ type: "BG_FILL", name });
        if (!fillResp?.ok) return setStatus(`Error: ${fillResp?.reason || "unknown"}`);

        setStatus(`Filled ${fillResp.filled} fields (${fillResp.profile})`);
        // Update header active label
        const current = document.querySelector("#currentProfile");
        if (current) current.textContent = name;

        // Optionally close dropdown after action
        const dropdown = document.querySelector("#dropdown");
        if (dropdown) dropdown.style.display = "none";

        // Refresh list to show the “active” badge on the chosen row
        await refreshList();
      } catch (e) {
        setStatus(`Error: ${e.message || e}`);
      }
    });


    row.appendChild(label);
    row.appendChild(actions);
    container.appendChild(row);
  }

  // Footer: Clear all
  const footer = document.createElement("div");
  footer.className = "item";
  footer.title = "Clear all saved forms for this site";

  const spacer = document.createElement("div");
  const actions = document.createElement("div");
  actions.className = "actions";

  const clearAll = document.createElement("span");
  clearAll.className = "link btn-danger";
  clearAll.textContent = "Clear all for this site";
  clearAll.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!(await showConfirm("Delete ALL saved forms for this site?"))) return;
    const clr = await browser.runtime.sendMessage({ type: "BG_CLEAR_ALL" });
    if (!clr?.ok) return setStatus(`Error: ${clr?.reason || "unknown"}`);
    setStatus("Cleared all saved forms");
    await refreshList();
  });

  actions.appendChild(clearAll);
  footer.appendChild(spacer);
  footer.appendChild(actions);
  container.appendChild(footer);
}

// ===== Import =====
on("#importBtn", "click", () => {
  const input = $("#fileInput");
  if (input) {
    input.value = "";
    input.click();
  }
});

on("#fileInput", "change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    setStatus("Reading file…");
    const text = await file.text();

    const overwrite = await showConfirm(
      "Import profiles from JSON?\nOK = Overwrite existing names, Cancel = Merge"
    );

    setStatus("Importing…");
    const resp = await browser.runtime.sendMessage({
      type: "BG_IMPORT",
      json: text,
      mode: overwrite ? "overwrite" : "merge"
    });

    console.log("[Autofill] Import response:", resp);   // <-- add this
    if (!resp?.ok) {
      setStatus(`Import error: ${resp?.reason || "unknown"}`);
      return;
    }
    setStatus(`Imported ${resp.imported} profile(s). Active: ${resp.active || "none"}`);
    await refreshList();
  } catch (err) {
    console.error("[Autofill] Import failed:", err);
    setStatus(`Error: ${err.message}`);
  }
});

