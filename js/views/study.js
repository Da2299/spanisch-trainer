// Lernsitzung: eine Einheit von N Karten eines Lernmodus (Vokabeln, Hören, Verben) mit Fortschritt und Abschluss.
// Vorderseite: Wort (bzw. nur Ton / Lückentext), Rückseite: Hauptbedeutung, Wortart, Beispiel; „Mehr“ zeigt
// Nebenbedeutungen, Notiz und Aussetzen. Bewertung mit zwei Knöpfen (Vergessen/Gewusst) oder vier Stufen.
// Tastatur: Leertaste/Enter = Antwort zeigen, 1–4 = bewerten (einfach: 1 = Vergessen, 2/3 = Gewusst),
// Z = Rückgängig, S = vorlesen, M = Mehr.
import { state, plan, rateCard, undoLastRating, getProgress, getCardMeta, setCardMeta, navigate, rerender, toast, estimateMinutes } from '../app.js';
import { RATINGS, SIMPLE_RATINGS, LEARN_AHEAD_MS, isDifficult, cardTypeOf, baseIdOf, CARD_TYPES } from '../scheduler.js';
import { speak, stopSpeech } from '../speech.js';
import { el, formatInterval, splitMeaning, highlightWord } from '../util.js';
import { compareAnswer } from '../verbs.js';

const SLOW_RATE = 0.8;

export function renderStudy(main, param = '') {
  const sessionType = CARD_TYPES[param] ? param : 'vocab';
  const p = plan();
  const size = Math.max(1, Number(state.settings.sessionSize) || 15);
  const queue = p.sessions[sessionType].entries.slice(0, size).map((e) => e.key);
  const plannedCount = queue.length;
  const simple = state.settings.ratingMode !== 'full';
  const ratingSet = simple ? SIMPLE_RATINGS : RATINGS;
  let index = 0;
  let done = 0; // Karten, die in dieser Sitzung (erstmals) bewertet wurden
  let ratingsCount = 0; // alle Bewertungen inkl. Lernschritte
  let known = 0; // davon Bewertung >= 2
  const seen = new Set(); // Kartenschlüssel mit erster Bewertung in dieser Sitzung
  let lastWasFirst = false;
  let showingBack = false;
  let busy = false;
  let current = null;
  let preview = null;
  let shownAt = 0;
  let noteTimer = null;
  let pendingNote = null;
  let lastQueuePush = null;
  let preselected = null;
  const startedAt = Date.now();

  const wrap = el('div', { class: 'study', 'data-session': sessionType });
  main.append(wrap);

  function flushNote() {
    clearTimeout(noteTimer);
    if (pendingNote) {
      const { id, note } = pendingNote;
      pendingNote = null;
      setCardMeta(id, { note }).catch((e) => console.error(e));
    }
  }

  function currentType() {
    return cardTypeOf(current);
  }
  function currentForm() {
    return currentType() === 'verb' ? state.verbForms.get(current) || null : null;
  }
  function currentCard() {
    const form = currentForm();
    if (form) return state.cards.get(form.verb.kennung) || null;
    return state.cards.get(baseIdOf(current));
  }
  function speakCurrent() {
    const form = currentForm();
    if (form) {
      speak(showingBack ? form.form : form.sentence ? form.sentence.gap.replace(/____ \([^)]*\)/, '…') : form.verb.lemma);
      return;
    }
    const card = currentCard();
    if (!card) return;
    if (currentType() === 'hear') speak(card.exEs);
    else if (currentType() === 'back') speak(showingBack ? card.es : '');
    else speak(showingBack && card.exEs ? card.exEs : card.es);
  }

  // ---------- Kopf mit Fortschritt ----------
  function header(extraBadges = []) {
    const total = plannedCount;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const extraSteps = done >= total ? Math.max(0, queue.length - index) : 0; // verbleibende Lernschritte
    return el('div', { class: 'study-head' }, [
      el('span', { class: 'study-badges' }, extraBadges),
      el('span', { class: 'progress', id: 'session-progress', 'data-done': String(done), 'data-total': String(total), 'data-steps': String(extraSteps) }, [
        el('span', { class: 'progress-text', text: extraSteps ? `${done} / ${total} · noch ${extraSteps}` : `${done} / ${total}` }),
        el('span', { class: 'progress-bar' }, [el('span', { class: 'progress-fill', style: `width:${pct}%` })]),
      ]),
      el('button', { class: 'link', onclick: () => navigate('start'), 'aria-label': 'Sitzung beenden', text: 'Beenden' }),
    ]);
  }

  // ---------- Abschluss ----------
  function finish() {
    stopSpeech();
    flushNote();
    const q = plan();
    const left = q.sessions[sessionType].total;
    const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    const pct = ratingsCount ? Math.round((known / ratingsCount) * 100) : 0;
    wrap.replaceChildren(
      el('div', { class: 'done', id: 'session-done' }, [
        el('h2', { text: done ? 'Sitzung beendet' : 'Nichts zu lernen' }),
        done
          ? el('div', { class: 'stats' }, [
              el('div', { class: 'stat' }, [el('div', { class: 'stat-value', id: 'done-count', text: String(done) }), el('div', { class: 'stat-label', text: 'Karten' })]),
              el('div', { class: 'stat' }, [el('div', { class: 'stat-value', id: 'done-pct', text: `${pct} %` }), el('div', { class: 'stat-label', text: 'gewusst' })]),
            ])
          : null,
        el('p', { class: 'muted', id: 'done-left', text: left ? `${left} Karten warten heute noch (etwa ${estimateMinutes(left)} Min).` : `Für heute ist in „${CARD_TYPES[sessionType].session}“ alles erledigt.` }),
        done ? el('p', { class: 'muted small-text', id: 'done-detail', text: `${ratingsCount} Bewertungen · ${minutes} Min` }) : null,
      ]),
      el('div', { class: 'bottom-bar' }, [
        left ? el('button', { class: 'btn primary big', id: 'next-session', onclick: () => rerender(), text: `Weitere Sitzung (${Math.min(left, size)})` }) : null,
        state.lastRating ? el('button', { class: 'btn', id: 'undo', onclick: undo, text: 'Rückgängig' }) : null,
        el('button', { class: 'btn big', onclick: () => navigate('start'), text: 'Zum Start' }),
      ]),
    );
  }

  // ---------- Karte anzeigen ----------
  function showCard() {
    flushNote();
    if (index >= queue.length) {
      finish();
      return;
    }
    current = queue[index];
    const type = currentType();
    const form = currentForm();
    const card = currentCard();
    const meta = getCardMeta(current);
    const skip = type === 'verb' ? !form || meta.suspended || getCardMeta(form.verb.kennung).suspended : !card || meta.suspended || (type === 'hear' && (!card.exEs || getCardMeta(card.id).suspended));
    if (skip) {
      index++;
      showCard();
      return;
    }
    showingBack = false;
    preselected = null;
    const now = new Date();
    const prog = getProgress(current, now);
    preview = state.sch.preview(prog, now);
    const isNew = state.sch.isNew(prog);
    const status = isNew ? 'Neu' : prog.state === state.sch.State.Review ? 'Wiederholung' : 'Lernen';
    const badges = [
      el('span', { class: `badge ${isNew ? 'badge-new' : 'badge-due'}`, text: status }),
      isDifficult(prog) ? el('span', { class: 'badge badge-leech', id: 'leech-badge', text: 'schwierig' }) : null,
    ];
    const noteId = card ? card.id : current; // Notiz gehört zur Vokabel
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
    const suspendBtn = el('button', {
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
    });

    let front;
    let back;
    let moreContent = [];
    if (type === 'verb') {
      ({ front, back, moreContent } = verbFaces(form, card, noteField, suspendBtn));
    } else {
      const meaning = splitMeaning(card.de);
      const exampleBlock = card.exEs
        ? el('div', { class: 'example' }, [
            el('div', { class: 'example-es', lang: 'es' }, [
              el('span', { id: 'example-text' }, type === 'hear' ? highlightWord(card.exEs, card.es).map((seg) => (seg.mark ? el('mark', { text: seg.text }) : seg.text)) : [card.exEs]),
              el('button', { class: 'speaker inline', 'aria-label': 'Beispielsatz vorlesen', onclick: (e) => (e.stopPropagation(), speak(card.exEs)), text: '🔊' }),
            ]),
            card.exDe ? el('div', { class: 'example-de muted', lang: 'de', text: card.exDe }) : null,
          ])
        : null;
      if (type === 'back') {
        // Rückwärts: Deutsch vorn (Hauptbedeutung + Wortart), Spanisch hinten (vorgelesen)
        front = el('div', { class: 'face front back-front', id: 'card-front', 'data-type': 'back', 'data-key': current }, [
          el('div', { class: 'meaning-main big', id: 'back-meaning', lang: 'de', text: meaning.main }),
          card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
          el('div', { class: 'muted small-text', text: 'Wie heißt das auf Spanisch? Laut sagen, dann Antwort zeigen' }),
        ]);
        back = el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'back' }, [
          el('div', { class: 'verb-answer' }, [
            el('div', { class: 'word', id: 'back-word', lang: 'es', text: card.es }),
            el('button', { class: 'speaker', 'aria-label': 'Wort vorlesen', onclick: (e) => (e.stopPropagation(), speak(card.es)), text: '🔊' }),
          ]),
          el('div', { class: 'meaning-main small', lang: 'de', text: meaning.main }),
          exampleBlock,
        ]);
      } else if (type === 'hear') {
        front = el('div', { class: 'face front hear-front', id: 'card-front', 'data-type': 'hear', 'data-key': current }, [
          el('button', { class: 'speaker huge', id: 'hear-play', 'aria-label': 'Satz vorlesen', onclick: (e) => (e.stopPropagation(), speak(card.exEs)), text: '🔊' }),
          el('div', { class: 'muted small-text', text: 'Nur hören – was wurde gesagt?' }),
          el('div', { class: 'btn-row hear-tools' }, [
            el('button', { class: 'btn small', id: 'hear-again', onclick: (e) => (e.stopPropagation(), speak(card.exEs)), text: 'Noch einmal' }),
            el('button', { class: 'btn small', id: 'hear-slow', onclick: (e) => (e.stopPropagation(), speak(card.exEs, { rate: SLOW_RATE })), text: 'Langsamer' }),
          ]),
        ]);
        back = el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'hear' }, [
          exampleBlock,
          el('div', { class: 'hear-word' }, [el('span', { class: 'word small', lang: 'es', text: card.es }), el('span', { class: 'meaning-main', lang: 'de', text: meaning.main })]),
          card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
        ]);
      } else {
        front = el('div', { class: 'face front', id: 'card-front', 'data-type': 'vocab', 'data-key': current }, [
          el('div', { class: 'word', lang: 'es', text: card.es }),
          el('button', { class: 'speaker', 'aria-label': 'Wort vorlesen', onclick: (e) => (e.stopPropagation(), speak(card.es)), text: '🔊' }),
        ]);
        back = el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'vocab' }, [
          el('div', { class: 'word small', lang: 'es', text: card.es }),
          el('div', { class: 'meaning-main', lang: 'de', text: meaning.main }),
          card.pos ? el('div', { class: 'pos', text: card.pos }) : null,
          exampleBlock,
        ]);
      }
      moreContent = [meaning.rest ? el('div', { class: 'meaning-rest muted', lang: 'de', text: meaning.rest }) : null, noteField, el('div', { class: 'card-tools' }, [suspendBtn])];
    }

    // „Mehr“: Nebenbedeutungen, Notiz, Aussetzen (standardmäßig eingeklappt)
    const more = el('div', { class: 'more hidden', id: 'more' }, moreContent);
    const moreBtn = el('button', {
      class: 'link more-toggle',
      id: 'more-toggle',
      onclick: (e) => {
        e.stopPropagation();
        toggleMore();
      },
      text: 'Mehr',
    });
    back.append(el('div', { class: 'card-tools' }, [moreBtn]), more);

    const tipMode = type === 'verb' && !!state.settings.tipMode;
    const cardBox = el('div', { class: 'card study-card', role: 'button', tabindex: '0', 'aria-label': 'Karte umdrehen', onclick: () => (tipMode ? null : flip()) }, [front, back]);

    const ratings = el(
      'div',
      { class: `ratings ratings-${simple ? 'simple' : 'full'} hidden`, id: 'ratings' },
      ratingSet.map((r) =>
        el('button', { class: `btn rate rate-${r.key}`, 'data-grade': String(r.grade), onclick: () => rate(r.grade) }, [
          el('span', { class: 'rate-label', text: r.label }),
          el('span', { class: 'rate-interval', text: formatInterval(preview[r.grade].intervalMs) }),
        ]),
      ),
    );
    const confirmBtn = el('button', { class: 'btn primary big hidden', id: 'confirm-rating', onclick: () => rate(preselected), text: 'Bestätigen' });
    const undoBtn = el('button', { class: 'btn small', id: 'undo', disabled: state.lastRating ? null : true, onclick: undo, text: 'Rückgängig' });
    let showBtn;
    let tipInput = null;
    if (tipMode) {
      tipInput = el('input', {
        type: 'text',
        id: 'tip-input',
        class: 'tip-input',
        lang: 'es',
        placeholder: 'Form eingeben …',
        autocomplete: 'off',
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        'aria-label': 'Form eingeben',
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            checkTip();
          }
        },
      });
      showBtn = el('div', { class: 'tip-row', id: 'tip-row' }, [tipInput, el('button', { class: 'btn primary', id: 'tip-check', onclick: checkTip, text: 'Prüfen' })]);
    } else {
      showBtn = el('button', { class: 'btn primary big', id: 'show-answer', onclick: flip, text: 'Antwort zeigen' });
    }
    const bar = el('div', { class: 'bottom-bar' }, [showBtn, confirmBtn, ratings, el('div', { class: 'study-tools' }, [undoBtn])]);

    wrap.replaceChildren(header(badges), cardBox, bar);
    shownAt = performance.now();
    if (tipInput) tipInput.focus();
    if (type === 'hear') speak(card.exEs);
    else if (type === 'vocab' && state.settings.autoSpeak) speak(card.es);

    function reveal() {
      showingBack = true;
      front.classList.add('hidden');
      back.classList.remove('hidden');
      showBtn.classList.add('hidden');
      ratings.classList.remove('hidden');
      if (type === 'verb') speak(form.form);
      else if (type === 'back') speak(card.es);
    }
    function flip() {
      if (!showingBack) reveal();
    }
    function toggleMore() {
      const open = more.classList.toggle('hidden');
      moreBtn.textContent = open ? 'Mehr' : 'Weniger';
    }
    function checkTip() {
      if (showingBack) return;
      const { correct, expected, given } = compareAnswer(tipInput.value, form.form);
      preselected = correct ? 3 : 1;
      const result = back.querySelector('#tip-result');
      result.replaceChildren(
        el('div', { class: `tip-verdict ${correct ? 'ok' : 'wrong'}`, id: 'tip-verdict', text: correct ? 'Richtig' : 'Falsch' }),
        correct
          ? null
          : el('div', { class: 'tip-diff', lang: 'es' }, [
              el('span', { class: 'muted small-text', text: 'Eingabe: ' }),
              el('span', { id: 'tip-given' }, given.length ? given.map((c) => el('span', { class: c.diff ? 'diff' : '', text: c.ch })) : [el('span', { class: 'muted', text: '(leer)' })]),
              el('span', { class: 'muted small-text', text: ' · richtig: ' }),
              el('span', { id: 'tip-expected' }, expected.map((c) => el('span', { class: c.diff ? 'diff' : '', text: c.ch }))),
            ]),
      );
      result.classList.remove('hidden');
      reveal();
      ratings.querySelectorAll('.rate').forEach((b) => b.classList.toggle('preselected', Number(b.dataset.grade) === preselected));
      confirmBtn.textContent = `Bestätigen: ${ratingSet.find((r) => r.grade === preselected).label}`;
      confirmBtn.classList.remove('hidden');
    }
    wrap.__toggleMore = toggleMore;
  }

  /** Vorder- und Rückseite einer Verbformkarte. */
  function verbFaces(form, card, noteField, suspendBtn) {
    const verb = form.verb;
    const personTempus = [form.person, form.tempus].filter(Boolean).join(' · ');
    const tipMode = !!state.settings.tipMode;
    const front = el('div', { class: 'face front verb-front', id: 'card-front', 'data-type': 'verb', 'data-key': current }, [
      form.sentence ? el('div', { class: 'gap-sentence', id: 'gap-sentence', lang: 'es', text: form.sentence.gap }) : el('div', { class: 'word', id: 'verb-lemma', lang: 'es', text: verb.lemma }),
      el('div', { class: 'form-meta', id: 'form-meta', text: personTempus }),
      el('div', { class: 'muted small-text', text: tipMode ? 'Form eintippen' : 'Form laut sprechen, dann Antwort zeigen' }),
    ]);
    const back = el('div', { class: 'face back hidden', id: 'card-back', 'data-type': 'verb' }, [
      el('div', { class: 'tip-result hidden', id: 'tip-result' }),
      el('div', { class: 'verb-answer' }, [
        el('div', { class: 'word', id: 'verb-form', lang: 'es', text: form.form }),
        el('button', { class: 'speaker', 'aria-label': 'Form vorlesen', onclick: (e) => (e.stopPropagation(), speak(form.form)), text: '🔊' }),
      ]),
      el('div', { class: 'form-meta', text: `${verb.lemma} · ${personTempus}` }),
      form.unregelmaessig
        ? el('div', { class: 'irregular-hint', id: 'irregular-hint' }, [el('span', { class: 'badge badge-irregular', text: 'unregelmäßig' }), verb.muster.length ? el('span', { class: 'muted small-text', text: ` Muster: ${verb.muster.join(' · ')}` }) : null])
        : null,
      form.sentence
        ? el('div', { class: 'example' }, [
            el('div', { class: 'example-es', lang: 'es' }, [
              el('span', { id: 'example-text' }, form.sentence.segments.map((seg) => (seg.mark ? el('mark', { text: seg.text }) : seg.text))),
              el('button', { class: 'speaker inline', 'aria-label': 'Beispielsatz vorlesen', onclick: (e) => (e.stopPropagation(), speak(form.sentence.es)), text: '🔊' }),
            ]),
            form.sentence.de ? el('div', { class: 'example-de muted', lang: 'de', text: form.sentence.de }) : null,
          ])
        : null,
    ]);
    const moreContent = [
      el('div', { class: 'card-tools' }, [el('a', { class: 'link', id: 'verb-table-link', href: `#verb/${encodeURIComponent(verb.lemma)}`, text: `Alle Formen von ${verb.lemma}` })]),
      noteField,
      el('div', { class: 'card-tools' }, [suspendBtn]),
    ];
    return { front, back, moreContent };
  }

  // ---------- Bewerten / Rückgängig ----------
  async function rate(grade) {
    if (busy || !showingBack || !grade) return;
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
      lastWasFirst = !seen.has(current);
      if (lastWasFirst) {
        seen.add(current);
        done++;
      }
      ratingsCount++;
      if (grade >= 2) known++;
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
      const last = state.lastRating;
      const id = await undoLastRating();
      if (!id) return;
      if (lastQueuePush !== null && queue[lastQueuePush] === id) {
        queue.splice(lastQueuePush, 1);
        lastQueuePush = null;
      }
      if (lastWasFirst && done > 0) {
        done--;
        seen.delete(id);
      }
      lastWasFirst = false;
      ratingsCount = Math.max(0, ratingsCount - 1);
      if (last.review.rating >= 2) known = Math.max(0, known - 1);
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
      } else if (e.key === 'Enter' && preselected) {
        e.preventDefault();
        rate(preselected);
      }
    } else if (/^[1-4]$/.test(e.key) && showingBack) {
      const n = Number(e.key);
      rate(simple ? (n === 1 ? 1 : 3) : n);
    } else if (k === 'z') {
      undo();
    } else if (k === 's') {
      speakCurrent();
    } else if (k === 'm' && showingBack && wrap.__toggleMore) {
      wrap.__toggleMore();
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
