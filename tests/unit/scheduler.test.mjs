import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../../lib/ts-fsrs.js';
import { Scheduler, buildPlan, computeStreak, serializeCard, parseFsrsParams, isDifficult, forecastDue, cardTypeOf, baseIdOf, hearKeyOf, shuffle } from '../../js/scheduler.js';
import { formatInterval, dateKey, splitMeaning, toCsv } from '../../js/util.js';
import { mergeSources } from '../../js/data.js';
import { parsePackage } from '../../js/parser.js';

const sch = new Scheduler(lib);
const NOW = new Date('2026-10-17T10:00:00');

function mkCards(n) {
  const m = new Map();
  for (let i = 1; i <= n; i++) {
    const id = `ES-${String(i).padStart(4, '0')}`;
    m.set(id, { id, rank: i, es: `w${i}`, de: `d${i}`, pos: '', exEs: '', exDe: '', tags: '', position: i });
  }
  return m;
}

test('FSRS-Parameter: Zielretention 0,9, Standard-Gewichte', () => {
  assert.equal(sch.params.request_retention, 0.9);
  assert.equal(sch.params.w.length, lib.default_w.length);
});

test('Vorschau liefert vier Intervalle, Nochmal < Schwer < Gut < Einfach', () => {
  const p = sch.emptyProgress('ES-0001', NOW);
  const pv = sch.preview(p, NOW);
  const iv = [1, 2, 3, 4].map((g) => pv[g].intervalMs);
  assert.ok(iv[0] < iv[1] && iv[1] < iv[2] && iv[2] < iv[3], iv.join(','));
  assert.equal(formatInterval(iv[0]), '1 Min');
  assert.equal(formatInterval(iv[3]), '8 T');
});

test('Bewerten plant neu; Lernstand ist JSON-serialisierbar und erneut bewertbar', () => {
  const p0 = sch.emptyProgress('ES-0001', NOW);
  assert.ok(sch.isNew(p0));
  const { progress: p1, log } = sch.rate(p0, 3, NOW);
  assert.equal(log.rating, 3);
  assert.equal(log.state, lib.State.New);
  assert.equal(p1.reps, 1);
  assert.equal(p1.againCount, 0);
  assert.equal(p1.state, lib.State.Learning);
  assert.equal(typeof p1.due, 'string');
  assert.equal(p1.firstReview, NOW.toISOString());
  const roundTrip = JSON.parse(JSON.stringify(p1));
  const later = new Date(NOW.getTime() + 15 * 60000);
  const { progress: p2 } = sch.rate(roundTrip, 3, later);
  assert.equal(p2.state, lib.State.Review);
  assert.ok(new Date(p2.due) > later);
  assert.equal(p2.firstReview, p1.firstReview);
});

test('Fälligkeit: Review tagesgenau, Lernen minutengenau mit Vorlauf', () => {
  const review = { ...serializeCard(lib.createEmptyCard(NOW)), id: 'x', state: lib.State.Review, reps: 3, due: new Date('2026-10-17T22:00:00').toISOString() };
  assert.ok(sch.isDue(review, NOW), 'Review heute Abend fällig zählt heute');
  const tomorrow = { ...review, due: new Date('2026-10-18T00:30:00').toISOString() };
  assert.ok(!sch.isDue(tomorrow, NOW));
  const learning = { ...review, state: lib.State.Learning, due: new Date(NOW.getTime() + 10 * 60000).toISOString() };
  assert.ok(sch.isDue(learning, NOW), 'Lernkarte in 10 Min: Vorlauf');
  const learningLater = { ...learning, due: new Date(NOW.getTime() + 60 * 60000).toISOString() };
  assert.ok(!sch.isDue(learningLater, NOW));
});

test('buildPlan: Fällige zuerst (gemischt), dann neue in Rangreihenfolge mit Tageslimit', () => {
  const cards = mkCards(50);
  const progress = new Map();
  const dueA = sch.rate(sch.emptyProgress('ES-0040', new Date('2026-10-01T10:00:00')), 4, new Date('2026-10-01T10:00:00')).progress;
  const dueB = sch.rate(sch.emptyProgress('ES-0030', new Date('2026-10-02T10:00:00')), 4, new Date('2026-10-02T10:00:00')).progress;
  const notDue = sch.rate(sch.emptyProgress('ES-0020', NOW), 4, NOW).progress; // in 8 Tagen
  progress.set(dueA.id, dueA);
  progress.set(dueB.id, dueB);
  progress.set(notDue.id, notDue);
  const days = new Map([[dateKey(NOW), { id: dateKey(NOW), newCount: 5, reviewCount: 7 }]]);
  const plan = buildPlan(sch, cards, progress, new Map(), days, { newPerDay: 20 }, NOW);
  assert.equal(plan.dueCount, 2);
  assert.equal(plan.newCount, 15);
  assert.equal(plan.learnedTotal, 3);
  assert.equal(plan.unseenCount, 47);
  assert.equal(plan.totalCards, 50);
  assert.deepEqual(plan.queue.slice(0, 2).map((c) => c.key).sort(), ['ES-0030', 'ES-0040']);
  assert.deepEqual(plan.queue.slice(2, 5).map((c) => c.key), ['ES-0001', 'ES-0002', 'ES-0003']);
  assert.equal(plan.queue.length, 17);
  assert.ok(!plan.queue.some((c) => c.key === 'ES-0020'));
  assert.ok(plan.queue.every((c) => c.type === 'vocab' && c.card));
});

test('Tage in Folge', () => {
  const d = (o) => dateKey(new Date(NOW.getTime() + o * 86400000));
  const mk = (...offsets) => new Map(offsets.map((o) => [d(o), { id: d(o), newCount: 0, reviewCount: 1 }]));
  assert.equal(computeStreak(new Map(), NOW), 0);
  assert.equal(computeStreak(mk(0), NOW), 1);
  assert.equal(computeStreak(mk(-1, -2, -3), NOW), 3, 'heute noch nichts gelernt: Serie bis gestern zählt');
  assert.equal(computeStreak(mk(0, -1, -3), NOW), 2);
  assert.equal(computeStreak(mk(-2, -3), NOW), 0);
});

test('mergeSources: gleiche Kennung wird von späterer Quelle aktualisiert', () => {
  const a = parsePackage('ES-1\t1\tuno\teins\nES-2\t2\tdos\tzwei\n', 'a.txt');
  const b = parsePackage('ES-2\t2\tdos\tZWEI (neu)\nES-3\t3\ttres\tdrei\n', 'b.txt');
  const cards = mergeSources([{ cards: a.cards }, { cards: b.cards }]);
  assert.equal(cards.size, 3);
  assert.equal(cards.get('ES-2').de, 'ZWEI (neu)');
  assert.equal(cards.get('ES-2').source, 'b.txt');
  assert.equal(cards.get('ES-1').source, 'a.txt');
});

test('formatInterval', () => {
  assert.equal(formatInterval(30 * 1000), '<1 Min');
  assert.equal(formatInterval(10 * 60000), '10 Min');
  assert.equal(formatInterval(3 * 3600000), '3 Std');
  assert.equal(formatInterval(5 * 86400000), '5 T');
  assert.equal(formatInterval(45 * 86400000), '1,5 Mo');
  assert.equal(formatInterval(400 * 86400000), '1,1 J');
});

test('Zielretention: höhere Retention = kürzere Intervalle; configure() wirkt sofort', () => {
  const s = new Scheduler(lib, { requestRetention: 0.8 });
  const easy80 = s.preview(s.emptyProgress('x', NOW), NOW)[4].card.scheduled_days;
  s.configure({ requestRetention: 0.95 });
  const easy95 = s.preview(s.emptyProgress('x', NOW), NOW)[4].card.scheduled_days;
  assert.ok(easy80 > easy95, `${easy80} > ${easy95}`);
  assert.equal(s.requestRetention, 0.95);
  s.configure({ requestRetention: 1.5 });
  assert.equal(s.requestRetention, 0.95, 'wird auf 0,80–0,95 begrenzt');
});

test('parseFsrsParams: leer = Standard, 19 Werte ok, falsche Anzahl/ungültig = Fehler', () => {
  assert.deepEqual(parseFsrsParams(''), { w: null, error: null });
  const w19 = Array.from({ length: 19 }, (_, i) => (i + 1) / 10);
  const r = parseFsrsParams(w19.join(', '));
  assert.equal(r.error, null);
  assert.equal(r.w.length, 19);
  assert.ok(parseFsrsParams('1,2,3').error);
  assert.ok(parseFsrsParams(w19.map(() => 'x').join(',')).error);
  const s = new Scheduler(lib, { w: w19 });
  assert.equal(s.customW.length, 19);
  assert.equal(s.params.w.length, 21, 'ts-fsrs füllt auf 21 auf');
});

test('Leech: ab 8× Nochmal gilt die Karte als schwierig; Aussetzen nimmt sie aus der Planung', () => {
  let p = sch.emptyProgress('ES-0001', NOW);
  let t = NOW;
  for (let i = 0; i < 8; i++) {
    t = new Date(t.getTime() + 60000);
    p = sch.rate(p, 1, t).progress;
  }
  assert.equal(p.againCount, 8);
  assert.ok(isDifficult(p));
  const cards = mkCards(3);
  const progress = new Map([[p.id, p]]);
  const cardmeta = new Map([['ES-0002', { id: 'ES-0002', suspended: true }]]);
  const plan = buildPlan(sch, cards, progress, cardmeta, new Map(), { newPerDay: 20 }, new Date(t.getTime() + 60000));
  assert.equal(plan.difficultCount, 1);
  assert.equal(plan.suspendedCount, 1);
  assert.deepEqual(plan.queue.map((e) => e.key), ['ES-0001', 'ES-0003']);
});

test('Prognose: fällige Review-Karten je Tag', () => {
  const progress = new Map();
  const mk = (id, dueIso) => ({ ...serializeCard(lib.createEmptyCard(NOW)), id, state: lib.State.Review, reps: 2, due: new Date(dueIso).toISOString() });
  progress.set('a', mk('a', '2026-10-10T10:00:00')); // überfällig → heute
  progress.set('b', mk('b', '2026-10-17T23:00:00')); // heute
  progress.set('c', mk('c', '2026-10-18T09:00:00')); // morgen
  progress.set('d', mk('d', '2026-10-23T09:00:00')); // +6
  progress.set('e', mk('e', '2026-10-30T09:00:00')); // außerhalb
  const f = forecastDue(sch, progress, new Map([['d', { id: 'd', suspended: true }]]), NOW, 7);
  assert.deepEqual(f.map((x) => x.count), [2, 1, 0, 0, 0, 0, 0]);
});

test('Kartentypen aus Schlüsseln', () => {
  assert.equal(cardTypeOf('ES-0001'), 'vocab');
  assert.equal(cardTypeOf('ES-0001:H'), 'hear');
  assert.equal(cardTypeOf('V:tener:tengo:Präsens'), 'verb');
  assert.equal(baseIdOf('ES-0001:H'), 'ES-0001');
});

test('splitMeaning: erstes Semikolon außerhalb von Klammern', () => {
  assert.deepEqual(splitMeaning('von; aus; (Genitiv:) des/der'), { main: 'von', rest: 'aus; (Genitiv:) des/der' });
  assert.deepEqual(splitMeaning('der, die, das (bestimmter Artikel; Pl. los, las)'), { main: 'der, die, das (bestimmter Artikel; Pl. los, las)', rest: '' });
  assert.deepEqual(splitMeaning('mit'), { main: 'mit', rest: '' });
});

test('CSV-Maskierung', () => {
  assert.equal(toCsv([['card_id', 'review_time'], ['ES-0001', 1], ['a,b', 'x"y']]), 'card_id,review_time\r\nES-0001,1\r\n"a,b","x""y"\r\n');
});

function mkCardsWithExamples(n) {
  const m = mkCards(n);
  for (const c of m.values()) c.exEs = `Frase con ${c.es}.`;
  return m;
}

test('Hörmodus: Hörkarte erst freigeschaltet, wenn die Vokabelkarte im Zustand Review ist', () => {
  const cards = mkCardsWithExamples(5);
  const progress = new Map();
  const review = sch.rate(sch.emptyProgress('ES-0001', NOW), 4, NOW).progress; // Review
  const learning = sch.rate(sch.emptyProgress('ES-0002', NOW), 3, NOW).progress; // Learning
  progress.set(review.id, review);
  progress.set(learning.id, learning);
  const later = new Date(NOW.getTime() + 60 * 60000);
  const on = buildPlan(sch, cards, progress, new Map(), new Map(), { newPerDay: 0, newHearPerDay: 10 }, later);
  assert.equal(on.sessions.vocab.total, 1, 'Vokabelsitzung: nur die fällige Lernkarte');
  assert.equal(on.sessions.hear.total, 1, 'Hörsitzung: eine neue Hörkarte');
  assert.equal(on.types.hear.new, 1);
  assert.equal(on.types.hear.locked, 4, 'übrige Hörkarten gesperrt (Vokabel nicht in Review)');
  assert.deepEqual(on.queue.map((e) => [e.key, e.type]), [['ES-0002', 'vocab'], ['ES-0001:H', 'hear']]);
  assert.equal(on.queue[1].card.id, 'ES-0001');
});

test('Hörmodus: eigene Warteschlange je Modus (fällig gemischt, dann neu); Tageslimits getrennt', () => {
  const cards = mkCardsWithExamples(10);
  const progress = new Map();
  const t0 = new Date('2026-10-01T10:00:00');
  for (const id of ['ES-0001', 'ES-0002', 'ES-0003']) {
    const p = sch.rate(sch.emptyProgress(id, t0), 4, t0).progress; // Review, fällig am 9.10.
    progress.set(id, p);
  }
  const hp = sch.rate(sch.emptyProgress(hearKeyOf('ES-0001'), t0), 4, t0).progress; // Hörkarte, fällig
  progress.set(hp.id, hp);
  const days = new Map([[dateKey(NOW), { id: dateKey(NOW), newCount: 0, reviewCount: 0, newHearCount: 9 }]]);
  const plan = buildPlan(sch, cards, progress, new Map(), days, { newPerDay: 2, newHearPerDay: 10 }, NOW, { rand: () => 0 });
  assert.equal(plan.types.vocab.due, 3);
  assert.equal(plan.types.hear.due, 1);
  const vocabKeys = plan.sessions.vocab.entries.map((e) => e.key);
  assert.deepEqual(vocabKeys.slice(0, 3).sort(), ['ES-0001', 'ES-0002', 'ES-0003'], 'fällige Vokabeln (gemischt)');
  assert.deepEqual(vocabKeys.slice(3), ['ES-0004', 'ES-0005'], 'neue Vokabeln nach Rang (Limit 2)');
  assert.deepEqual(plan.sessions.hear.entries.map((e) => e.key), ['ES-0001:H', 'ES-0002:H'], 'fällige Hörkarte, dann eine neue (Limit 10−9)');
  assert.equal(plan.types.hear.new, 1);
  assert.equal(plan.newCount, 3);
  assert.deepEqual(plan.queue.map((e) => e.key), [...vocabKeys, 'ES-0001:H', 'ES-0002:H'], 'Gesamtliste: Vokabeln, dann Hören');
});

test('Hörkarte ohne Beispielsatz und bei ausgesetzter Vokabel nicht eingeplant', () => {
  const cards = mkCardsWithExamples(3);
  cards.get('ES-0003').exEs = '';
  const progress = new Map();
  for (const id of ['ES-0001', 'ES-0002', 'ES-0003']) progress.set(id, sch.rate(sch.emptyProgress(id, NOW), 4, NOW).progress);
  const cardmeta = new Map([['ES-0002', { id: 'ES-0002', suspended: true }]]);
  const plan = buildPlan(sch, cards, progress, cardmeta, new Map(), { newPerDay: 0, newHearPerDay: 10 }, new Date(NOW.getTime() + 60000));
  assert.deepEqual(plan.queue.map((e) => e.key), ['ES-0001:H']);
  assert.equal(plan.types.hear.suspended, 1);
});

test('shuffle: Permutation, deterministisch bei fester Zufallsquelle', () => {
  const a = shuffle([1, 2, 3, 4, 5], () => 0);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});
