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

// Keep dropdown open while interacting (no gap already, but also prevent accidental close)
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

    const useBtn = document.createElement("span");
    useBtn.className = "link";
    useBtn.textContent = "Use";
    useBtn.title = `Make "${name}" active`;
    useBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const setResp = await browser.runtime.sendMessage({ type: "BG_SET_ACTIVE", name });
      if (!setResp?.ok) return setStatus(`Error: ${setResp?.reason || "unknown"}`);
      setStatus(`Active profile: "${name}"`);
      await refreshList();
    });

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

    actions.appendChild(useBtn);
    actions.appendChild(delBtn);

    row.appendChild(label);
    row.appendChild(actions);
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
