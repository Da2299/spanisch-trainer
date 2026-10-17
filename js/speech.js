// Sprachausgabe (Web Speech API, speechSynthesis), Sprache es-ES.
// iOS-Safari: Stimmen werden asynchron geladen (voiceschanged), erste Wiedergabe
// erst nach einer Nutzerberührung, vor jeder Ausgabe speechSynthesis.cancel().

const LANG = 'es-ES';
const PREFERRED_NAMES = ['mónica', 'monica', 'jorge'];

let voices = [];
let unlocked = false;
let initialized = false;

export function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function refreshVoices() {
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    voices = [];
  }
}

/** Einmalig aufrufen: Stimmen laden und Entsperrung bei erster Berührung vorbereiten. */
export function initSpeech() {
  if (initialized || !isSupported()) return;
  initialized = true;
  refreshVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
  if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined' && !window.speechSynthesis.addEventListener) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    try {
      // Leere Äußerung innerhalb der Nutzergeste: schaltet die Wiedergabe auf iOS frei.
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch {
      /* ignorieren */
    }
    document.removeEventListener('touchend', unlock, true);
    document.removeEventListener('click', unlock, true);
  };
  document.addEventListener('touchend', unlock, true);
  document.addEventListener('click', unlock, true);
}

/** Bevorzugte spanische Stimme auswählen. */
export function pickVoice() {
  if (!voices.length) refreshVoices();
  const norm = (s) => (s || '').toLowerCase().replace('_', '-');
  const esES = voices.filter((v) => norm(v.lang) === 'es-es');
  const byName = esES.find((v) => PREFERRED_NAMES.some((n) => (v.name || '').toLowerCase().includes(n)));
  if (byName) return byName;
  if (esES.length) {
    // Lokale (nicht nur Online-)Stimmen bevorzugen.
    return esES.find((v) => v.localService) || esES[0];
  }
  const anyEs = voices.filter((v) => norm(v.lang).startsWith('es'));
  if (anyEs.length) return anyEs.find((v) => v.localService) || anyEs[0];
  return null;
}

/** Text auf Spanisch vorlesen. Gibt false zurück, wenn keine Ausgabe möglich. */
export function speak(text, { rate = 0.95 } = {}) {
  if (!isSupported() || !text) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = LANG;
    u.rate = rate;
    const v = pickVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) {
    console.warn('Sprachausgabe fehlgeschlagen:', e);
    return false;
  }
}

export function stopSpeech() {
  if (isSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignorieren */
    }
  }
}

export function speechStatus() {
  if (!isSupported()) return { supported: false, voice: null, count: 0 };
  refreshVoices();
  const v = pickVoice();
  return { supported: true, voice: v ? `${v.name} (${v.lang})` : null, count: voices.length };
}
