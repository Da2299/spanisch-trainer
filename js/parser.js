// Parser für Anki-Textexporte (Tab-getrennt, 8 Spalten).
// Spalten: Kennung, Rang, Spanisch, Deutsch, Wortart, Beispiel_ES, Beispiel_DE, Schlagwörter.

const SEPARATORS = {
  tab: '\t',
  '\\t': '\t',
  comma: ',',
  semicolon: ';',
  pipe: '|',
  colon: ':',
  space: ' ',
};

/** Anki-Feld entquoten: "..." mit verdoppelten Anführungszeichen. */
function unquote(field) {
  if (field.length >= 2 && field.startsWith('"') && field.endsWith('"')) {
    return field.slice(1, -1).replace(/""/g, '"');
  }
  return field;
}

/** Einfache HTML-Bereinigung für Felder aus HTML-Exporten. */
function stripHtml(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Zeilen mit Anführungszeichen-Feldern können Zeilenumbrüche enthalten.
 * Diese Funktion teilt den Text in logische Datensätze.
 */
function splitRecords(text) {
  const records = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      records.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length) records.push(cur);
  return records;
}

/**
 * Text eines Vokabelpakets parsen.
 * @param {string} text Dateiinhalt (UTF-8)
 * @param {string} source Dateiname (für Anzeige / Herkunft)
 * @returns {{cards: Card[], headers: Record<string,string>, skipped: number}}
 */
export function parsePackage(text, source = '') {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const headers = {};
  let sep = '\t';
  let html = false;
  const cards = [];
  const byId = new Map();
  let skipped = 0;
  let position = 0;

  for (const raw of splitRecords(text)) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      const m = /^#\s*([^:]+):\s*(.*)$/.exec(line);
      if (m) {
        const key = m[1].trim().toLowerCase();
        const val = m[2].trim();
        headers[key] = val;
        if (key === 'separator') sep = SEPARATORS[val.toLowerCase()] ?? (val.length === 1 ? val : '\t');
        if (key === 'html') html = /^true$/i.test(val);
      }
      continue;
    }
    const cols = line.split(sep).map((c) => unquote(c.trim()));
    if (cols.length < 4) {
      skipped++;
      continue;
    }
    const clean = (s) => (html ? stripHtml(s ?? '') : (s ?? '').trim());
    const id = clean(cols[0]);
    if (!id) {
      skipped++;
      continue;
    }
    const rankNum = Number.parseInt(clean(cols[1]), 10);
    const card = {
      id,
      rank: Number.isFinite(rankNum) ? rankNum : Number.MAX_SAFE_INTEGER,
      es: clean(cols[2]),
      de: clean(cols[3]),
      pos: clean(cols[4]),
      exEs: clean(cols[5]),
      exDe: clean(cols[6]),
      tags: clean(cols[7]),
      source,
      position: position++,
    };
    if (!card.es && !card.de) {
      skipped++;
      continue;
    }
    if (byId.has(id)) {
      // Doppelte Kennung innerhalb einer Datei: letzter Eintrag gewinnt.
      cards[byId.get(id)] = card;
    } else {
      byId.set(id, cards.length);
      cards.push(card);
    }
  }
  return { cards, headers, skipped };
}

/** Rangreihenfolge: Rang aufsteigend, dann Position in der Datei, dann Kennung. */
export function compareByRank(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
