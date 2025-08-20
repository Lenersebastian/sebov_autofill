// Robust status logging visible in the window
const $ = s => document.querySelector(s);
const log = (...a) => {
  const el = $("#status");
  if (!el) return;
  const line = a.map(x => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  el.textContent = (el.textContent ? el.textContent + "\n" : "") + line;
};

window.addEventListener("error", e => log("Window error:", e.message));
window.addEventListener("unhandledrejection", e => log("Promise rejection:", e.reason?.message || e.reason));

// Firefox provides `browser`. If not, fall back to chrome.* style.
const api = (typeof browser !== "undefined" && browser) || (typeof chrome !== "undefined" && chrome) || null;

(function init() {
  if (!api) log("ERROR: WebExtension API not found");

  // Read domain from hash: import.html#d=<domain>
  let domain = "";
  try {
    const m = location.hash.match(/#d=([^#]+)/);
    domain = m ? decodeURIComponent(m[1]) : "";
    log("Target domain:", domain || "(missing!)");
  } catch (e) {
    log("Failed to parse domain from URL:", e.message);
  }

  $("#importBtn")?.addEventListener("click", async () => {
    try {
      log("Import clicked");
      if (!api) { log("ERROR: API unavailable"); return; }
      if (!domain) { log("ERROR: Missing target domain in URL (#d=)"); return; }

      const name = ($("#nameInput")?.value || "").trim() || "Imported";
      const fileEl = $("#fileInput");
      const file = fileEl?.files && fileEl.files[0];
      if (!file) { log("Please choose a JSON file."); return; }

      log("Reading file…");
      const text = await file.text();
      log("File size:", text.length + " bytes");

      log("Sending BG_IMPORT_WITH_NAME…");
      // Normalize sendMessage to a Promise
      const sendMsg = (msg) => {
        if (api.runtime && api.runtime.sendMessage.length === 1) {
          return api.runtime.sendMessage(msg); // promise-based
        }
        return new Promise((resolve, reject) => {
          try {
            api.runtime.sendMessage(msg, (resp) => {
              const err = api.runtime.lastError;
              if (err) reject(err);
              else resolve(resp);
            });
          } catch (e) { reject(e); }
        });
      };

      const resp = await sendMsg({
        type: "BG_IMPORT_WITH_NAME",
        json: text,
        name,
        domain
      });

      log("BG response:", resp);
      if (!resp?.ok) { log("Import error:", resp?.reason || "unknown"); return; }

      log(`Imported as "${name}" for ${resp.domain}. Will close…`);
      setTimeout(() => window.close(), 600);
    } catch (e) {
      log("ERROR:", e?.message || e);
    }
  });
})();
