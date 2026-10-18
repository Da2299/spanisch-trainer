// Einstiegspunkt: Status, Laden, Router, Service Worker.
import { openStorage } from './storage.js';
import { migrateSchema, SCHEMA_VERSION } from './migrate.js';
import { loadFsrsLibrary } from './fsrs-lib.js';
import { Scheduler, buildPlan, parseFsrsParams, clampRetention, cardTypeOf, newCountField } from './scheduler.js';
import { loadAllCards, storeImportedPackage, mergeSources } from './data.js';
import { parsePackage } from './parser.js';
import { loadVerbs, buildVerbForms } from './verbs.js';
import { initSpeech } from './speech.js';
import { dateKey, el, readFileAsText, downloadBlob, toCsv, uid } from './util.js';
import { renderHome } from './views/home.js';
import { renderStudy } from './views/study.js';
import { renderBrowse } from './views/browse.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { renderVerbTable, renderPatterns } from './views/verbs.js';

export const APP_VERSION = '1.5.0';
export const EXPORT_FORMAT = 2;
export const BACKUP_REMINDER_DAYS = 7;
export const DEFAULT_SETTINGS = {
  newPerDay: 15,
  requestRetention: 0.9,
  fsrsParams: '',
  autoSpeak: true,
  newBackPerDay: 10,
  newHearPerDay: 10,
  newVerbPerDay: 10,
  tipMode: false, // Verbform eintippen statt „Antwort zeigen“
  ratingMode: 'simple', // 'simple' = Vergessen/Gewusst, 'full' = vier Stufen
  sessionSize: 15, // Karten je Lernsitzung
};
export const SECONDS_PER_CARD = 20; // Schätzwert ohne Protokoll

export const state = {
  storage: null,
  sch: null,
  libOrigin: null,
  cards: new Map(),
  progress: new Map(),
  cardmeta: new Map(),
  reviews: [],
  days: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  backup: { lastExportAt: null },
  sources: [],
  verbs: [],
  verbForms: new Map(),
  loadErrors: [],
  schema: null,
  ready: false,
  swUpdateReady: false,
  lastRating: null, // für Rückgängig
};

const ROUTES = {
  start: renderHome,
  lernen: renderStudy,
  karten: renderBrowse,
  statistik: renderStats,
  einstellungen: renderSettings,
  verb: renderVerbTable, // #verb/<lemma>
  muster: renderPatterns,
};
/** Tab, der für eine Route hervorgehoben wird. */
const TAB_OF = { verb: 'karten', muster: 'karten', statistik: 'start' };

// ---------- Status-Operationen (für Views) ----------

export function plan(now = new Date()) {
  return buildPlan(state.sch, state.cards, state.progress, state.cardmeta, state.days, state.settings, now, { verbForms: state.verbForms });
}

/** Geschätzte Dauer in Minuten für n Karten (Median der letzten Antwortdauern, sonst Schätzwert). */
export function estimateMinutes(n) {
  if (!n) return 0;
  const recent = state.reviews.slice(-100).map((r) => r.duration).filter((d) => d > 0);
  let perCard = SECONDS_PER_CARD;
  if (recent.length >= 10) {
    const sorted = [...recent].sort((a, b) => a - b);
    perCard = Math.min(90, Math.max(5, sorted[Math.floor(sorted.length / 2)] / 1000 + 4));
  }
  return Math.max(1, Math.ceil((n * perCard) / 60));
}

export function getVerb(lemma) {
  return state.verbs.find((v) => v.lemma === lemma) || null;
}

export function getVerbByKennung(id) {
  return state.verbs.find((v) => v.kennung === id) || null;
}

export function getProgress(id, now = new Date()) {
  return state.progress.get(id) || state.sch.emptyProgress(id, now);
}

export function getCardMeta(id) {
  return state.cardmeta.get(id) || { id, note: '', suspended: false };
}

function dayRecord(key) {
  return state.days.get(key) || { id: key, newCount: 0, reviewCount: 0, newHearCount: 0, newVerbCount: 0, newBackCount: 0 };
}

/**
 * Bewertung speichern: Lernstand, Protokolleintrag, Tagesstatistik.
 * @param {string} id Kartenschlüssel
 * @param {1|2|3|4} grade
 * @param {{durationMs?: number, now?: Date}} [opts]
 */
export async function rateCard(id, grade, opts = {}) {
  const now = opts.now || new Date();
  const type = cardTypeOf(id);
  const hadProgress = state.progress.has(id);
  const before = getProgress(id, now);
  const wasNew = state.sch.isNew(before);
  const { progress: after, log } = state.sch.rate(before, grade, now);
  const key = dateKey(now);
  const prevDay = state.days.has(key) ? { ...state.days.get(key) } : null;
  const day = dayRecord(key);
  day.reviewCount += 1;
  if (wasNew) day[newCountField(type)] = (day[newCountField(type)] || 0) + 1;
  const review = {
    id: uid(),
    cardId: id,
    cardType: type,
    time: now.getTime(),
    rating: grade,
    state: state.sch.stateCode(before),
    duration: Math.max(0, Math.min(3600000, Math.round(opts.durationMs || 0))),
    scheduledDays: after.scheduled_days,
    elapsedDays: log.elapsed_days,
    log,
  };
  state.progress.set(id, after);
  state.days.set(key, day);
  state.reviews.push(review);
  // prevProgress = null, wenn die Karte vorher keinen gespeicherten Lernstand hatte
  state.lastRating = { id, review, prevProgress: hadProgress ? before : null, prevDay, dayKey: key, wasNew };
  await state.storage.put('progress', after);
  await state.storage.put('days', day);
  await state.storage.put('reviews', review);
  return { after, review };
}

/** Letzte Bewertung zurücknehmen. Liefert den Kartenschlüssel oder null. */
export async function undoLastRating() {
  const last = state.lastRating;
  if (!last) return null;
  state.lastRating = null;
  const { id, review, prevProgress, prevDay, dayKey } = last;
  if (prevProgress) {
    state.progress.set(id, prevProgress);
    await state.storage.put('progress', prevProgress);
  } else {
    state.progress.delete(id);
    await state.storage.delete('progress', id);
  }
  if (prevDay) {
    state.days.set(dayKey, prevDay);
    await state.storage.put('days', prevDay);
  } else {
    state.days.delete(dayKey);
    await state.storage.delete('days', dayKey);
  }
  const idx = state.reviews.findIndex((r) => r.id === review.id);
  if (idx >= 0) state.reviews.splice(idx, 1);
  await state.storage.delete('reviews', review.id);
  return id;
}

export async function setCardMeta(id, patch) {
  const cur = getCardMeta(id);
  const next = { ...cur, ...patch, id, updatedAt: new Date().toISOString() };
  state.cardmeta.set(id, next);
  await state.storage.put('cardmeta', next);
  return next;
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await state.storage.put('meta', { id: 'settings', ...state.settings });
  applySchedulerSettings();
}

/** Zielretention und eigene Parameter an den Scheduler geben. */
export function applySchedulerSettings() {
  const { w } = parseFsrsParams(state.settings.fsrsParams);
  state.sch.configure({ requestRetention: clampRetention(state.settings.requestRetention), w });
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
  state.verbForms = buildVerbForms(state.verbs, state.cards);
}

/** data/verben.json laden (optional) und Formkarten aufbauen. */
export async function reloadVerbs() {
  const { verbs, error } = await loadVerbs();
  state.verbs = verbs;
  if (error) state.loadErrors.push(error);
  state.verbForms = buildVerbForms(state.verbs, state.cards);
}

// ---------- Sicherung ----------

/** Vollständige Sicherung als JSON-Objekt (Schemaversion EXPORT_FORMAT). */
export function exportObject() {
  return {
    app: 'spanisch-trainer',
    format: EXPORT_FORMAT,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings },
    progress: [...state.progress.values()],
    days: [...state.days.values()],
    reviews: [...state.reviews],
    cardmeta: [...state.cardmeta.values()],
  };
}

async function shareOrDownload(blob, filename, title) {
  if (navigator.share && typeof File !== 'undefined') {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return 'share';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'abgebrochen';
    }
  }
  downloadBlob(blob, filename);
  return 'download';
}

/** Lernstand exportieren: Teilen-Dialog (iOS) oder Download. Merkt sich den Zeitpunkt. */
export async function exportProgress() {
  const json = JSON.stringify(exportObject(), null, 1);
  const filename = `spanisch-lernstand_${dateKey()}.json`;
  const how = await shareOrDownload(new Blob([json], { type: 'application/json' }), filename, 'Spanisch-Lernstand');
  if (how !== 'abgebrochen') {
    state.backup = { lastExportAt: new Date().toISOString() };
    await state.storage.put('meta', { id: 'backup', ...state.backup });
  }
  return how;
}

/** Bewertungsprotokoll als CSV (Eingabeformat des FSRS-Optimizers). */
export function reviewsCsv() {
  const rows = [['card_id', 'review_time', 'review_rating', 'review_state', 'review_duration']];
  const sorted = [...state.reviews].sort((a, b) => a.time - b.time);
  for (const r of sorted) rows.push([r.cardId, r.time, r.rating, r.state, r.duration]);
  return toCsv(rows);
}

export async function exportReviewsCsv() {
  const filename = `spanisch-protokoll_${dateKey()}.csv`;
  return shareOrDownload(new Blob([reviewsCsv()], { type: 'text/csv' }), filename, 'Spanisch-Protokoll');
}

/** Sicherung aus JSON-Text wiederherstellen (ersetzt den bisherigen Stand vollständig). */
export async function importBackupJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Ungültiges JSON.');
  }
  if (!obj || obj.app !== 'spanisch-trainer' || !Array.isArray(obj.progress)) {
    throw new Error('Keine Sicherungsdatei dieser App.');
  }
  const progress = obj.progress.filter((p) => p && typeof p.id === 'string' && p.due && typeof p.state === 'number');
  const days = (Array.isArray(obj.days) ? obj.days : []).filter((d) => d && typeof d.id === 'string');
  const reviews = (Array.isArray(obj.reviews) ? obj.reviews : []).filter((r) => r && typeof r.id === 'string' && typeof r.cardId === 'string');
  const cardmeta = (Array.isArray(obj.cardmeta) ? obj.cardmeta : []).filter((m) => m && typeof m.id === 'string');
  for (const p of progress) if (typeof p.againCount !== 'number') p.againCount = 0;

  const s = state.storage;
  await Promise.all([s.clear('progress'), s.clear('days'), s.clear('reviews'), s.clear('cardmeta')]);
  await s.putMany('progress', progress);
  await s.putMany('days', days);
  await s.putMany('reviews', reviews);
  await s.putMany('cardmeta', cardmeta);
  state.progress = new Map(progress.map((p) => [p.id, p]));
  state.days = new Map(days.map((d) => [d.id, d]));
  state.reviews = reviews;
  state.cardmeta = new Map(cardmeta.map((m) => [m.id, m]));
  state.lastRating = null;
  if (obj.settings && typeof obj.settings === 'object') {
    await saveSettings(sanitizeSettings(obj.settings));
  }
  return { progress: progress.length, days: days.length, reviews: reviews.length, cardmeta: cardmeta.length, format: obj.format || 1 };
}

export function sanitizeSettings(src) {
  const out = {};
  if (Number.isFinite(Number(src.newPerDay))) out.newPerDay = Math.min(50, Math.max(0, Math.round(Number(src.newPerDay))));
  if (Number.isFinite(Number(src.newHearPerDay))) out.newHearPerDay = Math.min(50, Math.max(0, Math.round(Number(src.newHearPerDay))));
  if (Number.isFinite(Number(src.newBackPerDay))) out.newBackPerDay = Math.min(50, Math.max(0, Math.round(Number(src.newBackPerDay))));
  if (Number.isFinite(Number(src.newVerbPerDay))) out.newVerbPerDay = Math.min(50, Math.max(0, Math.round(Number(src.newVerbPerDay))));
  if (Number.isFinite(Number(src.requestRetention))) out.requestRetention = clampRetention(src.requestRetention);
  if (typeof src.fsrsParams === 'string' && !parseFsrsParams(src.fsrsParams).error) out.fsrsParams = src.fsrsParams;
  if (Number.isFinite(Number(src.sessionSize))) out.sessionSize = Math.min(100, Math.max(5, Math.round(Number(src.sessionSize))));
  if (src.ratingMode === 'simple' || src.ratingMode === 'full') out.ratingMode = src.ratingMode;
  for (const k of ['autoSpeak', 'tipMode']) if (typeof src[k] === 'boolean') out[k] = src[k];
  return out;
}

export async function resetProgress() {
  state.progress = new Map();
  state.days = new Map();
  state.reviews = [];
  state.cardmeta = new Map();
  state.lastRating = null;
  const s = state.storage;
  await Promise.all([s.clear('progress'), s.clear('days'), s.clear('reviews'), s.clear('cardmeta')]);
}

/** Liegt die letzte Sicherung länger als BACKUP_REMINDER_DAYS zurück (oder gab es nie eine)? */
export function backupDue(now = new Date()) {
  if (!state.progress.size) return false;
  const last = state.backup.lastExportAt ? new Date(state.backup.lastExportAt).getTime() : 0;
  return now.getTime() - last > BACKUP_REMINDER_DAYS * 86400000;
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

/** Route und Parameter aus dem Hash: „#verb/tener“ → { route: 'verb', param: 'tener' }. */
function currentRoute() {
  const raw = (location.hash || '#start').replace(/^#\/?/, '').split('?')[0];
  const [r, ...rest] = raw.split('/');
  const param = rest.length ? decodeURIComponent(rest.join('/')) : '';
  return ROUTES[r] ? { route: r, param } : { route: 'start', param: '' };
}

let activeView = null;
function render() {
  const { route, param } = currentRoute();
  if (activeView && typeof activeView.destroy === 'function') activeView.destroy();
  const main = document.getElementById('view');
  main.replaceChildren();
  const tab = TAB_OF[route] || route;
  document.querySelectorAll('#tabs a').forEach((a) => {
    const on = a.dataset.route === tab;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  activeView = ROUTES[route](main, param) || null;
  window.scrollTo(0, 0);
}

export function rerender() {
  render();
}

// ---------- Service Worker ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
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
  state.schema = await migrateSchema(state.storage);
  if (state.schema.migrated) console.info(`Speicher von Schema ${state.schema.from} auf ${state.schema.to} migriert.`);

  const { mod, origin } = await loadFsrsLibrary();
  state.libOrigin = origin;

  const [progressRows, dayRows, reviewRows, metaRows, settingsRow, backupRow] = await Promise.all([
    state.storage.getAll('progress'),
    state.storage.getAll('days'),
    state.storage.getAll('reviews'),
    state.storage.getAll('cardmeta'),
    state.storage.get('meta', 'settings'),
    state.storage.get('meta', 'backup'),
  ]);
  state.progress = new Map(progressRows.map((p) => [p.id, p]));
  state.days = new Map(dayRows.map((d) => [d.id, d]));
  state.reviews = reviewRows.sort((a, b) => a.time - b.time);
  state.cardmeta = new Map(metaRows.map((m) => [m.id, m]));
  if (settingsRow) {
    const { id, ...rest } = settingsRow;
    state.settings = { ...DEFAULT_SETTINGS, ...sanitizeSettings(rest) };
  }
  if (backupRow && backupRow.lastExportAt) state.backup = { lastExportAt: backupRow.lastExportAt };
  state.sch = new Scheduler(mod);
  applySchedulerSettings();

  await reloadCards();
  await reloadVerbs();
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
window.__spanischTrainer = { state, plan, parsePackage, mergeSources, reviewsCsv, exportObject, rateCard, rerender, APP_VERSION, SCHEMA_VERSION };
