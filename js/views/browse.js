// Karten durchsuchen: Liste mit Suche, Filter (alle / schwierig / ausgesetzt) und Detailansicht.
import { state, getProgress, getCardMeta, setCardMeta, getVerbByKennung, toast } from '../app.js';
import { compareByRank } from '../parser.js';
import { isDifficult, hearKeyOf, backKeyOf } from '../scheduler.js';
import { speak } from '../speech.js';
import { el, formatDate, splitMeaning } from '../util.js';

const PAGE = 200;
const FILTERS = [
  { key: 'all', label: 'Alle' },
  { key: 'difficult', label: 'Schwierig' },
  { key: 'suspended', label: 'Ausgesetzt' },
  { key: 'noted', label: 'Mit Notiz' },
];

function statusOf(id) {
  const p = state.progress.get(id);
  const m = getCardMeta(id);
  const S = state.sch.State;
  if (m.suspended) return { text: 'Ausgesetzt', cls: 'badge-off' };
  if (!p || state.sch.isNew(p)) {
    // Hör-/Rückwärtskarte: gesperrt, bis die Vokabelkarte im Zustand Review ist
    if (id.endsWith(':H') || id.endsWith(':R')) {
      const vp = state.progress.get(id.slice(0, -2));
      if (!vp || state.sch.isNew(vp) || vp.state !== S.Review) return { text: 'Gesperrt', cls: 'badge-off' };
    }
    return { text: 'Neu', cls: 'badge-new' };
  }
  const due = new Date(p.due);
  if (state.sch.isDue(p)) return { text: 'Fällig', cls: 'badge-due' };
  if (p.state === S.Learning || p.state === S.Relearning) return { text: 'Lernen', cls: 'badge-learn' };
  return { text: formatDate(due), cls: 'badge-ok' };
}

export function renderBrowse(main) {
  const all = [...state.cards.values()].sort(compareByRank);
  let query = '';
  let filter = 'all';
  let limit = PAGE;

  const input = el('input', {
    type: 'search',
    id: 'search',
    class: 'search',
    placeholder: 'Suchen (Spanisch, Deutsch, Kennung, Schlagwort)',
    autocomplete: 'off',
    autocapitalize: 'off',
    'aria-label': 'Karten durchsuchen',
    oninput: (e) => {
      query = e.target.value.trim().toLowerCase();
      limit = PAGE;
      renderList();
    },
  });
  const chips = el(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Filter' },
    FILTERS.map((f) =>
      el('button', {
        class: `chip${f.key === filter ? ' active' : ''}`,
        'data-filter': f.key,
        onclick: () => {
          filter = f.key;
          limit = PAGE;
          chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
          renderList();
        },
        text: f.label,
      }),
    ),
  );
  const info = el('p', { class: 'muted', id: 'browse-info' });
  const list = el('ul', { class: 'list', id: 'card-list' });
  const detail = el('div', { class: 'detail hidden', id: 'card-detail' });
  main.append(el('h1', { class: 'title', text: 'Karten' }), input, chips);
  if (state.verbs.length) main.append(el('p', { class: 'hint', id: 'verbs-link' }, [el('a', { href: '#muster', text: `Verbtabellen und Muster (${state.verbs.length} Verben)` })]));
  main.append(info, list, detail);

  function matches(c) {
    if (filter === 'difficult' && !isDifficult(state.progress.get(c.id))) return false;
    if (filter === 'suspended' && !getCardMeta(c.id).suspended) return false;
    if (filter === 'noted' && !(getCardMeta(c.id).note || '').trim()) return false;
    if (!query) return true;
    return (
      c.es.toLowerCase().includes(query) ||
      c.de.toLowerCase().includes(query) ||
      c.id.toLowerCase().includes(query) ||
      (c.tags && c.tags.toLowerCase().includes(query)) ||
      (c.pos && c.pos.toLowerCase().includes(query))
    );
  }

  function renderList() {
    const hits = all.filter(matches);
    info.textContent = hits.length === all.length ? `${all.length} Karten` : `${hits.length} von ${all.length} Karten`;
    const shown = hits.slice(0, limit);
    list.replaceChildren(
      ...shown.map((c) => {
        const st = statusOf(c.id);
        const difficult = isDifficult(state.progress.get(c.id));
        return el('li', { class: 'list-item', 'data-id': c.id, onclick: () => showDetail(c) }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-es', lang: 'es' }, [c.es, difficult ? el('span', { class: 'badge badge-leech', text: 'schwierig' }) : null]),
            el('div', { class: 'li-de muted', lang: 'de', text: splitMeaning(c.de).main }),
          ]),
          el('span', { class: `badge ${st.cls}`, text: st.text }),
        ]);
      }),
    );
    if (hits.length > limit) {
      list.append(
        el('li', { class: 'list-more' }, [
          el('button', {
            class: 'btn',
            onclick: () => {
              limit += PAGE;
              renderList();
            },
            text: `Weitere anzeigen (${hits.length - limit})`,
          }),
        ]),
      );
    }
    if (!all.length) info.textContent = 'Keine Karten geladen.';
  }

  function showDetail(c) {
    const p = state.progress.get(c.id);
    const m = getCardMeta(c.id);
    const st = statusOf(c.id);
    const meaning = splitMeaning(c.de);
    const rows = [
      ['Kennung', c.id],
      ['Rang', c.rank === Number.MAX_SAFE_INTEGER ? '–' : String(c.rank)],
      ['Wortart', c.pos || '–'],
      ['Schlagwörter', c.tags || '–'],
      ['Paket', c.source || '–'],
      ['Status', st.text],
    ];
    if (p && !state.sch.isNew(p)) {
      const r = state.sch.retrievability(p);
      rows.push(['Fällig am', formatDate(p.due)]);
      rows.push(['Wiederholungen', `${p.reps} (${p.lapses} vergessen, ${p.againCount || 0}× Nochmal)`]);
      rows.push(['Stabilität', `${Math.round(p.stability * 10) / 10} Tage`]);
      if (r !== null) rows.push(['Abrufwahrscheinlichkeit', `${Math.round(r * 100)} %`]);
    }
    {
      const bk = backKeyOf(c.id);
      const bs = statusOf(bk);
      const bp = state.progress.get(bk);
      rows.push(['Rückwärtskarte', `${bs.text}${bp && !state.sch.isNew(bp) ? `, fällig am ${formatDate(bp.due)}` : ''}`]);
    }
    if (c.exEs) {
      const hk = hearKeyOf(c.id);
      const hs = statusOf(hk);
      const hp = state.progress.get(hk);
      rows.push(['Hörkarte', `${hs.text}${hp && !state.sch.isNew(hp) ? `, fällig am ${formatDate(hp.due)}` : ''}`]);
    }
    let noteTimer = null;
    const noteField = el('textarea', {
      class: 'note',
      id: 'detail-note',
      rows: '2',
      placeholder: 'Notiz (nur auf diesem Gerät)',
      'aria-label': 'Notiz zur Karte',
      oninput: (e) => {
        clearTimeout(noteTimer);
        const note = e.target.value;
        noteTimer = setTimeout(() => setCardMeta(c.id, { note }).catch((err) => console.error(err)), 400);
      },
    });
    noteField.value = m.note || '';
    const suspendBtn = el('button', {
      class: `btn ${m.suspended ? '' : 'danger'}`,
      id: 'detail-suspend',
      onclick: async () => {
        await setCardMeta(c.id, { suspended: !m.suspended });
        toast(m.suspended ? 'Karte wieder aufgenommen' : 'Karte ausgesetzt');
        renderList();
        showDetail(c);
      },
      text: m.suspended ? 'Wieder aufnehmen' : 'Aussetzen',
    });
    detail.replaceChildren(
      el('div', { class: 'card' }, [
        el('div', { class: 'detail-head' }, [
          el('div', { class: 'word small', lang: 'es', text: c.es }),
          el('button', { class: 'speaker', 'aria-label': 'Wort vorlesen', onclick: () => speak(c.es), text: '🔊' }),
        ]),
        el('div', { class: 'meaning-main', lang: 'de', text: meaning.main }),
        meaning.rest ? el('div', { class: 'meaning-rest muted', lang: 'de', text: meaning.rest }) : null,
        isDifficult(p) ? el('div', {}, [el('span', { class: 'badge badge-leech', text: 'schwierig' })]) : null,
        c.exEs
          ? el('div', { class: 'example' }, [
              el('div', { class: 'example-es', lang: 'es' }, [
                el('span', { text: c.exEs }),
                el('button', { class: 'speaker inline', 'aria-label': 'Beispielsatz vorlesen', onclick: () => speak(c.exEs), text: '🔊' }),
              ]),
              c.exDe ? el('div', { class: 'example-de muted', lang: 'de', text: c.exDe }) : null,
            ])
          : null,
        noteField,
        el('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        (() => {
          const verb = getVerbByKennung(c.id);
          return verb ? el('a', { class: 'btn', id: 'detail-verb-link', href: `#verb/${encodeURIComponent(verb.lemma)}`, text: `Alle Formen von ${verb.lemma}` }) : null;
        })(),
        el('div', { class: 'btn-row' }, [suspendBtn, el('button', { class: 'btn', onclick: () => detail.classList.add('hidden'), text: 'Schließen' })]),
      ]),
    );
    detail.classList.remove('hidden');
    detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  renderList();
}
