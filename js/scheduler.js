// Spaced Repetition mit FSRS (ts-fsrs). Reine Funktionen über Kartenliste + Lernstand.
import { dateKey, endOfDay, addDays } from './util.js';
import { compareByRank } from './parser.js';
import { compareByFrequency } from './verbs.js';

export const LEARN_AHEAD_MS = 20 * 60 * 1000; // Lernkarten bis 20 Min. im Voraus zeigen
export const LEECH_THRESHOLD = 8; // ab so vielen „Nochmal“ gilt eine Karte als schwierig
export const RATINGS = [
  { grade: 1, key: 'again', label: 'Nochmal' },
  { grade: 2, key: 'hard', label: 'Schwer' },
  { grade: 3, key: 'good', label: 'Gut' },
  { grade: 4, key: 'easy', label: 'Einfach' },
];

/** Kartentypen. Der Typ ergibt sich aus dem Kartenschlüssel. */
export const CARD_TYPES = {
  vocab: { key: 'vocab', label: 'Vokabel', labelPlural: 'Vokabeln', session: 'Vokabeln' },
  back: { key: 'back', label: 'Rückwärts', labelPlural: 'Rückwärtskarten', session: 'Rückwärts' },
  hear: { key: 'hear', label: 'Hören', labelPlural: 'Hörkarten', session: 'Hören' },
  verb: { key: 'verb', label: 'Verbform', labelPlural: 'Verbformen', session: 'Verben' },
};
/** Bewertungen im einfachen Modus (zwei Knöpfe): Vergessen = Nochmal, Gewusst = Gut. */
export const SIMPLE_RATINGS = [
  { grade: 1, key: 'again', label: 'Vergessen' },
  { grade: 3, key: 'good', label: 'Gewusst' },
];
export const TYPE_ORDER = ['vocab', 'back', 'hear', 'verb'];

export function cardTypeOf(key) {
  if (typeof key !== 'string') return 'vocab';
  if (key.startsWith('V:')) return 'verb';
  if (key.endsWith(':H')) return 'hear';
  if (key.endsWith(':R')) return 'back';
  return 'vocab';
}

/** Kennung der Vokabelkarte, zu der ein Schlüssel gehört (Hör-/Rückwärtskarte → Kennung; Verbform: Lemma-Schlüssel). */
export function baseIdOf(key) {
  const t = cardTypeOf(key);
  if (t === 'hear' || t === 'back') return key.slice(0, -2);
  return key;
}

/** Schlüssel der Rückwärtskarte (Deutsch → Spanisch) zu einer Kennung. */
export function backKeyOf(id) {
  return `${id}:R`;
}

/** Akzeptierte Längen für eigene FSRS-Parameter (ts-fsrs füllt auf 21 auf). */
export const FSRS_PARAM_LENGTHS = [17, 19, 21];

/**
 * Parametertext („w1, w2, …“) in eine Zahlenliste wandeln.
 * @returns {{w: number[]|null, error: string|null}} w = null bedeutet Standardparameter.
 */
export function parseFsrsParams(text) {
  const t = String(text || '').trim();
  if (!t) return { w: null, error: null };
  const parts = t.split(/[\s,;]+/).filter(Boolean);
  const w = parts.map((x) => Number(x.replace(',', '.')));
  if (w.some((x) => !Number.isFinite(x))) return { w: null, error: 'Enthält ungültige Zahlen.' };
  if (!FSRS_PARAM_LENGTHS.includes(w.length)) {
    return { w: null, error: `Erwartet 17, 19 oder 21 Werte, gefunden: ${w.length}.` };
  }
  return { w, error: null };
}

export class Scheduler {
  /**
   * @param {object} lib Das ts-fsrs-Modul
   * @param {{requestRetention?: number, w?: number[]|null}} [opts]
   */
  constructor(lib, opts = {}) {
    this.lib = lib;
    this.State = lib.State;
    this.Rating = lib.Rating;
    this.configure(opts);
  }

  /** Parameter neu setzen (Zielretention, eigene Gewichte). Gilt für alle künftigen Planungen. */
  configure({ requestRetention = 0.9, w = null } = {}) {
    const rr = clampRetention(requestRetention);
    const input = { request_retention: rr };
    if (Array.isArray(w) && FSRS_PARAM_LENGTHS.includes(w.length)) input.w = w;
    this.params = this.lib.generatorParameters(input);
    this.f = this.lib.fsrs(this.params);
    this.requestRetention = rr;
    this.customW = input.w ? [...input.w] : null;
  }

  /** Neuen (leeren) FSRS-Datensatz für einen Kartenschlüssel erzeugen. */
  emptyProgress(id, now = new Date()) {
    return { id, ...serializeCard(this.lib.createEmptyCard(now)), againCount: 0 };
  }

  /** Ist der Lernstand "neu" (noch nie bewertet)? */
  isNew(progress) {
    return !progress || progress.state === this.State.New || !progress.reps;
  }

  /**
   * Fällig? Karten im Status Review zählen tagesgenau (fällig, wenn Datum <= heute),
   * Lern-/Wiederlernkarten minutengenau (mit Lernvorlauf).
   */
  isDue(progress, now = new Date(), aheadMs = LEARN_AHEAD_MS) {
    if (this.isNew(progress)) return false;
    const due = new Date(progress.due).getTime();
    if (progress.state === this.State.Review) return due <= endOfDay(now).getTime();
    return due <= now.getTime() + aheadMs;
  }

  /** Vorschau der vier Bewertungen: { grade: { card, intervalMs } }. */
  preview(progress, now = new Date()) {
    const rec = this.f.repeat(toCardInput(progress), now);
    const out = {};
    for (const r of RATINGS) {
      const item = rec[r.grade];
      out[r.grade] = { card: item.card, log: item.log, intervalMs: item.card.due.getTime() - now.getTime() };
    }
    return out;
  }

  /**
   * Bewertung anwenden.
   * @returns {{progress: object, log: object}} neuer (serialisierter) Lernstand und FSRS-Log
   */
  rate(progress, grade, now = new Date()) {
    const item = this.f.next(toCardInput(progress), now, grade);
    const next = {
      id: progress.id,
      ...serializeCard(item.card),
      firstReview: progress.firstReview || now.toISOString(),
      againCount: (progress.againCount || 0) + (grade === 1 ? 1 : 0),
    };
    return { progress: next, log: serializeLog(item.log) };
  }

  /** Abrufwahrscheinlichkeit 0..1 (nur für bewertete Karten). */
  retrievability(progress, now = new Date()) {
    if (this.isNew(progress)) return null;
    return this.f.get_retrievability(toCardInput(progress), now, false);
  }

  /** Zustandscode vor einer Bewertung für das Protokoll: 0 neu, 1 lernen, 2 wiederholen, 3 neu lernen. */
  stateCode(progress) {
    return this.isNew(progress) ? 0 : Number(progress.state) || 0;
  }
}

export function clampRetention(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0.9;
  return Math.min(0.95, Math.max(0.8, Math.round(n * 100) / 100));
}

/** Gilt die Karte als schwierig (Leech)? */
export function isDifficult(progress) {
  return !!progress && (progress.againCount || 0) >= LEECH_THRESHOLD;
}

/** FSRS-Card in ein JSON-taugliches Objekt umwandeln. */
export function serializeCard(card) {
  return {
    due: toIso(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? toIso(card.last_review) : undefined,
  };
}

export function serializeLog(log) {
  return {
    rating: log.rating,
    state: log.state,
    due: toIso(log.due),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps ?? 0,
    review: toIso(log.review),
  };
}

function toIso(d) {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Serialisierten Lernstand in die Eingabeform für ts-fsrs bringen. */
export function toCardInput(p) {
  return {
    due: new Date(p.due),
    stability: p.stability,
    difficulty: p.difficulty,
    elapsed_days: p.elapsed_days ?? 0,
    scheduled_days: p.scheduled_days ?? 0,
    learning_steps: p.learning_steps ?? 0,
    reps: p.reps ?? 0,
    lapses: p.lapses ?? 0,
    state: p.state ?? 0,
    last_review: p.last_review ? new Date(p.last_review) : undefined,
  };
}

function emptyDay(key) {
  return { id: key, newCount: 0, reviewCount: 0, newHearCount: 0, newVerbCount: 0, newBackCount: 0 };
}

/** Feldname der Tagesstatistik für neue Karten eines Typs. */
export function newCountField(type) {
  return type === 'hear' ? 'newHearCount' : type === 'verb' ? 'newVerbCount' : type === 'back' ? 'newBackCount' : 'newCount';
}

/** Schlüssel der Hörkarte zu einer Kennung. */
export function hearKeyOf(id) {
  return `${id}:H`;
}

/** Zufällig mischen (Fisher-Yates, in place). */
export function shuffle(arr, rand = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function typeSummary() {
  return { due: 0, new: 0, learned: 0, unseen: 0, suspended: 0, locked: 0 };
}

/**
 * Kennzahlen und Warteschlangen berechnen.
 * Jeder Lernmodus (Vokabeln, Rückwärts, Hören, Verben) hat eine eigene Warteschlange: fällige Karten des
 * Typs zufällig gemischt, danach neue Karten (Vokabeln/Rückwärts/Hören nach Rang, Verbformen nach
 * Häufigkeit). „queue“ enthält zusätzlich alle Typen hintereinander in TYPE_ORDER.
 * @param {Scheduler} sch
 * @param {Map<string, Card>} cards  alle Vokabelkarten nach Kennung
 * @param {Map<string, object>} progress Lernstand nach Kartenschlüssel
 * @param {Map<string, object>} cardmeta Notizen/Aussetzen nach Kartenschlüssel
 * @param {Map<string, object>} days Tagesstatistik
 * @param {{newPerDay:number, hearingMode?:boolean, newHearPerDay?:number, verbMode?:boolean, newVerbPerDay?:number}} settings
 * @param {Date} [now]
 * @param {{rand?: () => number, verbForms?: Map<string, object>}} [opts] Zufallsquelle (für Tests), Formkarten (Stufe 3)
 */
export function buildPlan(sch, cards, progress, cardmeta, days, settings, now = new Date(), opts = {}) {
  const today = dateKey(now);
  const todayStats = days.get(today) || emptyDay(today);
  const S = sch.State;
  // Hörkarten gibt es immer (sofern Beispielsätze vorhanden), Verbformen sobald verben.json geladen ist.
  const hearingOn = true;
  const verbForms = opts.verbForms instanceof Map ? opts.verbForms : new Map();
  const verbOn = verbForms.size > 0;
  const due = [];
  const unseenVocab = [];
  const unseenBack = [];
  const unseenHear = [];
  const unseenVerb = [];
  const types = { vocab: typeSummary(), back: typeSummary(), hear: typeSummary(), verb: typeSummary() };
  let difficultCount = 0;

  for (const card of cards.values()) {
    const p = progress.get(card.id);
    const m = cardmeta.get(card.id);
    const vocabSuspended = !!(m && m.suspended);
    if (isDifficult(p)) difficultCount++;
    const vocabNew = sch.isNew(p);
    if (vocabSuspended) {
      types.vocab.suspended++;
      if (!vocabNew) types.vocab.learned++;
    } else if (vocabNew) {
      types.vocab.unseen++;
      unseenVocab.push(card);
    } else {
      types.vocab.learned++;
      if (sch.isDue(p, now)) due.push({ key: card.id, type: 'vocab', card, dueAt: new Date(p.due).getTime() });
    }

    // Rückwärtskarte (Deutsch → Spanisch): freigeschaltet, sobald die Vokabelkarte im Zustand Review ist.
    const bk = backKeyOf(card.id);
    const bp = progress.get(bk);
    const bm = cardmeta.get(bk);
    const backNew = sch.isNew(bp);
    if (isDifficult(bp)) difficultCount++;
    if (vocabSuspended || (bm && bm.suspended)) {
      types.back.suspended++;
      if (!backNew) types.back.learned++;
    } else if (backNew) {
      if (p && !vocabNew && p.state === S.Review) {
        types.back.unseen++;
        unseenBack.push(card);
      } else {
        types.back.locked++;
      }
    } else {
      types.back.learned++;
      if (sch.isDue(bp, now)) due.push({ key: bk, type: 'back', card, dueAt: new Date(bp.due).getTime() });
    }

    // Hörkarte: nur mit Beispielsatz; freigeschaltet, sobald die Vokabelkarte im Zustand Review ist.
    if (!hearingOn || !card.exEs) continue;
    const hk = hearKeyOf(card.id);
    const hp = progress.get(hk);
    const hm = cardmeta.get(hk);
    const hearNew = sch.isNew(hp);
    if (isDifficult(hp)) difficultCount++;
    if (vocabSuspended || (hm && hm.suspended)) {
      types.hear.suspended++;
      if (!hearNew) types.hear.learned++;
      continue;
    }
    if (hearNew) {
      if (p && !vocabNew && p.state === S.Review) {
        types.hear.unseen++;
        unseenHear.push(card);
      } else {
        types.hear.locked++;
      }
    } else {
      types.hear.learned++;
      if (sch.isDue(hp, now)) due.push({ key: hk, type: 'hear', card, dueAt: new Date(hp.due).getTime() });
    }
  }

  // Verbformen (Stufe 3): freigeschaltet, sobald die Vokabelkarte des Verbs im Zustand Review ist.
  if (verbOn) {
    for (const f of verbForms.values()) {
      const vp = progress.get(f.verb.kennung);
      const vm = cardmeta.get(f.verb.kennung);
      const fp = progress.get(f.key);
      const fm = cardmeta.get(f.key);
      const fNew = sch.isNew(fp);
      if (isDifficult(fp)) difficultCount++;
      if ((vm && vm.suspended) || (fm && fm.suspended)) {
        types.verb.suspended++;
        if (!fNew) types.verb.learned++;
        continue;
      }
      if (fNew) {
        if (vp && !sch.isNew(vp) && vp.state === S.Review) {
          types.verb.unseen++;
          unseenVerb.push(f);
        } else {
          types.verb.locked++;
        }
      } else {
        types.verb.learned++;
        if (sch.isDue(fp, now)) due.push({ key: f.key, type: 'verb', card: cards.get(f.verb.kennung), form: f, dueAt: new Date(fp.due).getTime() });
      }
    }
  }

  shuffle(due, opts.rand || Math.random);
  const dueByType = { vocab: [], back: [], hear: [], verb: [] };
  for (const d of due) dueByType[d.type].push({ key: d.key, type: d.type, card: d.card, form: d.form });
  unseenVocab.sort(compareByRank);
  unseenBack.sort(compareByRank);
  unseenHear.sort(compareByRank);
  unseenVerb.sort(compareByFrequency);
  const newLimit = Math.max(0, (Number(settings.newPerDay) || 0) - (todayStats.newCount || 0));
  const newBackLimit = Math.max(0, (Number(settings.newBackPerDay) || 0) - (todayStats.newBackCount || 0));
  const newBack = unseenBack.slice(0, newBackLimit).map((card) => ({ key: backKeyOf(card.id), type: 'back', card }));
  const newHearLimit = hearingOn ? Math.max(0, (Number(settings.newHearPerDay) || 0) - (todayStats.newHearCount || 0)) : 0;
  const newVerbLimit = verbOn ? Math.max(0, (Number(settings.newVerbPerDay) || 0) - (todayStats.newVerbCount || 0)) : 0;
  const newVocab = unseenVocab.slice(0, newLimit).map((card) => ({ key: card.id, type: 'vocab', card }));
  const newHear = unseenHear.slice(0, newHearLimit).map((card) => ({ key: hearKeyOf(card.id), type: 'hear', card }));
  const newVerb = unseenVerb.slice(0, newVerbLimit).map((f) => ({ key: f.key, type: 'verb', card: cards.get(f.verb.kennung), form: f }));
  for (const d of due) types[d.type].due++;
  types.vocab.new = newVocab.length;
  types.back.new = newBack.length;
  types.hear.new = newHear.length;
  types.verb.new = newVerb.length;

  const sessions = {
    vocab: { due: dueByType.vocab.length, new: newVocab.length, entries: [...dueByType.vocab, ...newVocab] },
    back: { due: dueByType.back.length, new: newBack.length, entries: [...dueByType.back, ...newBack] },
    hear: { due: dueByType.hear.length, new: newHear.length, entries: [...dueByType.hear, ...newHear] },
    verb: { due: dueByType.verb.length, new: newVerb.length, entries: [...dueByType.verb, ...newVerb] },
  };
  for (const t of TYPE_ORDER) sessions[t].total = sessions[t].entries.length;
  const queue = TYPE_ORDER.flatMap((t) => sessions[t].entries);
  return {
    today,
    dueCount: due.length,
    newCount: newVocab.length + newBack.length + newHear.length + newVerb.length,
    newDoneToday: todayStats.newCount || 0,
    newHearDoneToday: todayStats.newHearCount || 0,
    newVerbDoneToday: todayStats.newVerbCount || 0,
    reviewsToday: todayStats.reviewCount || 0,
    unseenCount: types.vocab.unseen,
    learnedTotal: TYPE_ORDER.reduce((n, t) => n + types[t].learned, 0),
    suspendedCount: TYPE_ORDER.reduce((n, t) => n + types[t].suspended, 0),
    difficultCount,
    totalCards: cards.size,
    hearingOn,
    verbOn,
    streak: computeStreak(days, now),
    queue,
    sessions,
    types,
  };
}

/** Tage in Folge mit mindestens einer Bewertung (heute zählt mit, wenn vorhanden). */
export function computeStreak(days, now = new Date()) {
  let d = new Date(now);
  const has = (date) => {
    const s = days.get(dateKey(date));
    return !!(s && s.reviewCount > 0);
  };
  if (!has(d)) {
    d = addDays(d, -1);
    if (!has(d)) return 0;
  }
  let streak = 0;
  while (has(d)) {
    streak++;
    d = addDays(d, -1);
    if (streak > 36500) break;
  }
  return streak;
}

/**
 * Prognose: fällige Wiederholungskarten je Tag für die nächsten n Tage (Tag 0 = heute inkl. überfällig).
 */
export function forecastDue(sch, progress, cardmeta, now = new Date(), daysAhead = 7) {
  const out = Array.from({ length: daysAhead }, (_, i) => ({ offset: i, date: dateKey(addDays(now, i)), count: 0 }));
  const todayEnd = endOfDay(now).getTime();
  const dayMs = 86400000;
  for (const p of progress.values()) {
    if (sch.isNew(p)) continue;
    const m = cardmeta.get(p.id);
    if (m && m.suspended) continue;
    const due = new Date(p.due).getTime();
    if (due <= todayEnd) {
      out[0].count++;
      continue;
    }
    const idx = Math.ceil((due - todayEnd) / dayMs);
    if (idx >= 1 && idx < daysAhead) out[idx].count++;
  }
  return out;
}
