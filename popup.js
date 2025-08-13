function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

document.getElementById("capture").addEventListener("click", async () => {
  const resp = await browser.runtime.sendMessage({ type: "BG_CAPTURE" });
  setStatus(resp?.ok ? `Saved ${resp.count} fields for ${resp.domain}` : `Error: ${resp?.reason || "unknown"}`);
});

document.getElementById("fill").addEventListener("click", async () => {
  const resp = await browser.runtime.sendMessage({ type: "BG_FILL" });
  setStatus(resp?.ok ? `Filled ${resp.filled} fields` : `Error: ${resp?.reason || "unknown"}`);
});

document.getElementById("clear").addEventListener("click", async () => {
  const resp = await browser.runtime.sendMessage({ type: "BG_CLEAR" });
  setStatus(resp?.ok ? `Cleared saved data for ${resp.domain}` : "Error");
});