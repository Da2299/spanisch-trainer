// Einstiegspunkt: Status, Laden, Router, Service Worker.
import { openStorage } from './storage.js';
import { loadFsrsLibrary } from './fsrs-lib.js';
import { Scheduler, buildPlan } from './scheduler.js';
import { loadAllCards, storeImportedPackage, mergeSources } from './data.js';
import { parsePackage } from './parser.js';
import { initSpeech } from './speech.js';
import { dateKey, el, readFileAsText, downloadBlob } from './util.js';
import { renderHome } from './views/home.js';
import { renderStudy } from './views/study.js';
import { renderBrowse } from './views/browse.js';
import { renderSettings } from './views/settings.js';

export const APP_VERSION = '1.0.0';
const DEFAULT_SETTINGS = { newPerDay: 20, autoSpeak: true };

export const state = {
  storage: null,
  sch: null,
  libOrigin: null,
  cards: new Map(),
  progress: new Map(),
  days: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  sources: [],
  loadErrors: [],
  ready: false,
  swUpdateReady: false,
};

const ROUTES = {
  start: renderHome,
  lernen: renderStudy,
  karten: renderBrowse,
  einstellungen: renderSettings,
};

// ---------- Status-Operationen (für Views) ----------

export function plan(now = new Date()) {
  return buildPlan(state.sch, state.cards, state.progress, state.days, state.settings, now);
}

export function getProgress(id, now = new Date()) {
  return state.progress.get(id) || state.sch.emptyProgress(id, now);
}

/** Bewertung speichern: Lernstand + Tagesstatistik. */
export async function rateCard(id, grade, now = new Date()) {
  const before = getProgress(id, now);
  const wasNew = state.sch.isNew(before);
  const after = state.sch.rate(before, grade, now);
  state.progress.set(id, after);
  const key = dateKey(now);
  const day = state.days.get(key) || { id: key, newCount: 0, reviewCount: 0 };
  day.reviewCount += 1;
  if (wasNew) day.newCount += 1;
  state.days.set(key, day);
  await state.storage.put('progress', after);
  await state.storage.put('days', day);
  return after;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await state.storage.put('meta', { id: 'settings', ...state.settings });
}

/** Paket (.txt) importieren und Kartenmenge neu aufbauen. */
export async function importPackageFile(file) {
  const text = await readFileAsText(file);
  const name = file.name || `Import_${Date.now()}.txt`;
  const existing = new Set(state.cards.keys());
  const rec = await storeImportedPackage(state.storage, name, text);
  await reloadCards();
  let updated = 0;
  for (const c of rec.cards) if (existing.has(c.id)) updated++;
  return { name, count: rec.cards.length, updated, added: rec.cards.length - updated, skipped: rec.skipped };
}

export async function removeImportedPackage(name) {
  await state.storage.delete('packages', name);
  await reloadCards();
}

export async function reloadCards() {
  const { cards, sources, errors } = await loadAllCards(state.storage);
  state.cards = cards;
  state.sources = sources;
  state.loadErrors = errors;
}

/** Lernstand als JSON-Objekt. */
export function exportProgressObject() {
  return {
    app: 'spanisch-trainer',
    format: 1,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings },
    progress: [...state.progress.values()],
    days: [...state.days.values()],
  };
}

/** Lernstand exportieren: Teilen-Dialog (iOS) oder Download. */
export async function exportProgress() {
  const json = JSON.stringify(exportProgressObject(), null, 1);
  const filename = `spanisch-lernstand_${dateKey()}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  if (navigator.share && typeof File !== 'undefined') {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Spanisch-Lernstand' });
        return 'share';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'abgebrochen';
      // sonst Download-Fallback
    }
  }
  downloadBlob(blob, filename);
  return 'download';
}

/** Lernstand aus JSON-Text importieren (ersetzt Einträge gleicher Kennung). */
export async function importProgressJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Ungültiges JSON.');
  }
  if (!obj || obj.app !== 'spanisch-trainer' || !Array.isArray(obj.progress)) {
    throw new Error('Keine Lernstand-Datei dieser App.');
  }
  const valid = obj.progress.filter((p) => p && typeof p.id === 'string' && p.due && typeof p.state === 'number');
  for (const p of valid) state.progress.set(p.id, p);
  await state.storage.putMany('progress', valid);
  const days = Array.isArray(obj.days) ? obj.days.filter((d) => d && typeof d.id === 'string') : [];
  for (const d of days) {
    const cur = state.days.get(d.id);
    // Bei gleichem Datum den höheren Wert behalten (kein Doppelzählen).
    const merged = {
      id: d.id,
      newCount: Math.max(cur?.newCount || 0, d.newCount || 0),
      reviewCount: Math.max(cur?.reviewCount || 0, d.reviewCount || 0),
    };
    state.days.set(d.id, merged);
  }
  await state.storage.putMany('days', [...state.days.values()]);
  if (obj.settings && typeof obj.settings === 'object') {
    await saveSettings({
      newPerDay: Number.isFinite(Number(obj.settings.newPerDay)) ? Number(obj.settings.newPerDay) : state.settings.newPerDay,
      autoSpeak: typeof obj.settings.autoSpeak === 'boolean' ? obj.settings.autoSpeak : state.settings.autoSpeak,
    });
  }
  return { count: valid.length, days: days.length };
}

export async function resetProgress() {
  state.progress = new Map();
  state.days = new Map();
  await state.storage.clear('progress');
  await state.storage.clear('days');
}

// ---------- UI-Hilfen ----------

let toastTimer = null;
export function toast(msg, { error = false, ms = 3500 } = {}) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function navigate(route) {
  location.hash = `#${route}`;
}

function currentRoute() {
  const r = (location.hash || '#start').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[r] ? r : 'start';
}

let activeView = null;
function render() {
  const route = currentRoute();
  if (activeView && typeof activeView.destroy === 'function') activeView.destroy();
  const main = document.getElementById('view');
  main.replaceChildren();
  document.querySelectorAll('#tabs a').forEach((a) => {
    const on = a.dataset.route === route;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  activeView = ROUTES[route](main) || null;
  window.scrollTo(0, 0);
}

export function rerender() {
  render();
}

// ---------- Service Worker ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Nur über http(s); file:// hat keinen SW.
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            state.swUpdateReady = true;
            toast('Neue Version geladen – beim nächsten Start aktiv.', { ms: 5000 });
          }
        });
      });
    } catch (e) {
      console.warn('Service Worker nicht registriert:', e);
    }
  });
}

// ---------- Start ----------

async function boot() {
  const main = document.getElementById('view');
  main.replaceChildren(el('p', { class: 'muted center', text: 'Lade …' }));
  initSpeech();
  registerServiceWorker();

  state.storage = await openStorage();
  const { mod, origin } = await loadFsrsLibrary();
  state.sch = new Scheduler(mod);
  state.libOrigin = origin;

  const [progressRows, dayRows, settingsRow] = await Promise.all([
    state.storage.getAll('progress'),
    state.storage.getAll('days'),
    state.storage.get('meta', 'settings'),
  ]);
  state.progress = new Map(progressRows.map((p) => [p.id, p]));
  state.days = new Map(dayRows.map((d) => [d.id, d]));
  if (settingsRow) {
    const { id, ...rest } = settingsRow;
    state.settings = { ...DEFAULT_SETTINGS, ...rest };
  }
  await reloadCards();
  state.ready = true;
  for (const e of state.loadErrors) console.warn(e);

  window.addEventListener('hashchange', render);
  render();
}

boot().catch((e) => {
  console.error(e);
  const main = document.getElementById('view');
  main.replaceChildren(
    el('div', { class: 'card error-box' }, [
      el('h2', { text: 'Start fehlgeschlagen' }),
      el('p', { text: String(e && e.message ? e.message : e) }),
      el('button', { class: 'btn', onclick: () => location.reload(), text: 'Neu laden' }),
    ]),
  );
});

// Für Tests/Debugging im Browser.
window.__spanischTrainer = { state, plan, parsePackage, mergeSources, APP_VERSION };
