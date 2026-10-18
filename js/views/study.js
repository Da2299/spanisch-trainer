// Lernansicht: Vorderseite (Wort), Rückseite (Hauptbedeutung, Rest, Wortart, Beispiele, Notiz), Bewertung.
// Tastatur: Leertaste/Enter = Antwort zeigen, 1–4 = bewerten, Z = Rückgängig, S = vorlesen.
import { state, plan, rateCard, undoLastRating, getProgress, getCardMeta, setCardMeta, navigate, rerender, toast } from '../app.js';
import { RATINGS, LEARN_AHEAD_MS, isDifficult, cardTypeOf, baseIdOf, CARD_TYPES } from '../scheduler.js';
import { speak, stopSpeech } from '../speech.js';
import { el, formatInterval, splitMeaning, highlightWord } from '../util.js';

const SLOW_RATE = 0.8;

export function renderStudy(main) {
  const p = plan();
  const queue = p.queue.map((e) => e.key);
  let index = 0;
  let showingBack = false;
  let busy = false;
  let current = null; // Schlüssel der aktuellen Karte
  let preview = null;
  let shownAt = 0;
  let noteTimer = null;
  let pendingNote = null; // { id, note }
  let lastQueuePush = null; // Index, an dem die zuletzt bewertete Karte erneut eingereiht wurde

  const wrap = el('div', { class: 'study' });
  main.append(wrap);

  function flushNote() {
    clearTimeout(noteTimer);
    if (pendingNote) {
      const { id, note } = pendingNote;
      pendingNote = null;
      setCardMeta(id, { note }).catch((e) => console.error(e));
    }
  }

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
        state.lastRating ? el('button', { class: 'btn', id: 'undo', onclick: undo, text: 'Rückgängig' }) : null,
        el('button', { class: 'btn big', onclick: () => navigate('start'), text: 'Zum Start' }),
      ]),
    );
  }

  function currentCard() {
    return state.cards.get(baseIdOf(current));
  }

  function currentType() {
    return cardTypeOf(current);
  }

  function speakCurrent() {
    const card = currentCard();
    if (!card) return;
    if (currentType() === 'hear') speak(card.exEs);
    else speak(showingBack && card.exEs ? card.exEs : card.es);
  }

  function showCard() {
    flushNote();
    if (index >= queue.length) {
      finish();
      return;
    }
    current = queue[index];
    const type = currentType();
    const card = currentCard();
    const meta = getCardMeta(current);
    if (!card || meta.suspended || (type === 'hear' && (!card.exEs || getCardMeta(card.id).suspended))) {
      index++;
      showCard();
      return;
    }
    showingBack = false;
    const now = new Date();
    const prog = getProgress(current, now);
    preview = state.sch.preview(prog, now);
    const isNew = state.sch.isNew(prog);
    const status = isNew ? 'Neu' : prog.state === state.sch.State.Review ? 'Wiederholung' : 'Lernen';
    const difficult = isDifficult(prog);
    const meaning = splitMeaning(card.de);
    const noteId = card.id; // Notiz gehört zur Vokabel, auch bei der Hörkarte

    const header = el('div', { class: 'study-head' }, [
      el('span', {}, [
        el('span', { class: `badge ${isNew ? 'badge-new' : 'badge-due'}`, text: status }),
        type !== 'vocab' ? el('span', { class: 'badge badge-type', id: 'type-badge', text: CARD_TYPES[type].label }) : null,
        difficult ? el('span', { class: 'badge badge-leech', id: 'leech-badge', text: 'schwierig' }) : null,
      ]),
      el('span', { class: 'muted', text: `${index + 1} / ${queue.length}` }),
      el('button', { class: 'link', onclick: () => navigate('start'), 'aria-label': 'Lernen beenden', text: 'Beenden' }),
    ]);

    const front =
      type === 'hear'
        ? el('div', { class: 'face front hear-front', id: 'card-front', 'data-type': 'hear', 'data-key': current }, [
            el('button', {
              class: 'speaker huge',
              id: 'hear-play',
              'aria-label': 'Satz vorlesen',
              onclick: (e) => {
                e.stopPropagation();
                speak(card.exEs);
              },
              text: '🔊',
            }),
            el('div', { class: 'muted small-text', text: 'Nur hören – was wurde gesagt?' }),
            el('div', { class: 'btn-row hear-tools' }, [
              el('button', {
                class: 'btn small',
                id: 'hear-again',
                onclick: (e) => {
                  e.stopPropagation();
                  speak(card.exEs);
                },
                text: 'Noch einmal',
              }),
              el('button', {
                class: 'btn small',
                id: 'hear-slow',
                onclick: (e) => {
                  e.stopPropagation();
                  speak(card.exEs, { rate: SLOW_RATE });
                },
                text: 'Langsamer',
              }),
            ]),
          ])
        : el('div', { class: 'face front', id: 'card-front', 'data-type': 'vocab', 'data-key': current }, [
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

    const noteField = el('textarea', {
      class: 'note',
      id: 'note',
      rows: '2',
      placeholder: 'Notiz (nur auf diesem Gerät)',
      'aria-label': 'Notiz zur Karte',
      onclick: (e) => e.stopPropagation(),
      oninput: (e) => {
        pendingNote = { id: noteId, note: e.target.value };
        clearTimeout(noteTimer);
        noteTimer = setTimeout(flushNote, 500);
      },
    });
    noteField.value = getCardMeta(noteId).note || '';

    const exampleBlock = card.exEs
      ? el('div', { class: 'example' }, [
          el('div', { class: 'example-es', lang: 'es' }, [
            el(
              'span',
              { id: 'example-text' },
              type === 'hear' ? highlightWord(card.exEs, card.es).map((seg) => (seg.mark ? el('mark', { text: seg.text }) : seg.text)) : [card.exEs],
            ),
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
      : null;

    const back =
      type === 'hear'
        ? el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'hear' }, [
            exampleBlock,
            el('div', { class: 'hear-word' }, [
              el('span', { class: 'word small', lang: 'es', text: card.es }),
              el('span', { class: 'meaning-main', lang: 'de', text: meaning.main }),
            ]),
            card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
            noteField,
          ])
        : el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'vocab' }, [
            el('div', { class: 'word small', lang: 'es', text: card.es }),
            el('div', { class: 'meaning-main', lang: 'de', text: meaning.main }),
            card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
            meaning.rest ? el('div', { class: 'meaning-rest muted', lang: 'de', text: meaning.rest }) : null,
            exampleBlock,
            noteField,
          ]);
    back.append(
      el('div', { class: 'card-tools' }, [
        el('button', {
          class: 'link',
          id: 'suspend-card',
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm('Karte aussetzen? Sie wird nicht mehr eingeplant (in der Kartenliste wieder aufnehmbar).')) return;
            await setCardMeta(current, { suspended: true });
            toast('Karte ausgesetzt');
            index++;
            showCard();
          },
          text: 'Aussetzen',
        }),
      ]),
    );

    const cardBox = el('div', { class: 'card study-card', role: 'button', tabindex: '0', 'aria-label': 'Karte umdrehen', onclick: flip }, [front, back]);

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
    const undoBtn = el('button', { class: 'btn small', id: 'undo', disabled: state.lastRating ? null : true, onclick: undo, text: 'Rückgängig' });
    const bar = el('div', { class: 'bottom-bar' }, [showBtn, ratings, el('div', { class: 'study-tools' }, [undoBtn])]);

    wrap.replaceChildren(header, cardBox, bar);
    shownAt = performance.now();

    if (type === 'hear') speak(card.exEs);
    else if (state.settings.autoSpeak) speak(card.es);

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
      flushNote();
      const durationMs = performance.now() - shownAt;
      const { after } = await rateCard(current, grade, { durationMs });
      const S = state.sch.State;
      const dueIn = new Date(after.due).getTime() - Date.now();
      lastQueuePush = null;
      if ((after.state === S.Learning || after.state === S.Relearning) && dueIn <= LEARN_AHEAD_MS) {
        queue.push(current); // Lernkarte später in dieser Sitzung erneut zeigen
        lastQueuePush = queue.length - 1;
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

  async function undo() {
    if (busy || !state.lastRating) return;
    busy = true;
    try {
      const id = await undoLastRating();
      if (!id) return;
      if (lastQueuePush !== null && queue[lastQueuePush] === id) {
        queue.splice(lastQueuePush, 1);
        lastQueuePush = null;
      }
      // Karte wieder an der aktuellen Stelle anzeigen.
      const prevIdx = index - 1;
      if (prevIdx >= 0 && queue[prevIdx] === id) index = prevIdx;
      else queue.splice(index, 0, id);
      toast('Bewertung zurückgenommen');
      showCard();
    } catch (e) {
      console.error(e);
      toast(`Rückgängig fehlgeschlagen: ${e.message}`, { error: true });
    } finally {
      busy = false;
    }
  }

  function onKey(e) {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'Enter') {
      if (!showingBack) {
        e.preventDefault();
        document.getElementById('show-answer')?.click();
      }
    } else if (/^[1-4]$/.test(e.key) && showingBack) {
      rate(Number(e.key));
    } else if (k === 'z') {
      undo();
    } else if (k === 's') {
      speakCurrent();
    }
  }
  document.addEventListener('keydown', onKey);

  showCard();
  return {
    destroy() {
      document.removeEventListener('keydown', onKey);
      flushNote();
      stopSpeech();
    },
  };
}
