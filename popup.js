// ===== Helpers =====
const $ = sel => document.querySelector(sel);
function setStatus(msg) { $("#status").textContent = msg; }

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
    // Enter/Escape support
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

// Utility: download a blob as file
function downloadJSON(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Import from JSON file
function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          resolve({ filename: file.name, json: obj });
        } catch (e) {
          resolve(null);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}

// ===== UI wiring =====
document.addEventListener("DOMContentLoaded", refreshList);

$("#saveBtn").addEventListener("click", async () => {
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

// Import profile(s) from JSON file
document.getElementById("importBtn").addEventListener("click", async () => {
  try {
    const picked = await pickJSONFile();
    if (!picked) return setStatus("Import canceled or invalid JSON");
    const { filename, json } = picked;

    // Supported shapes:
    //  A) { name: "Profile", data: { ... }, domain?: "example.com" }
    //  B) { profiles: { "Work": { ... }, "Personal": { ... } }, domain?: "example.com" }
    //  C) { ...raw field map... }  (no wrapper)  -> name from file name, domain = current tab
    if (json && json.profiles && typeof json.profiles === "object") {
      // Batch import
      let imported = 0;
      for (const [name, data] of Object.entries(json.profiles)) {
        const r = await browser.runtime.sendMessage({
          type: "BG_IMPORT_PROFILE",
          name,
          data,
          domain: json.domain || undefined  // optional override
        });
        if (r?.ok) imported++;
      }
      setStatus(`Imported ${imported} profile(s)`);
    } else if (json && json.name && json.data) {
      // Single named profile
      const r = await browser.runtime.sendMessage({
        type: "BG_IMPORT_PROFILE",
        name: json.name,
        data: json.data,
        domain: json.domain || undefined    // optional override
      });
      if (!r?.ok) return setStatus(`Import error: ${r?.reason || "unknown"}`);
      setStatus(`Imported "${r.profile}" (${r.count} fields)`);
    } else if (json && typeof json === "object" && !Array.isArray(json)) {
      // Raw field map -> use filename (without .json) as the profile name
      const base = filename.replace(/\.json$/i, "");
      const r = await browser.runtime.sendMessage({
        type: "BG_IMPORT_PROFILE",
        name: base || "Imported",
        data: json
      });
      if (!r?.ok) return setStatus(`Import error: ${r?.reason || "unknown"}`);
      setStatus(`Imported "${r.profile}" (${r.count} fields)`);
    } else {
      return setStatus("Import error: unsupported JSON shape");
    }

    await refreshList();
  } catch (e) {
    setStatus(`Import error: ${e.message}`);
  }
});


$("#fillBtn").addEventListener("click", async () => {
  try {
    setStatus("Filling…");
    const resp = await browser.runtime.sendMessage({ type: "BG_FILL" }); // uses active
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

// Build the dropdown list and header state
async function refreshList() {
  const resp = await browser.runtime.sendMessage({ type: "BG_LIST" });
  if (!resp?.ok) {
    $("#currentProfile").textContent = "none";
    $("#dropdown").innerHTML = `<div class="item"><span class="name">No saved forms for this site</span></div>`;
    return;
  }
  const { active, profiles = [] } = resp;

  $("#currentProfile").textContent = active || "none";

  const container = $("#dropdown");
  container.innerHTML = "";

  if (!profiles.length) {
    container.innerHTML = `<div class="item"><span class="name">No saved forms</span></div>`;
    return;
  }

  for (const name of profiles) {
    const row = document.createElement("div");
    row.className = "item";
    row.title = `Click to activate "${name}" and fill this page`;

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

    // Export button
    const exportBtn = document.createElement("span");
    exportBtn.className = "link";
    exportBtn.textContent = "⭳";
    exportBtn.title = `Export "${name}" as JSON`;
    exportBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const res = await browser.runtime.sendMessage({ type: "BG_GET_PROFILE_DATA", name });
      if (!res?.ok) return setStatus(`Error: ${res?.reason || "unknown"}`);
      const safe = `${res.domain}-${name}`.replace(/[^a-z0-9._-]+/gi, "_");
      // Export the raw field map (portable)
      downloadJSON(`sebov_autofill_${safe}.json`, res.data);
      setStatus(`Exported "${name}"`);
    });

    // Delete button
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

    actions.appendChild(exportBtn);
    actions.appendChild(delBtn);

    row.appendChild(label);
    row.appendChild(actions);

    // Clicking row itself sets active + fills page
    row.addEventListener("click", async () => {
      // set active first so shortcut also uses it
      const setResp = await browser.runtime.sendMessage({ type: "BG_SET_ACTIVE", name });
      if (!setResp?.ok) return setStatus(`Error: ${setResp?.reason || "unknown"}`);
      const fillResp = await browser.runtime.sendMessage({ type: "BG_FILL", name });
      if (!fillResp?.ok) return setStatus(`Error: ${fillResp?.reason || "unknown"}`);
      setStatus(`Filled ${fillResp.filled} fields (${fillResp.profile})`);
      await refreshList();
    });

    container.appendChild(row);
  }

  // Footer: Clear all
  const footer = document.createElement("div");
  footer.className = "item";
  const spacer = document.createElement("div");
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
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.appendChild(clearAll);
  footer.appendChild(spacer);
  footer.appendChild(actions);
  container.appendChild(footer);
}
