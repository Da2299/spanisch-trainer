# Spanisch-Trainer

Spanisch-Vokabeltrainer als Web-App (PWA) für das iPhone. Reines HTML, CSS und JavaScript
(ES-Module), kein Build-Schritt. Spaced Repetition mit FSRS über [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).
Keine Server, keine Konten, kein Tracking – alle Daten bleiben auf dem Gerät.

Online-Adresse (GitHub Pages): https://da2299.github.io/spanisch-trainer/

## Bedienung

**Installation auf dem iPhone:** Adresse in Safari öffnen → Teilen-Symbol → „Zum Home-Bildschirm“.
Danach startet die App wie eine native App und funktioniert nach dem ersten Laden auch offline.

**Start:** zeigt *Fällig heute*, *Neu heute*, *Gelernt gesamt* und *Tage in Folge*.
„Lernen starten“ öffnet die Lernsitzung (fällige Karten zuerst, danach neue Karten in Rangreihenfolge,
begrenzt durch das Tageslimit).

**Lernen:** Vorderseite zeigt nur das spanische Wort (wird automatisch vorgelesen, abschaltbar).
Antippen oder „Antwort zeigen“ → Rückseite mit Deutsch, Wortart, Beispielsatz Spanisch (🔊 vorlesen)
und Beispielsatz Deutsch. Bewertung mit **Nochmal / Schwer / Gut / Einfach**; jeder Knopf zeigt das
nächste Intervall. Lernkarten mit kurzem Intervall (Minuten) kommen in derselben Sitzung noch einmal dran.
Tastatur (Desktop): Leertaste = Antwort zeigen, 1–4 = bewerten.

**Karten:** Liste aller Vokabeln mit Suche (Spanisch, Deutsch, Kennung, Wortart, Schlagwort).
Antippen zeigt Details inkl. Lernstand (Fälligkeit, Stabilität, Abrufwahrscheinlichkeit).

**Einstellungen:**
- Neue Karten pro Tag (Standard 20), automatisches Vorlesen an/aus, Sprachtest.
- Vokabelpakete: Übersicht, „Paket importieren (.txt)“ (auf dem iPhone aus der Dateien-App), importierte Pakete entfernen.
- Lernstand: als JSON exportieren (Teilen-Dialog, sonst Download), JSON importieren, „Lernstand zurücksetzen“ (mit Rückfrage).

## Vokabelpakete hinzufügen

Dateiformat: Anki-Textexport, UTF-8, Kopfzeilen beginnen mit `#`, danach Tab-getrennte Zeilen mit 8 Spalten:

```
Kennung  Rang  Spanisch  Deutsch  Wortart  Beispiel_ES  Beispiel_DE  Schlagwörter
ES-0001  1     de        von, aus Präposition  Soy de Madrid.  Ich bin aus Madrid.  grundwortschatz
```

Die **Kennung** (`ES-0001` …) ist der eindeutige Schlüssel. Wird eine Datei erneut geladen oder
importiert, werden die Felder der Karte aktualisiert; der Lernstand bleibt erhalten.

**Variante A – im Repository (für alle Geräte):**
1. Datei `Spanisch_NN_Rang_XXXX-YYYY.txt` in den Ordner `data/` legen.
2. Dateinamen in `data/index.json` eintragen, z. B.
   ```json
   ["Spanisch_01_Rang_0001-0500.txt", "Spanisch_02_Rang_0501-1000.txt"]
   ```
3. In `sw.js` die Konstante `CACHE_VERSION` erhöhen (z. B. `v1` → `v2`), damit installierte Apps den
   Offline-Cache erneuern. Committen und auf `main` pushen.

**Variante B – direkt auf dem Gerät:** Einstellungen → „Paket importieren (.txt)“. Das Paket wird
dauerhaft in IndexedDB gespeichert und beim nächsten Start automatisch wieder geladen.

Ein Beispielpaket mit 30 Einträgen liegt unter `tests/fixtures/beispiel-paket.txt`.

## GitHub-Pages-Einstellung

Repository → **Settings → Pages** → *Build and deployment*: **Source: Deploy from a branch**,
**Branch: `main`**, Ordner **`/ (root)`** → Save. Nach ein bis zwei Minuten ist die App unter
`https://da2299.github.io/spanisch-trainer/` erreichbar. Die App verwendet ausschließlich relative Pfade
und läuft daher unter diesem Unterpfad (und ebenso unter jeder anderen Adresse). Die Datei `.nojekyll`
sorgt dafür, dass GitHub Pages die Dateien unverändert ausliefert.

Nach jeder Änderung an App-Dateien `CACHE_VERSION` in `sw.js` erhöhen. Bereits installierte Apps laden die
neue Version beim nächsten Start mit Netz im Hintergrund und nutzen sie ab dem übernächsten Start.

## Technik

| Bereich | Umsetzung |
| --- | --- |
| Lernalgorithmus | FSRS, ts-fsrs 5.4.2, Standardparameter, Zielretention 0,9. Laden als ES-Modul von `https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/+esm`; bei Fehler oder Zeitüberschreitung die identische lokale Kopie `lib/ts-fsrs.js` (MIT-Lizenz, `lib/LICENSE-ts-fsrs.txt`). Der Service Worker cached das CDN-Modul für den Offline-Betrieb und liefert ohne Netz die lokale Kopie. |
| Fälligkeit | Wiederholungskarten tagesgenau (fällig, wenn das Datum heute oder früher ist); Lern-/Wiederlernkarten minutengenau mit 20 Minuten Vorlauf. „Fällig heute“ auf dem Start zählt beides. |
| Speicherung | IndexedDB (`spanisch-trainer`: `progress`, `packages`, `days`, `meta`), Fallback localStorage. |
| Sprachausgabe | Web Speech API, `es-ES`; bevorzugt eine Stimme mit `lang` `es-ES` (iOS: Mónica/Jorge), sonst eine andere spanische. Stimmen werden über `voiceschanged` nachgeladen, die Wiedergabe wird bei der ersten Berührung freigeschaltet, vor jeder Ausgabe `speechSynthesis.cancel()`. |
| Offline | `sw.js` cached App-Dateien, `data/index.json` und alle dort gelisteten Datendateien beim Installieren; danach Stale-while-revalidate. |
| PWA | `manifest.webmanifest`, iOS-Meta-Tags, Icons 180/192/512 px (`tools/make-icons.py`). |

Dateien: `index.html`, `css/app.css`, `js/app.js` (Status, Router), `js/parser.js` (Anki-Format),
`js/scheduler.js` (FSRS, Warteschlange, Kennzahlen), `js/storage.js`, `js/data.js` (Pakete laden),
`js/speech.js`, `js/views/*.js` (Start, Lernen, Karten, Einstellungen), `sw.js`, `data/`.

## Tests

Die App selbst braucht keine Abhängigkeiten. Für die Tests:

```
npm install            # nur Playwright (Browser: npx playwright install chromium)
npm test               # Unit-Tests: Parser, Scheduler, Kennzahlen (node --test)
npm run test:e2e       # Abnahme im Chromium unter dem Pfad /spanisch-trainer/ (Playwright)
npm run serve          # lokal unter http://localhost:8080/ ausprobieren
```

Der E2E-Test prüft: Laden der Karten und Startzahlen, Bewerten und Erhalt des Lernstands nach Neuladen,
Paket-Import sowie Lernstand-Export/-Import, Offline-Betrieb über den Service Worker und eine fehlerfreie
Browserkonsole.
