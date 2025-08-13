function getDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "unknown";
  }
}

async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Overwrites the screen form Snapshot - only one snapshot per URL
async function captureSiteSnapshot() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, reason: "No active tab" };
  const domain = getDomain(tab.url);

  const resp = await browser.tabs.sendMessage(tab.id, { type: "CAPTURE_FIELDS" });
  if (!resp?.ok) return { ok: false, reason: "capture failed" };

  const key = `site:${domain}`;
  await browser.storage.local.set({ [key]: resp.data });
  return { ok: true, domain, count: Object.keys(resp.data || {}).length };
}

async function fillSiteSnapshot() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url) return { ok: false, reason: "No active tab" };
  const domain = getDomain(tab.url);
  const key = `site:${domain}`;
  const data = (await browser.storage.local.get(key))[key];

  if (!data) return { ok: false, reason: "No saved snapshot for this domain" };

  const resp = await browser.tabs.sendMessage(tab.id, { type: "FILL_FIELDS", data });
  return { ok: !!resp?.ok, domain, filled: resp?.filled ?? 0 };
}

// Messages from popup window
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type === "BG_CAPTURE") {
    return captureSiteSnapshot();
  }
  if (msg?.type === "BG_FILL") {
    return fillSiteSnapshot();
  }
  if (msg?.type === "BG_CLEAR") {
    const tab = await getActiveTab();
    const domain = getDomain(tab?.url || "");
    const key = `site:${domain}`;
    await browser.storage.local.remove(key);
    return { ok: true, domain };
  }
});

// Keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command === "quick-autofill") {
    await fillSiteSnapshot();
  }
});