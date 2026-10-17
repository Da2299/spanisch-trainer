import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from '../../lib/ts-fsrs.js';
import { Scheduler, buildPlan, computeStreak, serializeCard } from '../../js/scheduler.js';
import { formatInterval, dateKey } from '../../js/util.js';
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
  const p1 = sch.rate(p0, 3, NOW);
  assert.equal(p1.reps, 1);
  assert.equal(p1.state, lib.State.Learning);
  assert.equal(typeof p1.due, 'string');
  assert.equal(p1.firstReview, NOW.toISOString());
  const roundTrip = JSON.parse(JSON.stringify(p1));
  const later = new Date(NOW.getTime() + 15 * 60000);
  const p2 = sch.rate(roundTrip, 3, later);
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

test('buildPlan: Fällige zuerst (nach Fälligkeit), dann neue in Rangreihenfolge mit Tageslimit', () => {
  const cards = mkCards(50);
  const progress = new Map();
  const dueA = sch.rate(sch.emptyProgress('ES-0040', new Date('2026-10-01T10:00:00')), 4, new Date('2026-10-01T10:00:00'));
  const dueB = sch.rate(sch.emptyProgress('ES-0030', new Date('2026-10-02T10:00:00')), 4, new Date('2026-10-02T10:00:00'));
  const notDue = sch.rate(sch.emptyProgress('ES-0020', NOW), 4, NOW); // in 8 Tagen
  progress.set(dueA.id, dueA);
  progress.set(dueB.id, dueB);
  progress.set(notDue.id, notDue);
  const days = new Map([[dateKey(NOW), { id: dateKey(NOW), newCount: 5, reviewCount: 7 }]]);
  const plan = buildPlan(sch, cards, progress, days, { newPerDay: 20 }, NOW);
  assert.equal(plan.dueCount, 2);
  assert.equal(plan.newCount, 15);
  assert.equal(plan.learnedTotal, 3);
  assert.equal(plan.unseenCount, 47);
  assert.equal(plan.totalCards, 50);
  assert.deepEqual(plan.queue.slice(0, 2).map((c) => c.id), ['ES-0040', 'ES-0030']);
  assert.deepEqual(plan.queue.slice(2, 5).map((c) => c.id), ['ES-0001', 'ES-0002', 'ES-0003']);
  assert.equal(plan.queue.length, 17);
  assert.ok(!plan.queue.some((c) => c.id === 'ES-0020'));
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
