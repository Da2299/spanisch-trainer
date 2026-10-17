// Einstellungen: Tageslimit, Sprachausgabe, Pakete, Lernstand, Info.
import {
  state,
  saveSettings,
  importPackageFile,
  removeImportedPackage,
  exportProgress,
  importProgressJson,
  resetProgress,
  toast,
  rerender,
  APP_VERSION,
} from '../app.js';
import { speak, speechStatus } from '../speech.js';
import { TS_FSRS_VERSION } from '../fsrs-lib.js';
import { el, readFileAsText, formatDate } from '../util.js';

export function renderSettings(main) {
  main.append(el('h1', { class: 'title', text: 'Einstellungen' }));

  // --- Lernen ---
  const newPerDay = el('input', {
    type: 'number',
    id: 'new-per-day',
    min: '0',
    max: '500',
    step: '1',
    inputmode: 'numeric',
    value: String(state.settings.newPerDay),
    onchange: async (e) => {
      let v = Math.round(Number(e.target.value));
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > 500) v = 500;
      e.target.value = String(v);
      await saveSettings({ newPerDay: v });
      toast(`Neue Karten pro Tag: ${v}`);
    },
  });
  const autoSpeak = el('input', {
    type: 'checkbox',
    id: 'auto-speak',
    checked: state.settings.autoSpeak || null,
    onchange: async (e) => {
      await saveSettings({ autoSpeak: !!e.target.checked });
    },
  });
  const ss = speechStatus();
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Lernen' }),
      el('label', { class: 'row', for: 'new-per-day' }, [el('span', { text: 'Neue Karten pro Tag' }), newPerDay]),
      el('label', { class: 'row', for: 'auto-speak' }, [el('span', { text: 'Wort automatisch vorlesen' }), autoSpeak]),
      el('div', { class: 'row' }, [
        el('span', { class: 'muted small-text', text: ss.supported ? (ss.voice ? `Stimme: ${ss.voice}` : 'Spanische Stimme: wird beim ersten Abspielen gewählt') : 'Sprachausgabe nicht verfügbar' }),
        el('button', { class: 'btn small', onclick: () => (speak('Hola, ¿qué tal?') ? null : toast('Keine Sprachausgabe möglich', { error: true })), text: 'Test' }),
      ]),
    ]),
  );

  // --- Pakete ---
  const pkgList = el('ul', { class: 'plain-list', id: 'package-list' });
  function renderPackages() {
    pkgList.replaceChildren(
      ...state.sources.map((s) =>
        el('li', { class: 'row' }, [
          el('div', {}, [
            el('div', { text: s.name }),
            el('div', { class: 'muted small-text', text: `${s.count} Karten · ${s.origin === 'repo' ? 'aus data/' : `importiert ${formatDate(s.importedAt)}`}${s.skipped ? ` · ${s.skipped} Zeilen übersprungen` : ''}` }),
          ]),
          s.origin === 'import'
            ? el('button', {
                class: 'btn small danger',
                onclick: async () => {
                  if (!confirm(`Paket „${s.name}“ entfernen? Der Lernstand der Karten bleibt gespeichert.`)) return;
                  await removeImportedPackage(s.name);
                  renderPackages();
                  toast('Paket entfernt');
                },
                text: 'Entfernen',
              })
            : null,
        ]),
      ),
    );
    if (!state.sources.length) pkgList.append(el('li', { class: 'muted', text: 'Noch keine Pakete.' }));
  }
  renderPackages();
  const pkgInput = el('input', {
    type: 'file',
    id: 'import-package',
    accept: '.txt,text/plain',
    class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const r = await importPackageFile(file);
        renderPackages();
        toast(`${r.name}: ${r.added} neu, ${r.updated} aktualisiert${r.skipped ? `, ${r.skipped} übersprungen` : ''}`, { ms: 5000 });
      } catch (err) {
        console.error(err);
        toast(`Import fehlgeschlagen: ${err.message}`, { error: true, ms: 6000 });
      }
    },
  });
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Vokabelpakete' }),
      pkgList,
      pkgInput,
      el('button', { class: 'btn', id: 'import-package-btn', onclick: () => pkgInput.click(), text: 'Paket importieren (.txt)' }),
      el('p', { class: 'muted small-text', text: 'Anki-Textexport: Kennung, Rang, Spanisch, Deutsch, Wortart, Beispiel ES, Beispiel DE, Schlagwörter (Tab-getrennt, UTF-8). Gleiche Kennung aktualisiert die Felder, der Lernstand bleibt erhalten.' }),
    ]),
  );

  // --- Lernstand ---
  const progInput = el('input', {
    type: 'file',
    id: 'import-progress',
    accept: '.json,application/json',
    class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('Lernstand aus Datei importieren? Einträge gleicher Kennung werden überschrieben.')) return;
      try {
        const text = await readFileAsText(file);
        const r = await importProgressJson(text);
        toast(`Lernstand importiert: ${r.count} Karten`, { ms: 5000 });
      } catch (err) {
        console.error(err);
        toast(`Import fehlgeschlagen: ${err.message}`, { error: true, ms: 6000 });
      }
    },
  });
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Lernstand' }),
      el('p', { class: 'muted small-text', text: `${state.progress.size} Karten mit Lernstand. Gespeichert lokal auf diesem Gerät (${state.storage.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage'}).` }),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn',
          id: 'export-progress',
          onclick: async () => {
            try {
              const how = await exportProgress();
              if (how === 'download') toast('Lernstand als Datei gespeichert');
            } catch (err) {
              toast(`Export fehlgeschlagen: ${err.message}`, { error: true });
            }
          },
          text: 'Exportieren (JSON)',
        }),
        el('button', { class: 'btn', id: 'import-progress-btn', onclick: () => progInput.click(), text: 'Importieren (JSON)' }),
      ]),
      progInput,
      el('button', {
        class: 'btn danger',
        id: 'reset-progress',
        onclick: async () => {
          if (!confirm('Gesamten Lernstand unwiderruflich zurücksetzen? Die Vokabelpakete bleiben erhalten.')) return;
          await resetProgress();
          toast('Lernstand zurückgesetzt');
          rerender();
        },
        text: 'Lernstand zurücksetzen',
      }),
    ]),
  );

  // --- Info ---
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Info' }),
      el('dl', { class: 'kv' }, [
        el('dt', { text: 'Version' }),
        el('dd', { text: APP_VERSION }),
        el('dt', { text: 'Algorithmus' }),
        el('dd', { text: `FSRS (ts-fsrs ${TS_FSRS_VERSION}, ${state.libOrigin === 'cdn' ? 'ES-Modul vom CDN' : 'lokale Kopie'}), Zielretention 90 %` }),
        el('dt', { text: 'Speicher' }),
        el('dd', { text: state.storage.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage (Fallback)' }),
        el('dt', { text: 'Offline' }),
        el('dd', { text: 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'Service Worker aktiv' : 'Service Worker wird eingerichtet') : 'nicht unterstützt' }),
      ]),
      el('p', { class: 'muted small-text', text: 'Keine Server, keine Konten, kein Tracking. Alle Daten bleiben auf dem Gerät.' }),
    ]),
  );
}
