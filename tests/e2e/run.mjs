// End-to-End-Abnahme mit Playwright (Chromium). Aufruf: node tests/e2e/run.mjs
// Prüft die Abnahmekriterien unter dem Pfad /spanisch-trainer/ (wie auf GitHub Pages).
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFIX = '/spanisch-trainer/';
const OUT = path.join(ROOT, 'tests/e2e/out');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ` – ${detail}` : ''}`);
  if (!cond) throw new Error(`Abnahme fehlgeschlagen: ${name} ${detail}`);
}

async function copyDir(src, dst, skip) {
  await fs.mkdir(dst, { recursive: true });
  for (const e of await fs.readdir(src, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d, new Set());
    else await fs.copyFile(s, d);
  }
}

async function buildSite() {
  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'spanisch-site-'));
  await copyDir(ROOT, site, new Set(['.git', 'node_modules', 'tests', 'tools', 'package.json', 'package-lock.json']));
  const fixture = await fs.readFile(path.join(ROOT, 'tests/fixtures/beispiel-paket.txt'), 'utf8');
  await fs.writeFile(path.join(site, 'data/Spanisch_00_Rang_0001-0030.txt'), fixture);
  await fs.writeFile(path.join(site, 'data/index.json'), JSON.stringify(['Spanisch_00_Rang_0001-0030.txt'], null, 2));
  return site;
}

function startServer(site) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === PREFIX.slice(0, -1)) {
      res.writeHead(301, { Location: PREFIX });
      res.end();
      return;
    }
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not under ' + PREFIX + ': ' + url.pathname);
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(PREFIX.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(site, rel);
    if (!file.startsWith(site)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + rel);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const stat = (page, key) => page.locator(`[data-stat="${key}"] .stat-value`).innerText();
async function stats(page) {
  await page.locator('[data-stat="due"]').waitFor();
  return { due: await stat(page, 'due'), neu: await stat(page, 'new'), learned: await stat(page, 'learned'), streak: await stat(page, 'streak') };
}
const dbg = (page, fn) => page.evaluate(fn);

async function rateOne(page, grade) {
  await page.locator('#card-front .word').waitFor();
  const word = await page.locator('#card-front .word').innerText();
  await page.click('#show-answer');
  await page.click(`[data-grade="${grade}"]`);
  return word;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const site = await buildSite();
  const { server, port } = await startServer(site);
  const base = `http://127.0.0.1:${port}${PREFIX}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  const consoleAll = [];
  const attach = (pg, label = '') => {
    pg.on('console', (m) => {
      const loc = m.location() && m.location().url ? ` @ ${m.location().url}` : '';
      consoleAll.push(`[${m.type()}]${label} ${m.text()}${loc}`);
      if (m.type() === 'error') consoleErrors.push(`${m.text()}${loc}`);
    });
    pg.on('pageerror', (e) => consoleErrors.push(`pageerror${label}: ${e.message}`));
    pg.on('dialog', (d) => d.accept());
  };
  attach(page);

  try {
    // ---- 1. Vorhandene Karten laden, Zahlen auf dem Startbildschirm ----
    await page.goto(base);
    let s = await stats(page);
    check('1a Start unter /spanisch-trainer/ erreichbar', page.url() === base, page.url());
    check('1b Kennzahlen initial (fällig 0, neu 15, gelernt 0, Serie 0)', s.due === '0' && s.neu === '15' && s.learned === '0' && s.streak === '0', JSON.stringify(s));
    const meta = await page.locator('#home-meta').innerText();
    check('1c 30 Karten aus data/index.json geladen', meta.startsWith('30 Karten in 1 Paket'), meta);
    check('1d Kein Sicherungshinweis ohne Lernstand', (await page.locator('#backup-hint').count()) === 0);
    console.log(`     ts-fsrs geladen von: ${await dbg(page, () => window.__spanischTrainer.state.libOrigin)}`);
    await page.screenshot({ path: path.join(OUT, '01-start.png') });

    // ---- S1a. Zielretention ändern → Intervalle ändern sich ----
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    let intervals = await page.locator('#ratings .rate-interval').allInnerTexts();
    check('S1a-1 Intervalle bei Zielretention 90 %', intervals.join(',') === '1 Min,6 Min,10 Min,8 T', intervals.join(','));
    await page.goto(base + '#einstellungen');
    await page.locator('#retention').fill('0.95');
    await page.locator('#toast.show', { hasText: 'Zielretention: 95 %' }).waitFor();
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    intervals = await page.locator('#ratings .rate-interval').allInnerTexts();
    check('S1a-2 Intervalle bei Zielretention 95 % kürzer (Einfach 3 T)', intervals[3] === '3 T' && intervals[2] === '10 Min', intervals.join(','));
    await page.goto(base + '#einstellungen');
    await page.locator('#retention').fill('0.8');
    await page.locator('#toast.show', { hasText: 'Zielretention: 80 %' }).waitFor();
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    intervals = await page.locator('#ratings .rate-interval').allInnerTexts();
    check('S1a-3 Intervalle bei Zielretention 80 % länger (Einfach 28 T)', intervals[3] === '28 T', intervals.join(','));
    await page.goto(base + '#einstellungen');
    await page.locator('#retention').fill('0.9');
    await page.locator('#toast.show', { hasText: 'Zielretention: 90 %' }).waitFor();
    await page.reload();
    check('S1a-4 Zielretention bleibt nach Neuladen gespeichert', (await page.locator('#retention').inputValue()) === '0.9' && (await page.locator('#retention-value').innerText()) === '90 %');
    check('S1a-5 Hinweistext zur Hauptbedeutung vorhanden', (await page.locator('#meaning-hint').innerText()) === 'Bewerte nur die Hauptbedeutung. Wendungen und Nebenbedeutungen sind Zusatzwissen.');
    check('S1a-6 Hörmodus/Verbmodus ausgegraut', (await page.locator('#hearing-mode').isDisabled()) && (await page.locator('#verb-mode').isDisabled()));

    // ---- 2. Bewerten plant neu; Rückseite; Rückgängig; Lernstand überlebt Neuladen ----
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    check('2a Erste neue Karte = Rang 1 („de“), nur Spanisch sichtbar', (await page.locator('#card-front .word').innerText()) === 'de' && (await page.locator('#card-back').isHidden()));
    await page.waitForTimeout(350); // Antwortdauer messbar machen
    await page.click('#show-answer');
    const backText = await page.locator('#card-back').innerText();
    check('2b Rückseite zeigt Deutsch, Wortart, Beispiele, Notizfeld', ['von, aus', 'Präposition', 'Soy de Madrid.', 'Ich bin aus Madrid.'].every((t) => backText.includes(t)) && (await page.locator('#note').count()) === 1, backText.replace(/\n/g, ' | '));
    await page.click('[data-grade="3"]'); // ES-0001 Gut
    await page.locator('#card-front .word').waitFor();
    check('2d Nächste Karte = Rang 2 („que“)', (await page.locator('#card-front .word').innerText()) === 'que');
    await page.click('#show-answer');
    const main2 = await page.locator('#card-back .meaning-main').innerText();
    const rest2 = await page.locator('#card-back .meaning-rest').innerText();
    check('2c Hauptbedeutung „dass“, Rest „der/die/das“', main2 === 'dass' && rest2.startsWith('der/die/das'), `${main2} | ${rest2}`);
    await page.click('[data-grade="4"]'); // ES-0002 Einfach
    await rateOne(page, 3); // ES-0003 Gut
    await rateOne(page, 1); // ES-0004 Nochmal
    const fifth = await rateOne(page, 3); // ES-0005 Gut
    check('2e Fünf Karten bewertet (ES-0005 = „y“)', fifth === 'y', fifth);
    let st = await dbg(page, () => ({ size: window.__spanischTrainer.state.progress.size, reviews: window.__spanischTrainer.state.reviews.length, day: [...window.__spanischTrainer.state.days.values()][0] }));
    check('2f Lernstand + Protokoll: 5 Lernstände, 5 Protokolleinträge, Tag: 5 neu / 5 Bewertungen', st.size === 5 && st.reviews === 5 && st.day.newCount === 5 && st.day.reviewCount === 5, JSON.stringify(st));

    // S1c Rückgängig (Taste Z)
    await page.locator('#card-front .word').waitFor();
    check('S1c-1 Sechste Karte sichtbar („ser“)', (await page.locator('#card-front .word').innerText()) === 'ser');
    await page.keyboard.press('z');
    await page.locator('#toast.show', { hasText: 'zurückgenommen' }).waitFor();
    st = await dbg(page, () => ({ word: document.querySelector('#card-front .word').textContent, size: window.__spanischTrainer.state.progress.size, reviews: window.__spanischTrainer.state.reviews.length, has5: window.__spanischTrainer.state.progress.has('ES-0005'), day: [...window.__spanischTrainer.state.days.values()][0] }));
    check('S1c-2 Rückgängig: ES-0005 wieder angezeigt, Lernstand entfernt, Protokoll 4, Tag 4/4', st.word === 'y' && st.size === 4 && st.reviews === 4 && !st.has5 && st.day.newCount === 4 && st.day.reviewCount === 4, JSON.stringify(st));
    check('S1c-3 Rückgängig-Knopf danach deaktiviert', await page.locator('#undo').isDisabled());
    await page.reload();
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    st = await dbg(page, () => ({ size: window.__spanischTrainer.state.progress.size, reviews: window.__spanischTrainer.state.reviews.length }));
    check('S1c-4 Rückgängig ist persistent (nach Neuladen 4/4)', st.size === 4 && st.reviews === 4, JSON.stringify(st));
    const dueFirst = await rateOne(page, 3); // ES-0004 (Lernkarte, 1 Min) ist zuerst fällig
    check('S1c-5 Nach Neuladen kommt die fällige Lernkarte ES-0004 („la“) zuerst', dueFirst === 'la', dueFirst);
    const w6 = await rateOne(page, 3); // ES-0001 → Review
    const w7 = await rateOne(page, 3); // ES-0003 → Review
    const w8 = await rateOne(page, 3); // ES-0005 (neu) → Lernen
    check('S1c-6 Reihenfolge: fällige Lernkarten, dann neue nach Rang', `${w6},${w7},${w8}` === 'de,el,y', `${w6},${w7},${w8}`);

    // Rückseite: Notiz + Aussetzen über die Lernansicht
    await page.locator('#card-front .word').waitFor(); // ES-0006 ser
    await page.click('#show-answer');
    await page.locator('#note').fill('Merkhilfe für ser');
    await page.waitForTimeout(700);
    st = await dbg(page, () => window.__spanischTrainer.state.cardmeta.get('ES-0006'));
    check('S1-Notiz wird gespeichert', st && st.note === 'Merkhilfe für ser', JSON.stringify(st));
    await page.click('#suspend-card'); // confirm wird akzeptiert
    await page.locator('#toast.show', { hasText: 'ausgesetzt' }).waitFor();
    await page.locator('#card-front .word').waitFor();
    check('S1-Aussetzen aus der Lernansicht: nächste Karte „estar“', (await page.locator('#card-front .word').innerText()) === 'estar');

    await page.goto(base + '#start');
    s = await stats(page);
    check('2g Startzahlen (fällig 2 Lernkarten, neu 10, gelernt 5, Serie 1, 1 ausgesetzt)', s.due === '2' && s.neu === '10' && s.learned === '5' && s.streak === '1' && (await page.locator('#home-meta').innerText()).includes('1 ausgesetzt'), JSON.stringify(s));
    check('2h Sicherungshinweis erscheint (noch keine Sicherung)', (await page.locator('#backup-hint').count()) === 1);
    await page.reload();
    s = await stats(page);
    check('2i Nach Neuladen identisch', s.due === '2' && s.neu === '10' && s.learned === '5' && s.streak === '1', JSON.stringify(s));
    check('2j Speicher ist IndexedDB', (await dbg(page, () => window.__spanischTrainer.state.storage.kind)) === 'indexeddb');

    // ---- S1b. Protokoll als CSV ----
    await page.goto(base + '#einstellungen');
    const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-reviews')]);
    const csvPath = path.join(OUT, csvDl.suggestedFilename());
    await csvDl.saveAs(csvPath);
    const csv = await fs.readFile(csvPath, 'utf8');
    const lines = csv.trim().split('\r\n');
    const hdr = lines[0];
    const rows = lines.slice(1).map((l) => l.split(','));
    const nowMs = Date.now();
    const plausible = rows.every((r) => /^ES-\d{4}$/.test(r[0]) && Math.abs(Number(r[1]) - nowMs) < 600000 && ['1', '2', '3', '4'].includes(r[2]) && ['0', '1', '2', '3'].includes(r[3]) && Number(r[4]) >= 0);
    const durations = rows.map((r) => Number(r[4]));
    const states = rows.map((r) => r[3]).join('');
    check('S1b CSV: Kopfzeile + 8 Zeilen, Spalten card_id,review_time,review_rating,review_state,review_duration, Zustände 0/1 plausibel', hdr === 'card_id,review_time,review_rating,review_state,review_duration' && rows.length === 8 && plausible && states === '00001110' && durations[0] >= 300, `${csvDl.suggestedFilename()}: ${lines.length} Zeilen, Dauern ${durations.join('/')} ms, Bewertungen ${rows.map((r) => r[2]).join('')}, Zustände ${states}`);

    // FSRS-Parameter: ungültig abgelehnt, 19 Werte angenommen
    await page.locator('#fsrs-params').fill('1,2,3');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'Erwartet 17, 19 oder 21' }).waitFor();
    await page.locator('#fsrs-params').fill('0.4,0.6,2.4,5.8,4.93,0.94,0.86,0.01,1.49,0.14,0.94,2.18,0.05,0.34,1.26,0.29,2.61,0.5,0.6');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'übernommen' }).waitFor();
    check('S1-Parameter: 19 Werte aktiv', (await page.locator('#fsrs-params-status').innerText()).includes('19 Werte'));
    await page.locator('#fsrs-params').fill('');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'Standardparameter' }).waitFor();

    // ---- 3. Paket-Import ----
    const extra = ['#separator:tab', '#html:false', '#guid column:1', '#deck column:0', '#tags column:8',
      'ES-0002\t2\tque\tdass (aktualisiert); der/die/das\tKonjunktion\tCreo que sí.\tIch glaube schon.\ttest',
      'ES-0031\t31\tgracias\tdanke\tInterjektion\tMuchas gracias.\tVielen Dank.\ttest',
      'ES-0032\t32\tperdón\tEntschuldigung\tInterjektion\tPerdón, ¿qué hora es?\tEntschuldigung, wie spät ist es?\ttest'].join('\n') + '\n';
    const extraPath = path.join(OUT, 'Spanisch_01_Rang_0031-0032.txt');
    await fs.writeFile(extraPath, extra);
    await page.locator('#import-package').setInputFiles(extraPath);
    await page.locator('#toast.show', { hasText: 'Spanisch_01' }).waitFor();
    const toast1 = await page.locator('#toast').innerText();
    check('3a Paket-Import meldet 2 neu, 1 aktualisiert', toast1.includes('2 neu, 1 aktualisiert'), toast1);
    await page.reload();
    await page.goto(base + '#karten');
    await page.fill('#search', 'gracias');
    check('3b Importierte Karte nach Neuladen auffindbar', (await page.locator('#card-list .list-item').count()) === 1);
    await page.fill('#search', 'ES-0002');
    const li = await page.locator('#card-list .list-item').first().innerText();
    check('3c Erneut geladene Kennung: Felder aktualisiert, Lernstand erhalten (Datum statt „Neu“)', li.includes('dass (aktualisiert)') && !li.includes('Neu'), li.replace(/\n/g, ' | '));
    await page.fill('#search', '');
    await page.click('[data-filter="suspended"]');
    check('3d Filter „Ausgesetzt“ zeigt ES-0006', (await page.locator('#card-list .list-item').count()) === 1 && (await page.locator('#card-list .list-item').first().getAttribute('data-id')) === 'ES-0006');
    await page.click('#card-list .list-item');
    check('3e Detail: Notiz und „Wieder aufnehmen“', (await page.locator('#detail-note').inputValue()) === 'Merkhilfe für ser' && (await page.locator('#detail-suspend').innerText()) === 'Wieder aufnehmen');

    // Leech über 8× Nochmal (per API, Filter in der Liste)
    await dbg(page, async () => {
      for (let i = 0; i < 8; i++) await window.__spanischTrainer.rateCard('ES-0030', 1, { durationMs: 1000 });
    });
    await page.click('[data-filter="difficult"]');
    check('S1-Leech: Filter „Schwierig“ zeigt ES-0030 nach 8× Nochmal', (await page.locator('#card-list .list-item').count()) === 1 && (await page.locator('#card-list .list-item').first().getAttribute('data-id')) === 'ES-0030');

    // Statistik
    await page.goto(base + '#statistik');
    await page.locator('#bars').waitFor();
    const barCount = await page.locator('#bars .bar').count();
    const todayBar = await page.locator('#bars .bar').last().getAttribute('data-count');
    const acc = await page.locator('[data-stat="accuracy"] .stat-value').innerText();
    const byState = await dbg(page, () => Object.fromEntries([...document.querySelectorAll('#by-state dd')].map((d) => [d.dataset.state, d.textContent])));
    const forecastToday = await page.locator('#forecast dd').first().innerText();
    check('S1-Statistik: 30 Balken, heute 16 Bewertungen, 44 % richtig (7 von 16), Zustände 25/3/3/1, Prognose heute 3', barCount === 30 && todayBar === '16' && acc === '44 %' && byState.new === '25' && byState.learning === '3' && byState.review === '3' && byState.suspended === '1' && byState.difficult === '1' && forecastToday === '3', JSON.stringify({ barCount, todayBar, acc, byState, forecastToday }));
    await page.screenshot({ path: path.join(OUT, '03-statistik.png'), fullPage: true });

    // ---- S1d. Sicherung: Export → Löschen → Import → identisch ----
    await page.goto(base + '#start');
    const before = await stats(page);
    const metaBefore = await page.locator('#home-meta').innerText();
    await page.goto(base + '#einstellungen');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-progress')]);
    const exportPath = path.join(OUT, download.suggestedFilename());
    await download.saveAs(exportPath);
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    check('S1d-1 Export-JSON (Format 2) enthält Lernstände, Protokoll, Notizen/Markierungen, Einstellungen', exported.format === 2 && exported.progress.length === 6 && exported.reviews.length === 16 && exported.cardmeta.length === 1 && exported.settings.newPerDay === 15 && exported.settings.requestRetention === 0.9, `${download.suggestedFilename()}: ${exported.progress.length}/${exported.reviews.length}/${exported.cardmeta.length}`);
    await page.goto(base + '#start');
    check('S1d-2 Sicherungshinweis nach Export verschwunden', (await page.locator('#backup-hint').count()) === 0);
    await page.goto(base + '#einstellungen');
    await page.click('#reset-progress');
    await page.locator('#toast.show', { hasText: 'zurückgesetzt' }).waitFor();
    await page.goto(base + '#start');
    s = await stats(page);
    check('S1d-3 Zurücksetzen: gelernt 0, neu 15', s.learned === '0' && s.neu === '15' && s.due === '0', JSON.stringify(s));
    await page.goto(base + '#einstellungen');
    await page.locator('#import-progress').setInputFiles(exportPath);
    await page.locator('#toast.show', { hasText: 'Wiederhergestellt' }).waitFor();
    await page.reload();
    await page.goto(base + '#start');
    s = await stats(page);
    const metaAfter = await page.locator('#home-meta').innerText();
    st = await dbg(page, () => ({ reviews: window.__spanischTrainer.state.reviews.length, note: window.__spanischTrainer.state.cardmeta.get('ES-0006')?.note, susp: window.__spanischTrainer.state.cardmeta.get('ES-0006')?.suspended }));
    check('S1d-4 Nach Import identischer Stand (Startzahlen, Protokoll, Notiz, Markierung)', JSON.stringify(s) === JSON.stringify(before) && metaAfter === metaBefore && st.reviews === 16 && st.note === 'Merkhilfe für ser' && st.susp === true, `${JSON.stringify(s)} vs ${JSON.stringify(before)}; ${JSON.stringify(st)}`);

    // ---- 4. Offline ----
    await page.goto(base);
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const keys = await caches.keys();
      const cache = await caches.open(keys.find((k) => k.startsWith('spanisch-trainer-')));
      const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, cached, keys };
    });
    check('4a Service Worker aktiv mit Scope /spanisch-trainer/', swState.controlled && swState.scope === base, JSON.stringify({ scope: swState.scope, controlled: swState.controlled, keys: swState.keys }));
    check('4b Datendatei, Statistik-Modul und lokale FSRS-Kopie im Cache', ['data/Spanisch_00_Rang_0001-0030.txt', 'lib/ts-fsrs.js', 'js/views/stats.js', 'js/migrate.js'].every((f) => swState.cached.includes(PREFIX + f)), `${swState.cached.length} Einträge`);
    await context.setOffline(true);
    await page.reload();
    s = await stats(page);
    const metaOff = await page.locator('#home-meta').innerText();
    check('4c Offline: App lädt, Karten und Zahlen vorhanden', JSON.stringify(s) === JSON.stringify(before) && metaOff.startsWith('32 Karten in 2 Paketen'), `${JSON.stringify(s)} ${metaOff}`);
    await page.click('#start-study');
    await rateOne(page, 3);
    const offlineState = await dbg(page, () => {
      const st = window.__spanischTrainer.state;
      const today = [...st.days.values()].pop();
      return { reviews: today.reviewCount, log: st.reviews.length };
    });
    check('4d Offline lernen und bewerten funktioniert (17. Bewertung)', offlineState.reviews === 17 && offlineState.log === 17, JSON.stringify(offlineState));
    const page2 = await context.newPage();
    attach(page2, '(page2)');
    await page2.goto(base + '#statistik');
    await page2.locator('#bars').waitFor();
    check('4e Offline: zweite Seite /spanisch-trainer/#statistik lädt', (await page2.locator('#bars .bar').last().getAttribute('data-count')) === '17');
    await page2.close();
    await context.setOffline(false);

    // ---- S1e. Migration eines Lernstands aus der Vorversion (Schema 1) ----
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
    const p3 = await ctx2.newPage();
    attach(p3, '(migration)');
    await p3.goto(base + 'data/index.json');
    await p3.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('spanisch-trainer', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of ['progress', 'packages', 'days', 'meta']) db.createObjectStore(s, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['progress', 'days', 'meta'], 'readwrite');
          tx.objectStore('progress').put({ id: 'ES-0001', due: '2026-10-10T10:00:00.000Z', stability: 8.3, difficulty: 1, elapsed_days: 0, scheduled_days: 8, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '2026-10-02T10:00:00.000Z', firstReview: '2026-10-02T10:00:00.000Z' });
          tx.objectStore('progress').put({ id: 'ES-0002', due: '2099-01-01T10:00:00.000Z', stability: 30, difficulty: 2, elapsed_days: 0, scheduled_days: 30, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: '2026-10-02T10:00:00.000Z' });
          tx.objectStore('days').put({ id: '2026-10-02', newCount: 2, reviewCount: 3 });
          tx.objectStore('meta').put({ id: 'settings', newPerDay: 20, autoSpeak: false });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
    await p3.goto(base);
    s = await stats(p3);
    const mig = await dbg(p3, () => ({ schema: window.__spanischTrainer.state.schema, again: window.__spanischTrainer.state.progress.get('ES-0001').againCount, settings: window.__spanischTrainer.state.settings, version: window.__spanischTrainer.SCHEMA_VERSION }));
    check('S1e Alter Lernstand (Schema 1) übernommen: fällig 1, neu 20 (alte Einstellung), gelernt 2; Schema 1→2; Vorlesen aus bleibt', s.due === '1' && s.neu === '20' && s.learned === '2' && mig.schema.from === 1 && mig.schema.to === 2 && mig.again === 0 && mig.settings.autoSpeak === false && mig.settings.requestRetention === 0.9, `${JSON.stringify(s)} ${JSON.stringify(mig)}`);
    await ctx2.close();

    // ---- 5. Konsole ----
    // Die Sandbox blockiert cdn.jsdelivr.net; der Netzfehler des CDN-Imports ist umgebungsbedingt.
    const ignorable = (t) => /@ https:\/\/cdn\.jsdelivr\.net\//.test(t);
    const real = consoleErrors.filter((t) => !ignorable(t));
    const ignored = consoleErrors.filter(ignorable);
    check('5a Keine Fehler in der Browserkonsole', real.length === 0, real.join(' || ') || `(${ignored.length} CDN-Netzfehler der Sandbox ignoriert)`);
    const absolute = consoleAll.filter((t) => /127\.0\.0\.1:\d+\/(?!spanisch-trainer\/)/.test(t));
    check('5b Keine Anfragen außerhalb von /spanisch-trainer/', absolute.length === 0, absolute.join(' || '));
  } finally {
    await fs.writeFile(path.join(OUT, 'console.log'), consoleAll.join('\n'));
    await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    await browser.close();
    server.close();
    await fs.rm(site, { recursive: true, force: true });
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} Prüfungen bestanden.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
