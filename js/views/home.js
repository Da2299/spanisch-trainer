// Startbildschirm: Kennzahlen, Sicherungshinweis und Einstieg ins Lernen.
import { state, plan, navigate, backupDue } from '../app.js';
import { CARD_TYPES } from '../scheduler.js';
import { el } from '../util.js';

export function renderHome(main) {
  const p = plan();
  const tiles = [
    ['Fällig heute', p.dueCount, 'due'],
    ['Neu heute', p.newCount, 'new'],
    ['Gelernt gesamt', p.learnedTotal, 'learned'],
    ['Tage in Folge', p.streak, 'streak'],
  ];
  main.append(
    el('h1', { class: 'title', text: 'Spanisch-Trainer' }),
    el(
      'section',
      { class: 'stats', 'aria-label': 'Statistik' },
      tiles.map(([label, value, key]) =>
        el('div', { class: 'stat', 'data-stat': key }, [
          el('div', { class: 'stat-value', text: String(value) }),
          el('div', { class: 'stat-label', text: label }),
        ]),
      ),
    ),
  );

  // Zahlen je Kartentyp (Hörkarten nur bei aktivem Hörmodus)
  const typeKeys = ['vocab', ...(p.hearingOn ? ['hear'] : [])];
  main.append(
    el('table', { class: 'type-table', id: 'type-table' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'Fällig' }), el('th', { text: 'Neu' }), el('th', { text: 'Gelernt' })])]),
      el(
        'tbody',
        {},
        typeKeys.map((t) =>
          el('tr', { 'data-type': t }, [
            el('th', { text: CARD_TYPES[t].labelPlural }),
            el('td', { 'data-col': 'due', text: String(p.types[t].due) }),
            el('td', { 'data-col': 'new', text: String(p.types[t].new) }),
            el('td', { 'data-col': 'learned', text: String(p.types[t].learned) }),
          ]),
        ),
      ),
    ]),
  );

  const meta = el('p', { class: 'muted center', id: 'home-meta' });
  if (!state.cards.size) {
    meta.textContent = 'Keine Vokabeln geladen. Füge unter Einstellungen ein Paket hinzu.';
  } else {
    const parts = [`${p.totalCards} Karten in ${state.sources.length} Paket${state.sources.length === 1 ? '' : 'en'}`];
    if (p.reviewsToday) parts.push(`${p.reviewsToday} Bewertungen heute`);
    if (p.unseenCount > p.types.vocab.new) parts.push(`${p.unseenCount} noch ungelernt`);
    if (p.hearingOn && p.types.hear.locked) parts.push(`${p.types.hear.locked} Hörkarten noch gesperrt`);
    if (p.suspendedCount) parts.push(`${p.suspendedCount} ausgesetzt`);
    meta.textContent = parts.join(' · ');
  }
  main.append(meta);

  if (backupDue()) {
    main.append(
      el('p', { class: 'hint center', id: 'backup-hint' }, [
        el('a', { href: '#einstellungen', text: 'Lernstand sichern' }),
        el('span', { class: 'muted', text: state.backup.lastExportAt ? ' – letzte Sicherung ist älter als 7 Tage' : ' – noch keine Sicherung erstellt' }),
      ]),
    );
  }

  if (state.loadErrors.length) {
    main.append(
      el('div', { class: 'card error-box' }, [
        el('strong', { text: 'Hinweise beim Laden' }),
        el('ul', {}, state.loadErrors.map((e) => el('li', { text: e }))),
      ]),
    );
  }

  const queueLen = p.queue.length;
  main.append(
    el('div', { class: 'bottom-bar' }, [
      el('button', {
        class: 'btn primary big',
        id: 'start-study',
        disabled: queueLen === 0 || null,
        onclick: () => navigate('lernen'),
        text: queueLen ? `Lernen starten (${queueLen})` : 'Nichts fällig – gut gemacht!',
      }),
    ]),
  );
}
