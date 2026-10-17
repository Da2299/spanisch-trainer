import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parsePackage, compareByRank } from '../../js/parser.js';

const fixture = readFileSync(fileURLToPath(new URL('../fixtures/beispiel-paket.txt', import.meta.url)), 'utf8');

test('parst das Beispielpaket (8 Spalten, 5 Kopfzeilen)', () => {
  const { cards, headers, skipped } = parsePackage(fixture, 'beispiel-paket.txt');
  assert.equal(cards.length, 30);
  assert.equal(skipped, 0);
  assert.equal(headers.separator, 'tab');
  const first = cards[0];
  assert.deepEqual(
    { id: first.id, rank: first.rank, es: first.es, de: first.de, pos: first.pos, exEs: first.exEs, exDe: first.exDe, tags: first.tags, source: first.source },
    { id: 'ES-0001', rank: 1, es: 'de', de: 'von, aus', pos: 'Präposition', exEs: 'Soy de Madrid.', exDe: 'Ich bin aus Madrid.', tags: 'grundwortschatz praeposition', source: 'beispiel-paket.txt' },
  );
  assert.equal(cards[8].exEs, '¿Qué haces hoy?');
});

test('BOM, CRLF, Leerzeilen und Kommentare werden toleriert', () => {
  const text = '﻿#separator:tab\r\n#html:false\r\n\r\nES-0100\t100\thola\tHallo\tInterjektion\t¡Hola!\tHallo!\ttag\r\n# Kommentar\r\n';
  const { cards } = parsePackage(text);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'ES-0100');
  assert.equal(cards[0].exEs, '¡Hola!');
});

test('Anführungszeichen-Felder und HTML-Modus', () => {
  const text = '#separator:tab\n#html:true\nES-0200\t200\t"adiós"\tTschüss\t\t"Dijo ""adiós"" y se fue.<br>Luego volvió."\tEr sagte &quot;tschüss&quot; und ging.\t\n';
  const { cards } = parsePackage(text);
  assert.equal(cards[0].es, 'adiós');
  assert.equal(cards[0].exEs, 'Dijo "adiós" y se fue.\nLuego volvió.');
  assert.equal(cards[0].exDe, 'Er sagte "tschüss" und ging.');
});

test('Zeilen mit weniger als 4 Spalten werden übersprungen, doppelte Kennung: letzte gewinnt', () => {
  const text = 'ES-1\t1\tuno\teins\nkaputt\nES-1\t1\tuno\tEINS\n';
  const { cards, skipped } = parsePackage(text);
  assert.equal(skipped, 1);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].de, 'EINS');
});

test('Rangreihenfolge: Rang, dann Position, dann Kennung; fehlender Rang ans Ende', () => {
  const text = 'ES-3\t\ttres\tdrei\nES-2\t2\tdos\tzwei\nES-1\t1\tuno\teins\nES-4\t2\tcuatro\tvier\n';
  const { cards } = parsePackage(text);
  const sorted = [...cards].sort(compareByRank).map((c) => c.id);
  assert.deepEqual(sorted, ['ES-1', 'ES-2', 'ES-4', 'ES-3']);
});
