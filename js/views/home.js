// Startbildschirm: eine Entscheidung – heute lernen. Zusammenfassung, ein Hauptknopf, Einstiege je Lernmodus.
import { state, plan, navigate, backupDue, estimateMinutes } from '../app.js';
import { CARD_TYPES, TYPE_ORDER } from '../scheduler.js';
import { el } from '../util.js';

export function renderHome(main) {
  const p = plan();
  const s = p.sessions;
  const todayTotal = TYPE_ORDER.reduce((n, t) => n + s[t].total, 0);
  const minutes = estimateMinutes(todayTotal);

  main.append(el('h1', { class: 'title', text: 'Spanisch-Trainer' }));

  if (!state.cards.size) {
    main.append(el('p', { class: 'muted center', id: 'home-meta', text: 'Keine Vokabeln geladen. Füge unter Einstellungen ein Paket hinzu.' }));
  } else {
    main.append(
      el('section', { class: 'card today', id: 'today-summary', 'data-total': String(todayTotal), 'data-due': String(p.dueCount), 'data-new': String(p.newCount), 'data-minutes': String(minutes) }, [
        el('div', { class: 'today-main', text: todayTotal ? `Heute: ${todayTotal} Karten` : 'Heute ist alles erledigt' }),
        el('div', { class: 'muted', text: todayTotal ? `etwa ${minutes} Min · ${p.dueCount} fällig, ${p.newCount} neu` : p.reviewsToday ? `${p.reviewsToday} Karten bewertet – bis morgen!` : 'Komm morgen wieder.' }),
      ]),
    );
  }

  // Einstiege je Lernmodus (Hören/Verben nur, wenn es dort etwas gibt)
  const modes = TYPE_ORDER.filter((t) => t === 'vocab' || s[t].total || p.types[t].learned);
  const modeList = el(
    'div',
    { class: 'modes', id: 'modes' },
    modes.map((t) =>
      el('button', {
        class: `btn mode ${t === 'vocab' ? 'primary big' : ''}`,
        id: `start-${t}`,
        'data-count': String(s[t].total),
        disabled: s[t].total ? null : true,
        onclick: () => navigate(t === 'vocab' ? 'lernen' : `lernen/${t}`),
      }, [
        el('span', { class: 'mode-label', text: t === 'vocab' ? 'Lernen' : CARD_TYPES[t].session }),
        el('span', { class: 'mode-count', text: s[t].total ? `${s[t].total}` : '✓' }),
      ]),
    ),
  );
  if (state.cards.size) main.append(modeList);
  const lockedModes = TYPE_ORDER.filter((t) => t !== 'vocab' && !modes.includes(t) && p.types[t].locked);
  if (lockedModes.length) {
    const names = lockedModes.map((t) => CARD_TYPES[t].session);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}` : names[0];
    main.append(el('p', { class: 'muted small-text center', id: 'locked-hint', text: `${list} ${names.length > 1 ? 'werden' : 'wird'} frei, sobald Vokabeln den Zustand „Wiederholen“ erreichen.` }));
  }

  main.append(
    el('p', { class: 'center streak-line', id: 'streak-line' }, [
      el('a', { href: '#statistik', text: `🔥 ${p.streak} ${p.streak === 1 ? 'Tag' : 'Tage'} in Folge · Statistik` }),
    ]),
  );

  if (backupDue()) {
    main.append(
      el('p', { class: 'hint center', id: 'backup-hint' }, [
        el('a', { href: '#einstellungen', text: 'Lernstand sichern' }),
        el('span', { class: 'muted', text: state.backup.lastExportAt ? ' – letzte Sicherung ist älter als 7 Tage' : ' – noch keine Sicherung erstellt' }),
      ]),
    );
  }

  if (state.cards.size) {
    const parts = [`${p.totalCards} Karten`];
    if (p.unseenCount) parts.push(`${p.unseenCount} noch ungelernt`);
    if (p.types.vocab.suspended) parts.push(`${p.types.vocab.suspended} ausgesetzt`);
    main.append(el('p', { class: 'muted small-text center', id: 'home-meta', text: parts.join(' · ') }));
  }

  if (state.loadErrors.length) {
    main.append(el('div', { class: 'card error-box' }, [el('strong', { text: 'Hinweise beim Laden' }), el('ul', {}, state.loadErrors.map((e) => el('li', { text: e })))]));
  }
}
