// Karten durchsuchen: Liste mit Suche und Detailansicht.
import { state, getProgress } from '../app.js';
import { compareByRank } from '../parser.js';
import { speak } from '../speech.js';
import { el, formatDate } from '../util.js';

const PAGE = 200;

function statusOf(id) {
  const p = state.progress.get(id);
  const S = state.sch.State;
  if (!p || state.sch.isNew(p)) return { text: 'Neu', cls: 'badge-new' };
  const due = new Date(p.due);
  if (state.sch.isDue(p)) return { text: 'Fällig', cls: 'badge-due' };
  if (p.state === S.Learning || p.state === S.Relearning) return { text: 'Lernen', cls: 'badge-learn' };
  return { text: formatDate(due), cls: 'badge-ok' };
}

export function renderBrowse(main) {
  const all = [...state.cards.values()].sort(compareByRank);
  let query = '';
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
  const info = el('p', { class: 'muted', id: 'browse-info' });
  const list = el('ul', { class: 'list', id: 'card-list' });
  const detail = el('div', { class: 'detail hidden', id: 'card-detail' });
  main.append(el('h1', { class: 'title', text: 'Karten' }), input, info, list, detail);

  function matches(c) {
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
        return el('li', { class: 'list-item', 'data-id': c.id, onclick: () => showDetail(c) }, [
          el('div', { class: 'li-main' }, [
            el('div', { class: 'li-es', lang: 'es', text: c.es }),
            el('div', { class: 'li-de muted', lang: 'de', text: c.de }),
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
    const st = statusOf(c.id);
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
      rows.push(['Wiederholungen', `${p.reps} (${p.lapses} vergessen)`]);
      rows.push(['Stabilität', `${Math.round(p.stability * 10) / 10} Tage`]);
      if (r !== null) rows.push(['Abrufwahrscheinlichkeit', `${Math.round(r * 100)} %`]);
    }
    detail.replaceChildren(
      el('div', { class: 'card' }, [
        el('div', { class: 'detail-head' }, [
          el('div', { class: 'word small', lang: 'es', text: c.es }),
          el('button', { class: 'speaker', 'aria-label': 'Wort vorlesen', onclick: () => speak(c.es), text: '🔊' }),
        ]),
        el('div', { class: 'translation', lang: 'de', text: c.de }),
        c.exEs
          ? el('div', { class: 'example' }, [
              el('div', { class: 'example-es', lang: 'es' }, [
                el('span', { text: c.exEs }),
                el('button', { class: 'speaker inline', 'aria-label': 'Beispielsatz vorlesen', onclick: () => speak(c.exEs), text: '🔊' }),
              ]),
              c.exDe ? el('div', { class: 'example-de muted', lang: 'de', text: c.exDe }) : null,
            ])
          : null,
        el('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        el('button', { class: 'btn', onclick: () => detail.classList.add('hidden'), text: 'Schließen' }),
      ]),
    );
    detail.classList.remove('hidden');
    detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  renderList();
}
