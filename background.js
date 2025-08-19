// ===== Helpers =====
function getDomain(url) {
  try { return new URL(url).hostname; } catch { return "unknown"; }
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSiteKeyAndState() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, reason: "No active tab" };
  const domain = getDomain(tab.url);
  const key = `site:${domain}`;
  const state = (await browser.storage.local.get(key))[key] || { profiles: {}, active: null };
  return { ok: true, tab, domain, key, state };
}

// Build payload for a single profile export
async function exportSiteProfiles(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { domain, state } = ctx;
  if (!profileName || !state.profiles[profileName]) {
    return { ok: false, reason: `Profile "${profileName}" not found` };
  }

  const payload = {
    version: 1,
    scope: "site",
    domain,
    profiles: { [profileName]: state.profiles[profileName] }
  };
  return { ok: true, domain, profile: profileName, payload };
}

// Import JSON (merge or overwrite)
async function importSiteProfiles(json, mode = "merge") {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  let parsed;
  try { parsed = (typeof json === "string") ? JSON.parse(json) : json; }
  catch { return { ok: false, reason: "Invalid JSON" }; }

  if (!parsed || parsed.scope !== "site" || !parsed.profiles || typeof parsed.profiles !== "object") {
    return { ok: false, reason: "Unsupported import format" };
  }

  const { key, state, domain } = ctx;

  if (mode === "overwrite") state.profiles = {};

  let imported = 0;
  for (const [name, data] of Object.entries(parsed.profiles)) {
    if (data && typeof data === "object") {
      state.profiles[name] = data; // overwrite by name
      imported++;
    }
  }

  if (!state.active || (parsed.active && state.profiles[parsed.active])) {
    state.active = parsed.active || state.active || Object.keys(state.profiles)[0] || null;
  }

  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, imported, active: state.active };
}

// Save a JSON file via Blob URL (data: is blocked for downloads.download)
const _downloadBlobMap = new Map();

browser.downloads.onChanged.addListener((delta) => {
  if (!delta || typeof delta.id !== "number" || !delta.state) return;
  const id = delta.id;
  const st = delta.state.current;
  if (st === "complete" || st === "interrupted") {
    const url = _downloadBlobMap.get(id);
    if (url) {
      try { URL.revokeObjectURL(url); } catch {}
      _downloadBlobMap.delete(id);
    }
  }
});

async function saveJSONFile(filename, payloadObj, saveAs = true) {
  try {
    const json = JSON.stringify(payloadObj, null, 2);
    const blobUrl = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const id = await browser.downloads.download({
      url: blobUrl,
      filename,
      saveAs,
      conflictAction: "overwrite"
    });
    _downloadBlobMap.set(id, blobUrl);
    return { ok: true, downloadId: id };
  } catch (e) {
    console.error("[Autofill] Download failed:", e);
    return { ok: false, reason: e?.message || "download failed" };
  }
}

// ===== Content bridge =====
async function captureFromPage(tabId) {
  const resp = await browser.tabs.sendMessage(tabId, { type: "CAPTURE_FIELDS" });
  if (!resp?.ok) throw new Error("capture failed");
  return resp.data || {};
}

async function fillPage(tabId, data) {
  const resp = await browser.tabs.sendMessage(tabId, { type: "FILL_FIELDS", data });
  return { ok: !!resp?.ok, filled: resp?.filled ?? 0 };
}

// ===== Core features (multi-profile) =====
async function captureSiteSnapshot(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const data = await captureFromPage(ctx.tab.id);
  const { key, state, domain } = ctx;

  state.profiles[profileName] = data;
  if (!state.active) state.active = profileName; // first profile becomes active

  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, profile: profileName, count: Object.keys(data || {}).length };
}

async function fillSiteSnapshot(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { state, domain, tab } = ctx;
  const nameToUse = profileName || state.active;
  if (!nameToUse) return { ok: false, reason: "No active profile for this domain" };

  const data = state.profiles[nameToUse];
  if (!data) return { ok: false, reason: `Profile "${nameToUse}" not found` };

  const resp = await fillPage(tab.id, data);
  return { ok: resp.ok, domain, profile: nameToUse, filled: resp.filled };
}

async function listSiteProfiles() {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const names = Object.keys(ctx.state.profiles);
  return { ok: true, domain: ctx.domain, active: ctx.state.active, profiles: names };
}

async function setActiveProfile(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { key, state, domain } = ctx;
  if (!state.profiles[profileName]) return { ok: false, reason: `Profile "${profileName}" not found` };
  state.active = profileName;
  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, active: profileName };
}

async function deleteProfile(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { key, state, domain } = ctx;
  if (!state.profiles[profileName]) return { ok: false, reason: `Profile "${profileName}" not found` };

  delete state.profiles[profileName];

  if (state.active === profileName) {
    const names = Object.keys(state.profiles);
    state.active = names.length ? names[0] : null;
  }

  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, active: state.active };
}

async function clearSiteAll() {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;
  await browser.storage.local.remove(ctx.key);
  return { ok: true, domain: ctx.domain };
}

// ===== Messages from popup =====
browser.runtime.onMessage.addListener(async (msg) => {
  try {
    switch (msg?.type) {
      // Core
      case "BG_CAPTURE":         return await captureSiteSnapshot(msg.name);
      case "BG_FILL":            return await fillSiteSnapshot(msg.name); // uses active if name omitted
      case "BG_LIST":            return await listSiteProfiles();
      case "BG_SET_ACTIVE":      return await setActiveProfile(msg.name);
      case "BG_DELETE":          return await deleteProfile(msg.name);
      case "BG_CLEAR_ALL":       return await clearSiteAll();

      // Import / Export (per-item export only)
      case "BG_EXPORT":          return await exportSiteProfiles(msg.name); // payload only
      case "BG_EXPORT_AND_SAVE": {
        const exp = await exportSiteProfiles(msg.name);
        if (!exp?.ok) return exp;
        const fname = `autofill_${exp.domain}_${exp.profile}.json`.replace(/[^\w.-]+/g, "_");
        return await saveJSONFile(fname, exp.payload, true);
      }
      case "BG_IMPORT":          return await importSiteProfiles(msg.json, msg.mode || "merge");

      default:                   return { ok: false, reason: "Unknown message" };
    }
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
});

// ===== Keyboard shortcut: fill active profile =====
browser.commands.onCommand.addListener(async (command) => {
  if (command === "quick-autofill") {
    await fillSiteSnapshot(); // uses active
  }
});
