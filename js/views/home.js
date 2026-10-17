// Startbildschirm: Kennzahlen und Einstieg ins Lernen.
import { state, plan, navigate } from '../app.js';
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

  const meta = el('p', { class: 'muted center', id: 'home-meta' });
  if (!state.cards.size) {
    meta.textContent = 'Keine Vokabeln geladen. Füge unter Einstellungen ein Paket hinzu.';
  } else {
    const parts = [`${p.totalCards} Karten in ${state.sources.length} Paket${state.sources.length === 1 ? '' : 'en'}`];
    if (p.reviewsToday) parts.push(`${p.reviewsToday} Bewertungen heute`);
    if (p.unseenCount > p.newCount) parts.push(`${p.unseenCount} noch ungelernt`);
    meta.textContent = parts.join(' · ');
  }
  main.append(meta);

  if (state.loadErrors.length) {
    main.append(
      el('div', { class: 'card error-box' }, [
        el('strong', { text: 'Hinweise beim Laden' }),
        el('ul', {}, state.loadErrors.map((e) => el('li', { text: e }))),
      ]),
    );
  }

  const queueLen = p.queue.length;
  const bar = el('div', { class: 'bottom-bar' }, [
    el('button', {
      class: 'btn primary big',
      id: 'start-study',
      disabled: queueLen === 0 || null,
      onclick: () => navigate('lernen'),
      text: queueLen ? `Lernen starten (${queueLen})` : 'Nichts fällig – gut gemacht!',
    }),
  ]);
  main.append(bar);
}
