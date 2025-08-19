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
    if (el.disabled || el.readOnly) return false;
    // Skip non-form types
    if (["hidden", "button", "submit", "reset", "file", "image"].includes(type)) return false;
    // Skip password
    if (type === "password") return false;
    // Only visible fields
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
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
    } else {
      data[key] = el.value ?? "";
    }
  }
  return data;
}

// Fill values
function fillValues(data) {
  const fields = getAllFields();
  let filled = 0;
  // Map keys to elements for faster lookup
  const map = new Map(fields.map(el => [fieldKey(el), el]));
  for (const [key, val] of Object.entries(data || {})) {
    const el = map.get(key);
    if (!el) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      filled++;
    } else if (el.type === "checkbox") {
      const shouldCheck = val === "__CHECKED__";
      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      filled++;
    } else if (el.type === "radio") {
      // Match by value
      if (el.value === val) {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        filled++;
      }
    } else {
      if ((el.value ?? "") !== val) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      filled++;
    }
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
    const count = fillValues(data);
    return { ok: true, filled: count };
  }
});