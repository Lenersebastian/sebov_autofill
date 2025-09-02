function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wait until finder() returns a truthy element or timeout
async function waitFor(finder, { timeout = 500, interval = 25 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = finder();
    if (el) return el;
    await sleep(interval);
  }
  return null;
}

// Looks like our special readonly + arrow combo
function isArrowCombo(el) {
  if (!el || el.tagName !== "INPUT") return false;
  if (!el.readOnly) return false;
  // arrow is often the next sibling or in same container
  const sib = el.nextElementSibling;
  if (sib && sib.classList.contains("selectionbtn")) return true;
  // also check same container
  const btn = el.parentElement?.querySelector(".selectionbtn");
  return !!btn;
}

// Find the arrow button for this input
function findSelectionButton(el) {
  const sib = el.nextElementSibling;
  if (sib && sib.classList.contains("selectionbtn")) return sib;
  return el.parentElement?.querySelector(".selectionbtn") || null;
}

// After clicking the arrow, try to find the option list
function findOptionContainer() {
  // common patterns: listbox/menu/popups/tables
  return document.querySelector(
    "[role='listbox'], [role='menu'], .menu, .dropdown-menu, .popup, .popupMenu, table, ul, div.selectionPopup"
  );
}

// Find an option by visible text (exact, then contains)
function findOptionByText(container, wanted) {
  if (!container) return null;
  const txt = String(wanted ?? "").trim().toLowerCase();
  if (!txt) return null;
  const candidates = container.querySelectorAll(
    "[role='option'], [role='menuitem'], li, a, td, div, span"
  );
  for (const c of candidates) {
    const t = (c.textContent || "").trim().toLowerCase();
    if (t === txt) return c;
  }
  for (const c of candidates) {
    const t = (c.textContent || "").trim().toLowerCase();
    if (txt && t.includes(txt)) return c;
  }
  return null;
}

// Find a stable key for a field
function fieldKey(el) {
  const attrs = ["name", "id", "aria-label", "placeholder"];
  for (const a of attrs) {
    const v = el.getAttribute && el.getAttribute(a);
    if (v && v.trim()) return `${el.tagName.toLowerCase()}::${a}=${v.trim()}`;
  }
  // Fallback: index within form + type
  const formIndex = [...document.forms].indexOf(el.form);
  const allInputs = [...(el.form ? el.form.querySelectorAll("input,select,textarea") : document.querySelectorAll("input,select,textarea"))];
  const idx = allInputs.indexOf(el);
  return `${el.tagName.toLowerCase()}::form${formIndex}::idx${idx}::type=${el.type || el.tagName.toLowerCase()}`;
}

function getAllFields() {
  return [...document.querySelectorAll("input, select, textarea")].filter(el => {
    const type = (el.type || "").toLowerCase();

    // Don’t touch disabled fields
    if (el.disabled) return false;

    // Skip non-form types
    if (["hidden", "button", "submit", "reset", "file", "image"].includes(type)) return false;

    // Skip password fields
    if (type === "password") return false;

    // Visibility check
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;

    // Keep readonly if (and only if) it's the arrow-combo.
    if (el.readOnly && !isArrowCombo(el)) return false;

    return true;
  });
}

// Capture current values
function captureValues() {
  const data = {};
  for (const el of getAllFields()) {
    const key = fieldKey(el);
    if (el.tagName.toLowerCase() === "select") {
      data[key] = el.value; // single select
    } else if (el.type === "checkbox") {
      data[key] = el.checked ? "__CHECKED__" : "__UNCHECKED__";
    } else if (el.type === "radio") {
      if (el.checked) {
        // radios share name so u need multiple keys
        data[key] = el.value;
      }
    } else if (isArrowCombo(el)) {
      // store the visible text shown in the readonly input
      const shown = (el.value || el.title || el.textContent || "").trim();
      data[key] = shown;
    } else {
      data[key] = el.value ?? "";
    }
  }
  return data;
}

async function fillValues(data) {
  const fields = getAllFields();
  let filled = 0;
  const map = new Map(fields.map(el => [fieldKey(el), el]));

  for (const [key, val] of Object.entries(data || {})) {
    const el = map.get(key);
    if (!el) continue;
    const tag = el.tagName.toLowerCase();

    if (tag === "select") {
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
      continue;
    }
    if (el.type === "checkbox") {
      const should = val === "__CHECKED__";
      if (el.checked !== should) {
        el.checked = should;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      filled++;
      continue;
    }
    if (el.type === "radio") {
      if (el.value === val) {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
      continue;
    }
    if (isArrowCombo(el)) {
      try {
        const btn = findSelectionButton(el);
        if (btn) {
          // open the selector
          btn.click();
          // wait for popup/list to render
          const container = await waitFor(findOptionContainer, { timeout: 500, interval: 25 });
          if (container) {
            const opt = findOptionByText(container, val);
            if (opt) {
              opt.click();
              // give framework time to update the readonly input
              await sleep(25);
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              filled++;
              continue;
            }
          }
        }
        // Fallback: try setting value directly (some widgets accept it)
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(el, String(val ?? ""));
        else el.value = String(val ?? "");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      } catch { /* ignore and move on */ }
      continue;
    }

    // default text/textarea handling (React-friendly)
    if ((el.value ?? "") !== val) {
      const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    filled++;
  }
  return filled;
}

// Message bridge
browser.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "CAPTURE_FIELDS") {
    const data = captureValues();
    return { ok: true, data };
  }
  if (msg?.type === "FILL_FIELDS") {
    const { data } = msg;
    const count = await fillValues(data);
    return { ok: true, filled: count };
  }
});