// Lernansicht: Vorderseite (Wort), Rückseite (Übersetzung, Wortart, Beispiele), Bewertung.
import { state, plan, rateCard, getProgress, navigate, rerender, toast } from '../app.js';
import { RATINGS, LEARN_AHEAD_MS } from '../scheduler.js';
import { speak, stopSpeech } from '../speech.js';
import { el, formatInterval } from '../util.js';

export function renderStudy(main) {
  const p = plan();
  const queue = p.queue.map((c) => c.id);
  let index = 0;
  let showingBack = false;
  let busy = false;
  let currentId = null;
  let preview = null;

  const wrap = el('div', { class: 'study' });
  main.append(wrap);

  function finish() {
    stopSpeech();
    const q = plan();
    wrap.replaceChildren(
      el('div', { class: 'done' }, [
        el('h2', { text: 'Fertig für heute' }),
        el('p', { class: 'muted', text: q.queue.length ? `${q.queue.length} Karten warten noch.` : 'Alle fälligen und neuen Karten sind bearbeitet.' }),
      ]),
      el('div', { class: 'bottom-bar' }, [
        q.queue.length ? el('button', { class: 'btn primary big', onclick: () => rerender(), text: 'Weiter lernen' }) : null,
        el('button', { class: 'btn big', onclick: () => navigate('start'), text: 'Zum Start' }),
      ]),
    );
  }

  function showCard() {
    if (index >= queue.length) {
      finish();
      return;
    }
    currentId = queue[index];
    const card = state.cards.get(currentId);
    if (!card) {
      index++;
      showCard();
      return;
    }
    showingBack = false;
    const now = new Date();
    const prog = getProgress(currentId, now);
    preview = state.sch.preview(prog, now);
    const isNew = state.sch.isNew(prog);
    const status = isNew ? 'Neu' : prog.state === state.sch.State.Review ? 'Wiederholung' : 'Lernen';

    const header = el('div', { class: 'study-head' }, [
      el('span', { class: `badge ${isNew ? 'badge-new' : 'badge-due'}`, text: status }),
      el('span', { class: 'muted', text: `${index + 1} / ${queue.length}` }),
      el('button', { class: 'link', onclick: () => navigate('start'), 'aria-label': 'Lernen beenden', text: 'Beenden' }),
    ]);

    const front = el('div', { class: 'face front', id: 'card-front' }, [
      el('div', { class: 'word', lang: 'es', text: card.es }),
      el('button', {
        class: 'speaker',
        'aria-label': 'Wort vorlesen',
        onclick: (e) => {
          e.stopPropagation();
          speak(card.es);
        },
        text: '🔊',
      }),
    ]);

    const back = el('div', { class: 'face back hidden', id: 'card-back' }, [
      el('div', { class: 'word small', lang: 'es', text: card.es }),
      el('div', { class: 'translation', lang: 'de', text: card.de }),
      card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
      card.exEs
        ? el('div', { class: 'example' }, [
            el('div', { class: 'example-es', lang: 'es' }, [
              el('span', { text: card.exEs }),
              el('button', {
                class: 'speaker inline',
                'aria-label': 'Beispielsatz vorlesen',
                onclick: (e) => {
                  e.stopPropagation();
                  speak(card.exEs);
                },
                text: '🔊',
              }),
            ]),
            card.exDe ? el('div', { class: 'example-de muted', lang: 'de', text: card.exDe }) : null,
          ])
        : null,
    ]);

    const cardBox = el('div', { class: 'card study-card', role: 'button', tabindex: '0', 'aria-label': 'Karte umdrehen', onclick: flip }, [
      front,
      back,
    ]);

    const showBtn = el('button', { class: 'btn primary big', id: 'show-answer', onclick: flip, text: 'Antwort zeigen' });
    const ratings = el(
      'div',
      { class: 'ratings hidden', id: 'ratings' },
      RATINGS.map((r) =>
        el('button', { class: `btn rate rate-${r.key}`, 'data-grade': String(r.grade), onclick: () => rate(r.grade) }, [
          el('span', { class: 'rate-label', text: r.label }),
          el('span', { class: 'rate-interval', text: formatInterval(preview[r.grade].intervalMs) }),
        ]),
      ),
    );
    const bar = el('div', { class: 'bottom-bar' }, [showBtn, ratings]);

    wrap.replaceChildren(header, cardBox, bar);

    if (state.settings.autoSpeak) speak(card.es);

    function flip() {
      if (showingBack) return;
      showingBack = true;
      front.classList.add('hidden');
      back.classList.remove('hidden');
      showBtn.classList.add('hidden');
      ratings.classList.remove('hidden');
    }
  }

  async function rate(grade) {
    if (busy || !showingBack) return;
    busy = true;
    try {
      const after = await rateCard(currentId, grade);
      const S = state.sch.State;
      const dueIn = new Date(after.due).getTime() - Date.now();
      if ((after.state === S.Learning || after.state === S.Relearning) && dueIn <= LEARN_AHEAD_MS) {
        queue.push(currentId); // Lernkarte später in dieser Sitzung erneut zeigen
      }
      index++;
      showCard();
    } catch (e) {
      console.error(e);
      toast(`Speichern fehlgeschlagen: ${e.message}`, { error: true });
    } finally {
      busy = false;
    }
  }

  function onKey(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!showingBack) {
        e.preventDefault();
        document.getElementById('show-answer')?.click();
      }
    } else if (/^[1-4]$/.test(e.key) && showingBack) {
      rate(Number(e.key));
    }
  }
  document.addEventListener('keydown', onKey);

  showCard();
  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      stopSpeech();
    },
  };
}
