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

// Return raw data for a specific profile on the current site
async function getProfileData(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;
  const { state, domain } = ctx;
  const data = state.profiles[profileName];
  if (!data) return { ok: false, reason: `Profile "${profileName}" not found` };
  return { ok: true, domain, profile: profileName, data };
}

// Import a profile (overwrite if name exists); optional domain override
async function importProfile(profileName, data, domainOverride) {
  if (!profileName || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "Invalid import payload" };
  }

  // If a domain is provided, save under that bucket (no need for active tab)
  if (domainOverride) {
    const key = `site:${domainOverride}`;
    const state = (await browser.storage.local.get(key))[key] || { profiles: {}, active: null };
    state.profiles[profileName] = data;
    if (!state.active) state.active = profileName;
    await browser.storage.local.set({ [key]: state });
    return { ok: true, domain: domainOverride, profile: profileName, count: Object.keys(data || {}).length };
  }

  // Default: use current tab's domain
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;
  const { key, state, domain } = ctx;
  state.profiles[profileName] = data;
  if (!state.active) state.active = profileName;
  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, profile: profileName, count: Object.keys(data || {}).length };
}

// Save snapshot under a given name; create/overwrite that profile
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

// Fill using active profile or a provided one
async function fillSiteSnapshot(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { key, state, domain, tab } = ctx;
  const nameToUse = profileName || state.active;
  if (!nameToUse) return { ok: false, reason: "No active profile for this domain" };

  const data = state.profiles[nameToUse];
  if (!data) return { ok: false, reason: `Profile "${nameToUse}" not found` };

  const resp = await fillPage(tab.id, data);
  return { ok: resp.ok, domain, profile: nameToUse, filled: resp.filled };
}

// List profiles for current site
async function listSiteProfiles() {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const names = Object.keys(ctx.state.profiles);
  return { ok: true, domain: ctx.domain, active: ctx.state.active, profiles: names };
}

// Set active profile
async function setActiveProfile(profileName) {
  const ctx = await getSiteKeyAndState();
  if (!ctx.ok) return ctx;

  const { key, state, domain } = ctx;
  if (!state.profiles[profileName]) return { ok: false, reason: `Profile "${profileName}" not found` };
  state.active = profileName;
  await browser.storage.local.set({ [key]: state });
  return { ok: true, domain, active: profileName };
}

// Delete a profile; if it was active, pick another arbitrarily
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

// Clear ALL saved data for current site
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
      case "BG_CAPTURE":         return await captureSiteSnapshot(msg.name);
      case "BG_FILL":            return await fillSiteSnapshot(msg.name);
      case "BG_LIST":            return await listSiteProfiles();
      case "BG_SET_ACTIVE":      return await setActiveProfile(msg.name);
      case "BG_DELETE":          return await deleteProfile(msg.name);
      case "BG_CLEAR_ALL":       return await clearSiteAll();
      case "BG_GET_PROFILE_DATA": return await getProfileData(msg.name);
      case "BG_IMPORT_PROFILE":   return await importProfile(msg.name, msg.data, msg.domain);
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
