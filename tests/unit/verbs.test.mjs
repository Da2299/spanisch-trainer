import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as lib from '../../lib/ts-fsrs.js';
import { verbKey, normalizeVerbs, buildVerbForms, makeGap, compareAnswer, compareByFrequency, groupByTempus, groupByPattern } from '../../js/verbs.js';
import { Scheduler, buildPlan } from '../../js/scheduler.js';
import { dateKey } from '../../js/util.js';

const NOW = new Date('2026-10-17T10:00:00');
const sch = new Scheduler(lib);
const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/verben.json', import.meta.url)), 'utf8'));
const verbs = normalizeVerbs(raw);
const cards = new Map([
  ['ES-0011', { id: 'ES-0011', rank: 11, es: 'tener', de: 'haben', exEs: '¿Tienes tiempo mañana?', exDe: 'Hast du morgen Zeit?', position: 0 }],
  ['ES-0016', { id: 'ES-0016', rank: 16, es: 'ir', de: 'gehen', exEs: 'Vamos al cine.', exDe: 'Wir gehen ins Kino.', position: 1 }],
]);
const forms = buildVerbForms(verbs, cards);

test('Beispieldatei: 3 Verben, 17 Formkarten mit Schlüssel V:lemma:form:tempus', () => {
  assert.equal(verbs.length, 3);
  assert.equal(forms.size, 17);
  assert.equal(verbKey('tener', 'tengo', 'Präsens'), 'V:tener:tengo:Präsens');
  const f = forms.get('V:tener:tengo:Präsens');
  assert.equal(f.verb.kennung, 'ES-0011');
  assert.equal(f.haeufigkeit, 954371);
  assert.equal(f.unregelmaessig, true);
  assert.equal(f.sentence, null, 'tengo hat keinen Satz in „saetze“');
});

test('Lückentext: erstes Vorkommen, Wortgrenzen, Groß-/Kleinschreibung ignorieren', () => {
  const f = forms.get('V:tener:tienes:Präsens');
  assert.equal(f.sentence.gap, '¿____ (tener) tiempo mañana?');
  assert.deepEqual(f.sentence.segments.map((s) => [s.text, s.mark]), [['¿', false], ['Tienes', true], [' tiempo mañana?', false]]);
  assert.equal(makeGap('Ella tiene tiempo y tienes razón.', 'tiene', 'tener').text, 'Ella ____ (tener) tiempo y tienes razón.');
  assert.equal(makeGap('Nosotros tenemos tiempo.', 'tiene', 'tener'), null, 'kein Treffer innerhalb eines Wortes');
  assert.equal(makeGap('TIENES razón.', 'tienes', 'tener').text, '____ (tener) razón.');
});

test('Eingabevergleich: Akzente zählen, Groß-/Kleinschreibung und Leerraum nicht', () => {
  assert.equal(compareAnswer('tengo', 'tengo').correct, true);
  assert.equal(compareAnswer('  Tengo ', 'tengo').correct, true);
  assert.equal(compareAnswer('tenia', 'tenía').correct, false);
  const r = compareAnswer('tenga', 'tengo');
  assert.equal(r.correct, false);
  assert.deepEqual(r.expected.map((c) => c.diff), [false, false, false, false, true]);
  assert.deepEqual(r.given.map((c) => c.ch).join(''), 'tenga');
});

test('Reihenfolge neuer Formkarten: Häufigkeit absteigend über alle Verben', () => {
  const sorted = [...forms.values()].sort(compareByFrequency).map((f) => f.form);
  assert.deepEqual(sorted.slice(0, 5), ['vamos', 'tengo', 'tiene', 'tienes', 'voy']);
});

test('Tabellenansicht: Gruppierung nach Tempus in fester Reihenfolge, Muster-Übersicht', () => {
  const groups = groupByTempus(verbs[0]).map((g) => g.tempus);
  assert.deepEqual(groups, ['Präsens', 'Indefinido', 'Imperfekt', 'Subjuntivo Präsens', 'Partizip']);
  const hablar = groupByTempus(verbs[1]).map((g) => g.tempus);
  assert.deepEqual(hablar, ['Präsens', 'Indefinido', 'Infinitiv']);
  const patterns = groupByPattern(verbs);
  assert.deepEqual(patterns.find(([k]) => k === 'e→ie')[1].map((v) => v.lemma), ['tener']);
  assert.deepEqual(patterns[patterns.length - 1][0], '', 'ohne Muster zuletzt');
  assert.deepEqual(patterns[patterns.length - 1][1].map((v) => v.lemma), ['hablar']);
});

test('Planung: Formkarten erst frei, wenn die Vokabelkarte des Verbs in Review ist; häufigste zuerst; Limit', () => {
  const progress = new Map();
  const review = sch.rate(sch.emptyProgress('ES-0011', NOW), 4, NOW).progress; // tener → Review
  progress.set(review.id, review);
  const later = new Date(NOW.getTime() + 60000);
  const off = buildPlan(sch, cards, progress, new Map(), new Map(), { newPerDay: 0, newVerbPerDay: 10 }, later, {});
  assert.equal(off.verbOn, false, 'ohne verben.json kein Verbmodus');
  assert.equal(off.sessions.verb.total, 0);
  const on = buildPlan(sch, cards, progress, new Map(), new Map(), { newPerDay: 0, newVerbPerDay: 10 }, later, { verbForms: forms });
  assert.equal(on.verbOn, true);
  assert.equal(on.types.verb.new, 9, 'alle 9 Formen von tener (Limit 10)');
  assert.equal(on.types.verb.locked, 8, 'hablar und ir gesperrt');
  assert.deepEqual(on.sessions.verb.entries.slice(0, 3).map((e) => e.form.form), ['tengo', 'tiene', 'tienes']);
  assert.ok(on.sessions.verb.entries.every((e) => e.type === 'verb' && e.key.startsWith('V:tener:')));
  assert.equal(on.types.hear.unseen, 1, 'Hörkarte von tener gehört zur Hörsitzung, nicht zur Verbsitzung');
  const limited = buildPlan(sch, cards, progress, new Map(), new Map([[dateKey(later), { id: dateKey(later), newCount: 0, reviewCount: 0, newVerbCount: 7 }]]), { newPerDay: 0, newVerbPerDay: 10 }, later, { verbForms: forms });
  assert.equal(limited.types.verb.new, 3, 'Tageslimit 10 − 7');
});

test('Planung: Reihenfolge neue Vokabel → Hören → Verbform; Verbformen von ausgesetzter Vokabel ausgelassen', () => {
  const progress = new Map();
  for (const id of ['ES-0011', 'ES-0016']) progress.set(id, sch.rate(sch.emptyProgress(id, NOW), 4, NOW).progress);
  const allCards = new Map(cards);
  allCards.set('ES-0001', { id: 'ES-0001', rank: 1, es: 'de', de: 'von', exEs: 'Soy de Madrid.', exDe: '', position: 2 });
  const later = new Date(NOW.getTime() + 60000);
  const plan = buildPlan(sch, allCards, progress, new Map([['ES-0016', { id: 'ES-0016', suspended: true }]]), new Map(), { newPerDay: 5, newHearPerDay: 5, newVerbPerDay: 2 }, later, { verbForms: forms });
  assert.deepEqual(plan.queue.map((e) => e.type), ['vocab', 'hear', 'verb', 'verb'], 'Hörkarte von ir entfällt (ausgesetzt)');
  assert.deepEqual(plan.queue.filter((e) => e.type === 'verb').map((e) => e.form.form), ['tengo', 'tiene'], 'ir ist ausgesetzt → vamos/voy fehlen');
  assert.equal(plan.types.verb.suspended, 4);
});
