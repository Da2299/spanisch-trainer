// Spaced Repetition mit FSRS (ts-fsrs). Reine Funktionen über Kartenliste + Lernstand.
import { dateKey, endOfDay, addDays } from './util.js';
import { compareByRank } from './parser.js';

export const LEARN_AHEAD_MS = 20 * 60 * 1000; // Lernkarten bis 20 Min. im Voraus zeigen
export const RATINGS = [
  { grade: 1, key: 'again', label: 'Nochmal' },
  { grade: 2, key: 'hard', label: 'Schwer' },
  { grade: 3, key: 'good', label: 'Gut' },
  { grade: 4, key: 'easy', label: 'Einfach' },
];

export class Scheduler {
  /** @param {object} lib Das ts-fsrs-Modul */
  constructor(lib) {
    this.lib = lib;
    this.State = lib.State;
    this.Rating = lib.Rating;
    this.params = lib.generatorParameters({ request_retention: 0.9 });
    this.f = lib.fsrs(this.params);
  }

  /** Neuen (leeren) FSRS-Datensatz für eine Kennung erzeugen. */
  emptyProgress(id, now = new Date()) {
    return { id, ...serializeCard(this.lib.createEmptyCard(now)) };
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

  /** Bewertung anwenden; liefert den neuen (serialisierten) Lernstand. */
  rate(progress, grade, now = new Date()) {
    const item = this.f.next(toCardInput(progress), now, grade);
    return { id: progress.id, ...serializeCard(item.card), firstReview: progress.firstReview || now.toISOString() };
  }

  /** Abrufwahrscheinlichkeit 0..1 (nur für bewertete Karten). */
  retrievability(progress, now = new Date()) {
    if (this.isNew(progress)) return null;
    return this.f.get_retrievability(toCardInput(progress), now, false);
  }
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

/**
 * Kennzahlen und Warteschlange berechnen.
 * @param {Scheduler} sch
 * @param {Map<string, Card>} cards  alle Karten nach Kennung
 * @param {Map<string, object>} progress Lernstand nach Kennung
 * @param {Map<string, {id:string,newCount:number,reviewCount:number}>} days Tagesstatistik
 * @param {{newPerDay:number}} settings
 */
export function buildPlan(sch, cards, progress, days, settings, now = new Date()) {
  const today = dateKey(now);
  const todayStats = days.get(today) || { id: today, newCount: 0, reviewCount: 0 };
  const due = [];
  const unseen = [];
  let learnedTotal = 0;
  for (const card of cards.values()) {
    const p = progress.get(card.id);
    if (sch.isNew(p)) {
      unseen.push(card);
    } else {
      learnedTotal++;
      if (sch.isDue(p, now)) due.push({ card, dueAt: new Date(p.due).getTime() });
    }
  }
  due.sort((a, b) => a.dueAt - b.dueAt);
  unseen.sort(compareByRank);
  const newLimit = Math.max(0, (Number(settings.newPerDay) || 0) - todayStats.newCount);
  const newCards = unseen.slice(0, newLimit);
  return {
    today,
    dueCount: due.length,
    newCount: newCards.length,
    newDoneToday: todayStats.newCount,
    reviewsToday: todayStats.reviewCount,
    unseenCount: unseen.length,
    learnedTotal,
    totalCards: cards.size,
    streak: computeStreak(days, now),
    queue: [...due.map((d) => d.card), ...newCards],
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
