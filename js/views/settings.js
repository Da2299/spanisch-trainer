// Einstellungen: Lernlast, FSRS, Sprachausgabe, Pakete, Sicherung, Protokoll, Info.
import {
  state,
  saveSettings,
  importPackageFile,
  removeImportedPackage,
  exportProgress,
  exportReviewsCsv,
  importBackupJson,
  resetProgress,
  toast,
  rerender,
  APP_VERSION,
  DEFAULT_SETTINGS,
} from '../app.js';
import { speak, speechStatus } from '../speech.js';
import { TS_FSRS_VERSION } from '../fsrs-lib.js';
import { parseFsrsParams, clampRetention } from '../scheduler.js';
import { SCHEMA_VERSION } from '../migrate.js';
import { el, readFileAsText, formatDate } from '../util.js';

export const MEANING_HINT = 'Bewerte nur die Hauptbedeutung. Wendungen und Nebenbedeutungen sind Zusatzwissen.';

function pct(x) {
  return `${Math.round(x * 100)} %`;
}

export function renderSettings(main) {
  main.append(el('h1', { class: 'title', text: 'Einstellungen' }));

  // --- Lernen ---
  const newPerDay = el('input', {
    type: 'number',
    id: 'new-per-day',
    min: '0',
    max: '50',
    step: '1',
    inputmode: 'numeric',
    value: String(state.settings.newPerDay),
    onchange: async (e) => {
      let v = Math.round(Number(e.target.value));
      if (!Number.isFinite(v) || v < 0) v = 0;
      if (v > 50) v = 50;
      e.target.value = String(v);
      await saveSettings({ newPerDay: v });
      toast(`Neue Karten pro Tag: ${v}`);
    },
  });
  const retentionValue = el('span', { class: 'value', id: 'retention-value', text: pct(state.settings.requestRetention) });
  const retention = el('input', {
    type: 'range',
    id: 'retention',
    min: '0.80',
    max: '0.95',
    step: '0.01',
    value: String(state.settings.requestRetention),
    'aria-label': 'Zielretention',
    oninput: (e) => {
      retentionValue.textContent = pct(Number(e.target.value));
    },
    onchange: async (e) => {
      const v = clampRetention(e.target.value);
      e.target.value = String(v);
      retentionValue.textContent = pct(v);
      await saveSettings({ requestRetention: v });
      toast(`Zielretention: ${pct(v)}`);
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
  const hearingMode = el('input', { type: 'checkbox', id: 'hearing-mode', disabled: true, checked: state.settings.hearingMode || null });
  const verbMode = el('input', { type: 'checkbox', id: 'verb-mode', disabled: true, checked: state.settings.verbMode || null });
  const ss = speechStatus();
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Lernen' }),
      el('label', { class: 'row', for: 'new-per-day' }, [el('span', { text: 'Neue Karten pro Tag (0–50)' }), newPerDay]),
      el('div', { class: 'row column' }, [
        el('label', { for: 'retention', class: 'row-inline' }, [el('span', { text: 'Zielretention (80–95 %)' }), retentionValue]),
        retention,
        el('span', { class: 'muted small-text', text: 'Höher = kürzere Intervalle und mehr Wiederholungen. Gilt für alle künftigen Planungen; bestehende Fälligkeiten bleiben.' }),
      ]),
      el('label', { class: 'row', for: 'auto-speak' }, [el('span', { text: 'Wort automatisch vorlesen' }), autoSpeak]),
      el('div', { class: 'row' }, [
        el('span', { class: 'muted small-text', text: ss.supported ? (ss.voice ? `Stimme: ${ss.voice}` : 'Spanische Stimme: wird beim ersten Abspielen gewählt') : 'Sprachausgabe nicht verfügbar' }),
        el('button', { class: 'btn small', onclick: () => (speak('Hola, ¿qué tal?') ? null : toast('Keine Sprachausgabe möglich', { error: true })), text: 'Test' }),
      ]),
      el('label', { class: 'row disabled', for: 'hearing-mode' }, [el('span', { text: 'Hörmodus (kommt mit Stufe 2)' }), hearingMode]),
      el('label', { class: 'row disabled', for: 'verb-mode' }, [el('span', { text: 'Verbmodus (kommt mit Stufe 3)' }), verbMode]),
      el('p', { class: 'hint-box', id: 'meaning-hint', text: MEANING_HINT }),
    ]),
  );

  // --- FSRS-Parameter ---
  const paramsField = el('textarea', {
    class: 'note mono',
    id: 'fsrs-params',
    rows: '3',
    placeholder: 'leer = Standardparameter; sonst 17, 19 oder 21 Werte, kommagetrennt',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    'aria-label': 'FSRS-Parameter',
  });
  paramsField.value = state.settings.fsrsParams || '';
  const paramsStatus = el('p', { class: 'muted small-text', id: 'fsrs-params-status', text: state.sch.customW ? `Eigene Parameter aktiv (${state.sch.customW.length} Werte).` : 'Standardparameter aktiv.' });
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'FSRS-Parameter' }),
      el('p', { class: 'muted small-text', text: 'Hier können die vom FSRS-Optimizer berechneten Werte eingetragen werden (Eingabe: das exportierte Protokoll).' }),
      paramsField,
      paramsStatus,
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn',
          id: 'fsrs-params-save',
          onclick: async () => {
            const text = paramsField.value.trim();
            const { w, error } = parseFsrsParams(text);
            if (error) {
              toast(error, { error: true, ms: 6000 });
              return;
            }
            await saveSettings({ fsrsParams: text });
            paramsStatus.textContent = w ? `Eigene Parameter aktiv (${w.length} Werte).` : 'Standardparameter aktiv.';
            toast(w ? 'FSRS-Parameter übernommen' : 'Standardparameter aktiv');
          },
          text: 'Übernehmen',
        }),
        el('button', {
          class: 'btn',
          id: 'export-reviews',
          onclick: async () => {
            if (!state.reviews.length) {
              toast('Noch keine Bewertungen im Protokoll');
              return;
            }
            try {
              const how = await exportReviewsCsv();
              if (how === 'download') toast(`Protokoll mit ${state.reviews.length} Einträgen gespeichert`);
            } catch (err) {
              toast(`Export fehlgeschlagen: ${err.message}`, { error: true });
            }
          },
          text: 'Protokoll exportieren (CSV)',
        }),
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
      el('p', { class: 'muted small-text', text: 'Anki-Textexport: Kennung, Rang, Spanisch, Deutsch, Wortart, Beispiel ES, Beispiel DE, Schlagwörter (Tab-getrennt, UTF-8). Alle Pakete bilden einen Lernstrom nach Rang. Gleiche Kennung aktualisiert die Felder (auch den Rang), der Lernstand bleibt erhalten.' }),
    ]),
  );

  // --- Sicherung ---
  const progInput = el('input', {
    type: 'file',
    id: 'import-progress',
    accept: '.json,application/json',
    class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      if (!confirm('Sicherung wiederherstellen? Der bisherige Lernstand auf diesem Gerät wird vollständig ersetzt.')) return;
      try {
        const text = await readFileAsText(file);
        const r = await importBackupJson(text);
        toast(`Wiederhergestellt: ${r.progress} Lernstände, ${r.reviews} Protokolleinträge, ${r.cardmeta} Notizen/Markierungen`, { ms: 6000 });
        rerender();
      } catch (err) {
        console.error(err);
        toast(`Import fehlgeschlagen: ${err.message}`, { error: true, ms: 6000 });
      }
    },
  });
  main.append(
    el('section', { class: 'card' }, [
      el('h2', { text: 'Sicherung' }),
      el('p', { class: 'muted small-text', id: 'backup-status', text: `${state.progress.size} Lernstände, ${state.reviews.length} Protokolleinträge, ${state.cardmeta.size} Notizen/Markierungen. Letzte Sicherung: ${state.backup.lastExportAt ? formatDate(state.backup.lastExportAt) : 'noch keine'}. Gespeichert lokal (${state.storage.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage'}).` }),
      el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn',
          id: 'export-progress',
          onclick: async () => {
            try {
              const how = await exportProgress();
              if (how === 'download') toast('Sicherung als Datei gespeichert');
              if (how !== 'abgebrochen') rerender();
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
          if (!confirm('Gesamten Lernstand, Protokoll, Notizen und Markierungen unwiderruflich löschen? Die Vokabelpakete bleiben erhalten.')) return;
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
        el('dd', { text: `${APP_VERSION} (Speicherschema ${SCHEMA_VERSION})` }),
        el('dt', { text: 'Algorithmus' }),
        el('dd', { text: `FSRS (ts-fsrs ${TS_FSRS_VERSION}, ${state.libOrigin === 'cdn' ? 'ES-Modul vom CDN' : 'lokale Kopie'}), Zielretention ${pct(state.sch.requestRetention)}` }),
        el('dt', { text: 'Speicher' }),
        el('dd', { text: state.storage.kind === 'indexeddb' ? 'IndexedDB' : 'localStorage (Fallback)' }),
        el('dt', { text: 'Offline' }),
        el('dd', { text: 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'Service Worker aktiv' : 'Service Worker wird eingerichtet') : 'nicht unterstützt' }),
        el('dt', { text: 'Tastatur' }),
        el('dd', { text: 'Leertaste/Enter = Antwort, 1–4 = bewerten, Z = Rückgängig, S = vorlesen' }),
      ]),
      el('p', { class: 'muted small-text', text: 'Keine Server, keine Konten, kein Tracking. Alle Daten bleiben auf dem Gerät.' }),
    ]),
  );
}
