// Statistik: Wiederholungen pro Tag (30 Tage), Trefferquote, Karten je Zustand, Prognose, Serie.
import { state, plan } from '../app.js';
import { forecastDue, cardTypeOf, hearKeyOf, CARD_TYPES } from '../scheduler.js';
import { el, dateKey, addDays } from '../util.js';

const DAYS = 30;

/** Kennzahlen aus Protokoll, Lernstand und Markierungen berechnen (reine Funktion, testbar). */
export function computeStats(sch, cards, progress, cardmeta, reviews, days, now = new Date(), verbForms = new Map()) {
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
  const byType = { vocab: { total: 0, correct: 0 }, hear: { total: 0, correct: 0 }, verb: { total: 0, correct: 0 } };
  for (const r of reviews) {
    const key = dateKey(new Date(r.time));
    const i = index.get(key);
    if (i === undefined) continue;
    const t = byType[r.cardType || cardTypeOf(r.cardId)] || byType.vocab;
    perDay[i].count++;
    total++;
    t.total++;
    if (r.rating >= 2) {
      perDay[i].correct++;
      correct++;
      t.correct++;
    }
  }
  const S = sch.State;
  const emptyState = () => ({ new: 0, learning: 0, review: 0, suspended: 0, locked: 0 });
  const byState = emptyState(); // Vokabelkarten (abwärtskompatibel)
  const byStateType = { vocab: byState, hear: emptyState(), verb: emptyState() };
  for (const f of verbForms.values()) {
    const vp = progress.get(f.verb.kennung);
    const fp = progress.get(f.key);
    const v = byStateType.verb;
    if (cardmeta.get(f.verb.kennung)?.suspended || cardmeta.get(f.key)?.suspended) v.suspended++;
    else if (sch.isNew(fp)) {
      if (vp && !sch.isNew(vp) && vp.state === S.Review) v.new++;
      else v.locked++;
    } else if (fp.state === S.Review) v.review++;
    else v.learning++;
  }
  for (const card of cards.values()) {
    const m = cardmeta.get(card.id);
    const p = progress.get(card.id);
    if (m && m.suspended) byState.suspended++;
    else if (sch.isNew(p)) byState.new++;
    else if (p.state === S.Review) byState.review++;
    else byState.learning++;
    if (!card.exEs) continue;
    const hk = hearKeyOf(card.id);
    const hp = progress.get(hk);
    const hm = cardmeta.get(hk);
    const h = byStateType.hear;
    if ((m && m.suspended) || (hm && hm.suspended)) h.suspended++;
    else if (sch.isNew(hp)) {
      if (p && !sch.isNew(p) && p.state === S.Review) h.new++;
      else h.locked++;
    } else if (hp.state === S.Review) h.review++;
    else h.learning++;
  }
  return {
    perDay,
    total,
    correct,
    accuracy: total ? correct / total : null,
    byType,
    byState,
    byStateType,
    forecast: forecastDue(sch, progress, cardmeta, now, 7),
  };
}

export function renderStats(main) {
  const p = plan();
  const s = computeStats(state.sch, state.cards, state.progress, state.cardmeta, state.reviews, state.days, new Date(), p.verbOn ? state.verbForms : new Map());
  main.append(el('h1', { class: 'title', text: 'Statistik' }));

  // Kennzahlen heute
  const tiles = [
    ['Fällig heute', p.dueCount, 'due'],
    ['Neu heute', p.newCount, 'new'],
    ['Gelernt gesamt', p.learnedTotal, 'learned'],
    ['Tage in Folge', p.streak, 'streak'],
  ];
  main.append(
    el(
      'section',
      { class: 'stats', 'aria-label': 'Heute' },
      tiles.map(([label, value, key]) => el('div', { class: 'stat', 'data-stat': key }, [el('div', { class: 'stat-value', text: String(value) }), el('div', { class: 'stat-label', text: label })])),
    ),
    el('section', { class: 'stats' }, [
      el('div', { class: 'stat', 'data-stat': 'accuracy' }, [
        el('div', { class: 'stat-value', text: s.accuracy === null ? '–' : `${Math.round(s.accuracy * 100)} %` }),
        el('div', { class: 'stat-label', text: `gewusst (${s.correct} von ${s.total}, 30 Tage)` }),
      ]),
      el('div', { class: 'stat', 'data-stat': 'today' }, [el('div', { class: 'stat-value', text: String(p.reviewsToday) }), el('div', { class: 'stat-label', text: 'Bewertungen heute' })]),
    ]),
  );

  // Zahlen je Lernmodus
  const modeKeys = ['vocab', ...(p.types.hear.learned || p.types.hear.unseen || p.types.hear.locked ? ['hear'] : []), ...(p.verbOn ? ['verb'] : [])];
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Je Lernmodus' }),
      el('table', { class: 'type-table', id: 'type-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'Fällig' }), el('th', { text: 'Neu' }), el('th', { text: 'Gelernt' })])]),
        el(
          'tbody',
          {},
          modeKeys.map((t) =>
            el('tr', { 'data-type': t }, [
              el('th', { text: CARD_TYPES[t].session }),
              el('td', { 'data-col': 'due', text: String(p.types[t].due) }),
              el('td', { 'data-col': 'new', text: String(p.types[t].new) }),
              el('td', { 'data-col': 'learned', text: String(p.types[t].learned) }),
            ]),
          ),
        ),
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

  // Karten je Zustand (je Kartentyp)
  const st = s.byState;
  const typeKeys = modeKeys;
  const rowsDef = [
    ['Neu', 'new'],
    ['Lernen', 'learning'],
    ['Wiederholen', 'review'],
    ['Ausgesetzt', 'suspended'],
    ['Gesperrt', 'locked'],
  ];
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Karten je Zustand' }),
      el('table', { class: 'type-table', id: 'by-state-table' }, [
        el('thead', {}, [el('tr', {}, [el('th', { text: '' }), ...typeKeys.map((t) => el('th', { text: CARD_TYPES[t].labelPlural }))])]),
        el(
          'tbody',
          {},
          rowsDef
            .filter(([, key]) => key !== 'locked' || typeKeys.length > 1)
            .map(([label, key]) => el('tr', {}, [el('th', { text: label }), ...typeKeys.map((t) => el('td', { 'data-type': t, 'data-state': key, text: String(s.byStateType[t][key]) }))])),
        ),
      ]),
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
      el('p', { class: 'muted small-text', text: `Bewertungen der letzten 30 Tage je Typ: ${typeKeys.map((t) => `${CARD_TYPES[t].labelPlural} ${s.byType[t].total}${s.byType[t].total ? ` (${Math.round((s.byType[t].correct / s.byType[t].total) * 100)} % richtig)` : ''}`).join(' · ')}` }),
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
