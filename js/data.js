// Laden der Vokabelpakete: Dateien aus data/index.json (Repository) und
// importierte Pakete aus dem Storage (Store "packages").
import { parsePackage } from './parser.js';
import { hashString } from './util.js';

export const DATA_DIR = './data/';
export const INDEX_URL = `${DATA_DIR}index.json`;

/** data/index.json laden (Liste von Dateinamen). */
export async function loadIndex() {
  const res = await fetch(INDEX_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error('index.json: keine Liste');
  return list.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim());
}

/** Eine Datendatei aus dem Repository laden und parsen. */
export async function loadRepoFile(name) {
  const res = await fetch(DATA_DIR + encodeURIComponent(name), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  return { name, origin: 'repo', text, ...parsePackage(text, name) };
}

/**
 * Alle Quellen laden und zu einer Kartenmenge zusammenführen.
 * Reihenfolge: Repository-Dateien (index.json), danach importierte Pakete
 * (nach Importzeitpunkt). Spätere Quellen aktualisieren frühere mit gleicher Kennung.
 * @returns {{cards: Map<string, Card>, sources: Array, errors: string[]}}
 */
export async function loadAllCards(storage) {
  const sources = [];
  const errors = [];
  let names = [];
  try {
    names = await loadIndex();
  } catch (e) {
    errors.push(`data/index.json konnte nicht geladen werden: ${e.message}`);
  }
  for (const name of names) {
    try {
      const pkg = await loadRepoFile(name);
      sources.push(pkg);
    } catch (e) {
      errors.push(`Paket ${name}: ${e.message}`);
    }
  }
  let imported = [];
  try {
    imported = await storage.getAll('packages');
  } catch (e) {
    errors.push(`Importierte Pakete: ${e.message}`);
  }
  imported.sort((a, b) => (a.importedAt || '').localeCompare(b.importedAt || ''));
  for (const p of imported) {
    const parsed = parsePackage(p.text || '', p.id);
    sources.push({ name: p.id, origin: 'import', importedAt: p.importedAt, text: p.text, ...parsed });
  }
  const cards = mergeSources(sources);
  return { cards, sources: sources.map(summarize), errors };
}

/** Karten aller Quellen nach Kennung zusammenführen (spätere Quelle gewinnt). */
export function mergeSources(sources) {
  const cards = new Map();
  for (const src of sources) {
    for (const c of src.cards) cards.set(c.id, c);
  }
  return cards;
}

function summarize(src) {
  return {
    name: src.name,
    origin: src.origin,
    importedAt: src.importedAt,
    count: src.cards.length,
    skipped: src.skipped,
    hash: hashString(src.text || ''),
  };
}

/** Paketdatei (Text) importieren und dauerhaft speichern. */
export async function storeImportedPackage(storage, name, text) {
  const parsed = parsePackage(text, name);
  if (!parsed.cards.length) {
    throw new Error('Keine Vokabeln gefunden. Erwartet: Tab-getrennte Zeilen mit Kennung, Rang, Spanisch, Deutsch …');
  }
  const rec = { id: name, text, importedAt: new Date().toISOString(), count: parsed.cards.length };
  await storage.put('packages', rec);
  return { ...rec, cards: parsed.cards, skipped: parsed.skipped };
}
