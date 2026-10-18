// Verbmodus: Tabellenansicht aller Formen eines Verbs und Übersicht „Muster“.
import { state, getVerb, getCardMeta } from '../app.js';
import { verbKey, groupByTempus, groupByPattern } from '../verbs.js';
import { el, formatDate } from '../util.js';

function formStatus(key, verb) {
  const S = state.sch.State;
  const p = state.progress.get(key);
  if (getCardMeta(key).suspended || getCardMeta(verb.kennung).suspended) return { text: 'Ausgesetzt', cls: 'badge-off' };
  if (!p || state.sch.isNew(p)) {
    const vp = state.progress.get(verb.kennung);
    if (!vp || state.sch.isNew(vp) || vp.state !== S.Review) return { text: 'Gesperrt', cls: 'badge-off' };
    return { text: 'Neu', cls: 'badge-new' };
  }
  if (state.sch.isDue(p)) return { text: 'Fällig', cls: 'badge-due' };
  if (p.state === S.Learning || p.state === S.Relearning) return { text: 'Lernen', cls: 'badge-learn' };
  return { text: formatDate(p.due), cls: 'badge-ok' };
}

/** #verb/<lemma>: alle Formen gruppiert nach Tempus, unregelmäßige hervorgehoben, Häufigkeitsbalken. */
export function renderVerbTable(main, lemma) {
  const verb = getVerb(lemma);
  main.append(
    el('div', { class: 'study-head' }, [
      el('button', { class: 'link', onclick: () => history.back(), text: '‹ Zurück' }),
      el('a', { class: 'link', href: '#muster', text: 'Muster-Übersicht' }),
    ]),
  );
  if (!verb) {
    main.append(el('h1', { class: 'title', text: 'Verb nicht gefunden' }), el('p', { class: 'muted', text: `Zu „${lemma}“ gibt es keinen Eintrag in data/verben.json.` }));
    return;
  }
  const card = state.cards.get(verb.kennung);
  const maxFreq = Math.max(1, ...verb.formen.map((f) => f.haeufigkeit));
  main.append(
    el('h1', { class: 'title', lang: 'es', text: verb.lemma }),
    el('p', { class: 'muted', id: 'verb-info' }, [
      verb.label ? el('span', { text: verb.label }) : null,
      card ? el('span', { text: ` · ${card.de}` }) : null,
      verb.kennung ? el('span', { class: 'small-text', text: ` · ${verb.kennung}` }) : null,
    ]),
    verb.muster.length ? el('div', { class: 'chips', id: 'verb-muster' }, verb.muster.map((m) => el('a', { class: 'chip', href: `#muster/${encodeURIComponent(m)}`, text: m }))) : null,
  );
  for (const group of groupByTempus(verb)) {
    main.append(
      el('section', { class: 'card verb-group', 'data-tempus': group.tempus }, [
        el('h2', { text: group.tempus }),
        el(
          'ul',
          { class: 'verb-table' },
          group.formen.map((f) => {
            const key = verbKey(verb.lemma, f.form, f.tempus);
            const st = formStatus(key, verb);
            return el('li', { class: `vt-row${f.unregelmaessig ? ' irregular' : ''}`, 'data-form': f.form }, [
              el('div', { class: 'vt-line' }, [
                el('span', { class: 'vt-form', lang: 'es' }, [el('span', { class: 'form-text', text: f.form }), f.unregelmaessig ? el('span', { class: 'badge badge-irregular', text: 'unregelm.' }) : null]),
                el('span', { class: `badge ${st.cls}`, text: st.text }),
              ]),
              el('div', { class: 'vt-line' }, [
                el('span', { class: 'vt-person muted', text: f.person || '–' }),
                el('span', { class: 'vt-freq', title: `Häufigkeit ${f.haeufigkeit}` }, [el('div', { class: 'freq-bar', style: `width:${Math.max(2, Math.round((f.haeufigkeit / maxFreq) * 100))}%` })]),
              ]),
            ]);
          }),
        ),
      ]),
    );
  }
  main.append(el('p', { class: 'muted small-text', text: 'Balken: Häufigkeit relativ zur häufigsten Form dieses Verbs. Farbig hervorgehoben: unregelmäßige Formen.' }));
}

/** #muster[/<muster>]: Verben gruppiert nach den Einträgen in „muster“. */
export function renderPatterns(main, selected = '') {
  main.append(el('h1', { class: 'title', text: 'Verben nach Muster' }));
  if (!state.verbs.length) {
    main.append(el('p', { class: 'muted', text: 'Keine Verbdaten geladen (data/verben.json fehlt oder ist leer).' }));
    return;
  }
  const groups = groupByPattern(state.verbs);
  main.append(
    el('p', { class: 'muted small-text', text: `${state.verbs.length} Verben, ${state.verbForms.size} Formen. Antippen öffnet die Formentabelle.` }),
    el(
      'div',
      { class: 'chips' },
      [el('a', { class: `chip${selected ? '' : ' active'}`, href: '#muster', text: 'Alle' }), ...groups.filter(([k]) => k).map(([k, vs]) => el('a', { class: `chip${k === selected ? ' active' : ''}`, href: `#muster/${encodeURIComponent(k)}`, text: `${k} (${vs.length})` }))],
    ),
  );
  for (const [pattern, verbs] of groups) {
    if (selected && pattern !== selected) continue;
    main.append(
      el('section', { class: 'card', 'data-muster': pattern }, [
        el('h2', { text: pattern || 'Ohne Muster (regelmäßig)' }),
        el(
          'ul',
          { class: 'list' },
          verbs.map((v) =>
            el('li', { class: 'list-item', 'data-lemma': v.lemma, onclick: () => (location.hash = `#verb/${encodeURIComponent(v.lemma)}`) }, [
              el('div', { class: 'li-main' }, [el('div', { class: 'li-es', lang: 'es', text: v.lemma }), el('div', { class: 'li-de muted', text: `${v.label || ''}${v.formen.length ? ` · ${v.formen.length} Formen` : ''}` })]),
              el('span', { class: 'badge', text: v.kennung || '' }),
            ]),
          ),
        ),
      ]),
    );
  }
}
