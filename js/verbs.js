// Verbmodus (Stufe 3): Laden von data/verben.json, Formkarten-Schlüssel, Lückentext, Eingabevergleich.

export const VERBS_URL = './data/verben.json';
export const TEMPUS_ORDER = [
  'Präsens',
  'Indefinido',
  'Imperfekt',
  'Futur',
  'Konditional',
  'Subjuntivo Präsens',
  'Subjuntivo Imperfekt',
  'Imperativ',
  'Gerundium',
  'Partizip',
  'Infinitiv',
];

/** Schlüssel einer Formkarte: „V:“ + lemma + „:“ + form + „:“ + tempus. */
export function verbKey(lemma, form, tempus) {
  return `V:${lemma}:${form}:${tempus}`;
}

/** data/verben.json laden. Fehlt die Datei, ist der Verbmodus ohne Daten (kein Fehler). */
export async function loadVerbs() {
  let res;
  try {
    res = await fetch(VERBS_URL, { cache: 'no-cache' });
  } catch (e) {
    return { verbs: [], error: `verben.json: ${e.message}` };
  }
  if (!res.ok) return { verbs: [], error: res.status === 404 ? null : `verben.json: HTTP ${res.status}` };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { verbs: [], error: `verben.json: ${e.message}` };
  }
  return { verbs: normalizeVerbs(data), error: null };
}

/** Rohdaten prüfen und in eine einheitliche Struktur bringen. */
export function normalizeVerbs(data) {
  const list = data && Array.isArray(data.verben) ? data.verben : [];
  const verbs = [];
  for (const v of list) {
    if (!v || typeof v.lemma !== 'string' || !v.lemma.trim()) continue;
    const lemma = v.lemma.trim();
    const formen = (Array.isArray(v.formen) ? v.formen : [])
      .filter((f) => f && typeof f.form === 'string' && f.form.trim() && typeof f.tempus === 'string')
      .map((f) => ({
        form: f.form.trim(),
        tempus: f.tempus.trim(),
        person: typeof f.person === 'string' ? f.person.trim() : '',
        haeufigkeit: Number.isFinite(Number(f.haeufigkeit)) ? Number(f.haeufigkeit) : 0,
        unregelmaessig: !!f.unregelmaessig,
      }));
    verbs.push({
      lemma,
      kennung: typeof v.kennung === 'string' ? v.kennung.trim() : '',
      label: typeof v.label === 'string' ? v.label : '',
      muster: (Array.isArray(v.muster) ? v.muster : []).filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()),
      formen,
      saetze: (Array.isArray(v.saetze) ? v.saetze : []).filter((s) => s && typeof s.kennung === 'string' && typeof s.form === 'string'),
    });
  }
  return verbs;
}

/**
 * Formkarten aller Verben als Map Schlüssel → Eintrag.
 * @param {Array} verbs normalisierte Verben
 * @param {Map<string, Card>} cards Vokabelkarten (für Beispielsätze)
 */
export function buildVerbForms(verbs, cards) {
  const forms = new Map();
  for (const verb of verbs) {
    for (const f of verb.formen) {
      const key = verbKey(verb.lemma, f.form, f.tempus);
      if (forms.has(key)) continue; // doppelte Form/Tempus-Kombination: erste gewinnt
      const sentence = findSentence(verb, f.form, cards);
      forms.set(key, { key, verb, ...f, sentence });
    }
  }
  return forms;
}

/** Beispielsatz (Vokabelkarte) zu einer Form laut „saetze“, falls die Form im Satz vorkommt. */
export function findSentence(verb, form, cards) {
  for (const s of verb.saetze) {
    if (s.form.trim().toLowerCase() !== form.toLowerCase()) continue;
    const card = cards.get(s.kennung);
    if (!card || !card.exEs) continue;
    const gap = makeGap(card.exEs, form, verb.lemma);
    if (gap) return { kennung: s.kennung, es: card.exEs, de: card.exDe || '', gap: gap.text, segments: gap.segments };
  }
  return null;
}

const LETTER = /\p{L}/u;

/**
 * Erstes Vorkommen der Form im Satz (Wortgrenzen, Groß-/Kleinschreibung ignorieren) durch
 * „____ (infinitiv)“ ersetzen.
 * @returns {{text: string, segments: {text:string, mark:boolean}[]}|null} null, wenn die Form nicht vorkommt
 */
export function makeGap(sentence, form, lemma) {
  const text = String(sentence ?? '');
  const lower = text.toLowerCase();
  const needle = String(form ?? '').toLowerCase();
  if (!needle) return null;
  let from = 0;
  while (from <= lower.length - needle.length) {
    const i = lower.indexOf(needle, from);
    if (i < 0) break;
    const before = i > 0 ? text[i - 1] : '';
    const after = text[i + needle.length] || '';
    if (!LETTER.test(before) && !LETTER.test(after)) {
      return {
        text: `${text.slice(0, i)}____ (${lemma})${text.slice(i + needle.length)}`,
        segments: [
          { text: text.slice(0, i), mark: false },
          { text: text.slice(i, i + needle.length), mark: true },
          { text: text.slice(i + needle.length), mark: false },
        ].filter((seg) => seg.text.length),
      };
    }
    from = i + 1;
  }
  return null;
}

/** Eingabe normalisieren: Groß-/Kleinschreibung und Leerraum ignorieren, Akzente zählen. */
export function normalizeAnswer(s) {
  return String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Eingabe mit der Form vergleichen.
 * @returns {{correct: boolean, expected: {ch:string, diff:boolean}[], given: {ch:string, diff:boolean}[]}}
 *          Zeichenweise Markierung der Unterschiede (Position für Position).
 */
export function compareAnswer(input, form) {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(form);
  const correct = a === b;
  const given = [...a].map((ch, i) => ({ ch, diff: ch !== [...b][i] }));
  const expected = [...b].map((ch, i) => ({ ch, diff: ch !== [...a][i] }));
  return { correct, expected, given };
}

/** Neue Formkarten nach Häufigkeit absteigend (über alle Verben), dann Lemma/Form. */
export function compareByFrequency(a, b) {
  if (b.haeufigkeit !== a.haeufigkeit) return b.haeufigkeit - a.haeufigkeit;
  if (a.verb.lemma !== b.verb.lemma) return a.verb.lemma < b.verb.lemma ? -1 : 1;
  return a.form < b.form ? -1 : a.form > b.form ? 1 : 0;
}

/** Formen eines Verbs gruppiert nach Tempus in fester Reihenfolge. */
export function groupByTempus(verb) {
  const groups = new Map();
  for (const f of verb.formen) {
    if (!groups.has(f.tempus)) groups.set(f.tempus, []);
    groups.get(f.tempus).push(f);
  }
  const order = (t) => {
    const i = TEMPUS_ORDER.indexOf(t);
    return i < 0 ? TEMPUS_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort((x, y) => order(x[0]) - order(y[0]) || (x[0] < y[0] ? -1 : 1))
    .map(([tempus, formen]) => ({ tempus, formen: [...formen].sort((p, q) => q.haeufigkeit - p.haeufigkeit) }));
}

/** Verben nach Muster-Einträgen gruppieren; ohne Muster unter dem Schlüssel „“. */
export function groupByPattern(verbs) {
  const groups = new Map();
  for (const v of verbs) {
    const keys = v.muster.length ? v.muster : [''];
    for (const k of keys) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    }
  }
  return [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0], 'de')));
}
