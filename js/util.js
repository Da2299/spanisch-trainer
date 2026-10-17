// Allgemeine Hilfsfunktionen (ohne Abhängigkeiten).

/** Lokaler Datums-Schlüssel YYYY-MM-DD. */
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Ende des lokalen Tages (23:59:59.999). */
export function endOfDay(d = new Date()) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

/** Datum um n Tage verschieben (lokal). */
export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** HTML-Escaping für Text, der in innerHTML landet. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Element-Shortcut. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/**
 * Intervall (Millisekunden) als kurze deutsche Angabe formatieren.
 * < 1 Std: Minuten, < 1 Tag: Stunden, < 30 Tage: Tage, < 365 Tage: Monate, sonst Jahre.
 */
export function formatInterval(ms) {
  const min = ms / 60000;
  if (min < 1) return '<1 Min';
  if (min < 60) return `${Math.round(min)} Min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} Std`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} T`;
  const mo = d / 30.4375;
  if (mo < 12) return `${mo < 10 ? mo.toFixed(1).replace('.0', '').replace('.', ',') : Math.round(mo)} Mo`;
  const y = d / 365.25;
  return `${y < 10 ? y.toFixed(1).replace('.0', '').replace('.', ',') : Math.round(y)} J`;
}

/** Datum lesbar (deutsch). */
export function formatDate(d) {
  if (!d) return '–';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Einfacher, schneller String-Hash (FNV-1a, 32 Bit) als Hex. */
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Datei als UTF-8-Text lesen. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('Datei konnte nicht gelesen werden'));
    r.readAsText(file, 'utf-8');
  });
}

/** Blob herunterladen (Fallback, wenn kein Teilen-Dialog verfügbar). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
