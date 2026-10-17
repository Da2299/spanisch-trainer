// Lädt ts-fsrs bevorzugt vom CDN (ES-Modul); fällt bei Fehler oder Zeitüberschreitung
// auf die lokal mitgelieferte Kopie (lib/ts-fsrs.js) zurück.
// Die Version ist fest gepinnt, damit CDN und lokale Kopie identisch sind.

export const TS_FSRS_VERSION = '5.4.2';
export const TS_FSRS_CDN_URL = `https://cdn.jsdelivr.net/npm/ts-fsrs@${TS_FSRS_VERSION}/+esm`;
const LOCAL_URL = new URL('../lib/ts-fsrs.js', import.meta.url).href; // relativ zu js/
const CDN_TIMEOUT_MS = 8000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function isUsable(mod) {
  return mod && typeof mod.fsrs === 'function' && typeof mod.createEmptyCard === 'function';
}

export async function loadFsrsLibrary() {
  // Für Tests/Node: ohne window immer lokal laden.
  const inBrowser = typeof window !== 'undefined';
  if (inBrowser) {
    try {
      const mod = await withTimeout(import(/* webpackIgnore: true */ TS_FSRS_CDN_URL), CDN_TIMEOUT_MS);
      if (isUsable(mod)) return { mod, origin: 'cdn' };
      throw new Error('CDN-Modul ohne erwartete Exporte');
    } catch (e) {
      console.info('ts-fsrs vom CDN nicht geladen, verwende lokale Kopie:', e && e.message);
    }
  }
  const mod = await import(LOCAL_URL);
  if (!isUsable(mod)) throw new Error('Lokale ts-fsrs-Kopie unbrauchbar');
  return { mod, origin: 'local' };
}
