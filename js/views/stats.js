// Statistik: Wiederholungen pro Tag (30 Tage), Trefferquote, Karten je Zustand, Prognose, Serie.
import { state, plan } from '../app.js';
import { forecastDue } from '../scheduler.js';
import { el, dateKey, addDays } from '../util.js';

const DAYS = 30;

/** Kennzahlen aus Protokoll, Lernstand und Markierungen berechnen (reine Funktion, testbar). */
export function computeStats(sch, cards, progress, cardmeta, reviews, days, now = new Date()) {
  const start = addDays(now, -(DAYS - 1));
  start.setHours(0, 0, 0, 0);
  const perDay = [];
  const index = new Map();
  for (let i = 0; i < DAYS; i++) {
    const d = addDays(start, i);
    const key = dateKey(d);
    index.set(key, i);
    perDay.push({ date: key, count: 0, correct: 0 });
  }
  let total = 0;
  let correct = 0;
  for (const r of reviews) {
    const key = dateKey(new Date(r.time));
    const i = index.get(key);
    if (i === undefined) continue;
    perDay[i].count++;
    total++;
    if (r.rating >= 2) {
      perDay[i].correct++;
      correct++;
    }
  }
  const S = sch.State;
  const byState = { new: 0, learning: 0, review: 0, suspended: 0 };
  for (const card of cards.values()) {
    const m = cardmeta.get(card.id);
    if (m && m.suspended) {
      byState.suspended++;
      continue;
    }
    const p = progress.get(card.id);
    if (sch.isNew(p)) byState.new++;
    else if (p.state === S.Review) byState.review++;
    else byState.learning++;
  }
  return {
    perDay,
    total,
    correct,
    accuracy: total ? correct / total : null,
    byState,
    forecast: forecastDue(sch, progress, cardmeta, now, 7),
  };
}

export function renderStats(main) {
  const p = plan();
  const s = computeStats(state.sch, state.cards, state.progress, state.cardmeta, state.reviews, state.days);
  main.append(el('h1', { class: 'title', text: 'Statistik' }));

  // Kennzahlen
  main.append(
    el('section', { class: 'stats' }, [
      el('div', { class: 'stat', 'data-stat': 'streak' }, [el('div', { class: 'stat-value', text: String(p.streak) }), el('div', { class: 'stat-label', text: 'Tage in Folge' })]),
      el('div', { class: 'stat', 'data-stat': 'accuracy' }, [
        el('div', { class: 'stat-value', text: s.accuracy === null ? '–' : `${Math.round(s.accuracy * 100)} %` }),
        el('div', { class: 'stat-label', text: `richtig (${s.correct} von ${s.total}, 30 Tage)` }),
      ]),
    ]),
  );

  // Balkendiagramm Wiederholungen pro Tag
  const max = Math.max(1, ...s.perDay.map((d) => d.count));
  const bars = el(
    'div',
    { class: 'bars', id: 'bars', role: 'img', 'aria-label': `Wiederholungen pro Tag, letzte ${DAYS} Tage` },
    s.perDay.map((d, i) =>
      el('div', { class: 'bar-col', title: `${d.date}: ${d.count}` }, [
        el('div', { class: 'bar', style: `height:${Math.round((d.count / max) * 100)}%`, 'data-count': String(d.count) }),
        el('div', { class: 'bar-label', text: (DAYS - 1 - i) % 7 === 0 ? d.date.slice(8) + '.' : '' }),
      ]),
    ),
  );
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: `Wiederholungen pro Tag (letzte ${DAYS} Tage)` }),
      el('p', { class: 'muted small-text', text: `${s.total} Bewertungen insgesamt, höchster Tag: ${max === 1 && s.total === 0 ? 0 : max}` }),
      bars,
    ]),
  );

  // Karten je Zustand
  const st = s.byState;
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Karten je Zustand' }),
      el('dl', { class: 'kv', id: 'by-state' }, [
        el('dt', { text: 'Neu' }),
        el('dd', { 'data-state': 'new', text: String(st.new) }),
        el('dt', { text: 'Lernen' }),
        el('dd', { 'data-state': 'learning', text: String(st.learning) }),
        el('dt', { text: 'Wiederholen' }),
        el('dd', { 'data-state': 'review', text: String(st.review) }),
        el('dt', { text: 'Ausgesetzt' }),
        el('dd', { 'data-state': 'suspended', text: String(st.suspended) }),
        el('dt', { text: 'Schwierig' }),
        el('dd', { 'data-state': 'difficult', text: String(p.difficultCount) }),
      ]),
    ]),
  );

  // Prognose
  const labels = ['Heute', 'Morgen'];
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Fällig in den nächsten 7 Tagen' }),
      el('dl', { class: 'kv', id: 'forecast' }, s.forecast.flatMap((f) => [el('dt', { text: labels[f.offset] || `+${f.offset} Tage (${f.date.slice(8)}.${f.date.slice(5, 7)}.)` }), el('dd', { text: String(f.count) })])),
      el('p', { class: 'muted small-text', text: 'Heute enthält überfällige Karten und heute fällige Lernschritte. Neue Karten sind nicht enthalten.' }),
    ]),
  );
}
