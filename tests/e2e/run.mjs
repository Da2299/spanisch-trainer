// End-to-End-Abnahme mit Playwright (Chromium). Aufruf: node tests/e2e/run.mjs
// Prüft die fünf Abnahmekriterien unter dem Pfad /spanisch-trainer/ (wie auf GitHub Pages).
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
  page.on('console', (m) => {
    const loc = m.location() && m.location().url ? ` @ ${m.location().url}` : '';
    consoleAll.push(`[${m.type()}] ${m.text()}${loc}`);
    if (m.type() === 'error') consoleErrors.push(`${m.text()}${loc}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());

  try {
    // ---- 1. Vorhandene Karten laden, Zahlen auf dem Startbildschirm ----
    await page.goto(base);
    let s = await stats(page);
    check('1a Start unter /spanisch-trainer/ erreichbar', page.url() === base, page.url());
    check('1b Kennzahlen initial (fällig 0, neu 20, gelernt 0, Serie 0)', s.due === '0' && s.neu === '20' && s.learned === '0' && s.streak === '0', JSON.stringify(s));
    const meta = await page.locator('#home-meta').innerText();
    check('1c 30 Karten aus data/index.json geladen', meta.startsWith('30 Karten in 1 Paket'), meta);
    const libOrigin = await page.evaluate(() => window.__spanischTrainer.state.libOrigin);
    console.log(`     ts-fsrs geladen von: ${libOrigin}`);
    await page.screenshot({ path: path.join(OUT, '01-start.png') });

    // ---- 2. Bewerten plant neu; Lernstand überlebt Neuladen ----
    await page.click('#start-study');
    await page.locator('#card-front .word').waitFor();
    check('2a Erste neue Karte = Rang 1 („de“), nur Spanisch sichtbar', (await page.locator('#card-front .word').innerText()) === 'de' && (await page.locator('#card-back').isHidden()));
    await page.click('#show-answer');
    const backText = await page.locator('#card-back').innerText();
    check('2b Rückseite zeigt Deutsch, Wortart, Beispiele', ['von, aus', 'Präposition', 'Soy de Madrid.', 'Ich bin aus Madrid.'].every((t) => backText.includes(t)), backText.replace(/\n/g, ' | '));
    const intervals = await page.locator('#ratings .rate-interval').allInnerTexts();
    check('2c Vier Bewertungen mit Intervallen', intervals.length === 4 && intervals.join(',') === '1 Min,6 Min,10 Min,8 T', intervals.join(','));
    await page.screenshot({ path: path.join(OUT, '02-rueckseite.png') });
    await page.click('[data-grade="3"]'); // Gut
    await page.locator('#card-front .word').waitFor();
    check('2d Nächste Karte = Rang 2 („que“)', (await page.locator('#card-front .word').innerText()) === 'que');
    await page.click('#show-answer');
    await page.click('[data-grade="4"]'); // Einfach
    await page.locator('#card-front .word').waitFor();
    let prog = await page.evaluate(() => {
      const st = window.__spanischTrainer.state;
      return { size: st.progress.size, p1: st.progress.get('ES-0001'), p2: st.progress.get('ES-0002') };
    });
    check('2e Lernstand im Speicher: ES-0001 Lernen (10 Min), ES-0002 Review (8 T)', prog.size === 2 && prog.p1.state === 1 && prog.p2.state === 2 && prog.p2.scheduled_days === 8, JSON.stringify(prog));
    await page.goto(base + '#start');
    s = await stats(page);
    check('2f Startzahlen nach Bewertung (fällig 1 Lernkarte, neu 18, gelernt 2, Serie 1)', s.due === '1' && s.neu === '18' && s.learned === '2' && s.streak === '1', JSON.stringify(s));
    await page.reload();
    s = await stats(page);
    check('2g Nach Neuladen identisch', s.due === '1' && s.neu === '18' && s.learned === '2' && s.streak === '1', JSON.stringify(s));
    const storageKind = await page.evaluate(() => window.__spanischTrainer.state.storage.kind);
    check('2h Speicher ist IndexedDB', storageKind === 'indexeddb', storageKind);

    // ---- 3. Paket-Import und Lernstand-Export/-Import ----
    const extra = ['#separator:tab', '#html:false', '#guid column:1', '#deck column:0', '#tags column:8',
      'ES-0002\t2\tque\tdass (aktualisiert)\tKonjunktion\tCreo que sí.\tIch glaube schon.\ttest',
      'ES-0031\t31\tgracias\tdanke\tInterjektion\tMuchas gracias.\tVielen Dank.\ttest',
      'ES-0032\t32\tperdón\tEntschuldigung\tInterjektion\tPerdón, ¿qué hora es?\tEntschuldigung, wie spät ist es?\ttest'].join('\n') + '\n';
    const extraPath = path.join(OUT, 'Spanisch_01_Rang_0031-0032.txt');
    await fs.writeFile(extraPath, extra);
    await page.goto(base + '#einstellungen');
    await page.locator('#import-package').setInputFiles(extraPath);
    await page.locator('#toast.show', { hasText: 'Spanisch_01' }).waitFor();
    const toast1 = await page.locator('#toast').innerText();
    check('3a Paket-Import meldet 2 neu, 1 aktualisiert', toast1.includes('2 neu, 1 aktualisiert'), toast1);
    const pkgs = await page.locator('#package-list li').allInnerTexts();
    check('3b Paketliste zeigt 2 Pakete', pkgs.length === 2 && pkgs[1].includes('Spanisch_01_Rang_0031-0032.txt') && pkgs[1].includes('3 Karten'), pkgs.join(' || '));
    await page.reload();
    await page.goto(base + '#karten');
    await page.fill('#search', 'gracias');
    check('3c Importierte Karte nach Neuladen auffindbar', (await page.locator('#card-list .list-item').count()) === 1);
    await page.fill('#search', 'ES-0002');
    const li = await page.locator('#card-list .list-item').first().innerText();
    check('3d Erneut geladene Kennung: Felder aktualisiert, Lernstand erhalten (Datum statt „Neu“)', li.includes('dass (aktualisiert)') && !li.includes('Neu'), li.replace(/\n/g, ' | '));
    await page.goto(base + '#start');
    s = await stats(page);
    check('3e Zahlen nach Import (gelernt weiterhin 2, neu 18 von 32)', s.learned === '2' && s.neu === '18', JSON.stringify(s));

    await page.goto(base + '#einstellungen');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-progress')]);
    const exportPath = path.join(OUT, download.suggestedFilename());
    await download.saveAs(exportPath);
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    check('3f Export-JSON enthält 2 Lernstände + Tagesstatistik', exported.app === 'spanisch-trainer' && exported.progress.length === 2 && exported.days.length === 1 && exported.settings.newPerDay === 20, download.suggestedFilename());
    await page.click('#reset-progress'); // confirm wird akzeptiert
    await page.locator('#toast.show', { hasText: 'zurückgesetzt' }).waitFor();
    await page.goto(base + '#start');
    s = await stats(page);
    check('3g Zurücksetzen: gelernt 0, neu 20', s.learned === '0' && s.neu === '20', JSON.stringify(s));
    await page.goto(base + '#einstellungen');
    await page.locator('#import-progress').setInputFiles(exportPath);
    await page.locator('#toast.show', { hasText: 'Lernstand importiert' }).waitFor();
    const toast2 = await page.locator('#toast').innerText();
    check('3h Lernstand-Import meldet 2 Karten', toast2.includes('2 Karten'), toast2);
    await page.reload();
    await page.goto(base + '#start');
    s = await stats(page);
    check('3i Zahlen nach Lernstand-Import wiederhergestellt (fällig 1, neu 18, gelernt 2, Serie 1)', s.due === '1' && s.neu === '18' && s.learned === '2' && s.streak === '1', JSON.stringify(s));

    // ---- 4. Offline ----
    await page.goto(base);
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const keys = await caches.keys();
      const cache = await caches.open(keys.find((k) => k.startsWith('spanisch-trainer-')));
      const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, cached };
    });
    check('4a Service Worker aktiv mit Scope /spanisch-trainer/', swState.controlled && swState.scope === base, JSON.stringify({ scope: swState.scope, controlled: swState.controlled }));
    check('4b Datendatei und lokale FSRS-Kopie im Cache', swState.cached.includes(PREFIX + 'data/Spanisch_00_Rang_0001-0030.txt') && swState.cached.includes(PREFIX + 'lib/ts-fsrs.js'), `${swState.cached.length} Einträge`);
    await context.setOffline(true);
    await page.reload();
    s = await stats(page);
    const metaOff = await page.locator('#home-meta').innerText();
    check('4c Offline: App lädt, Karten und Zahlen vorhanden', s.learned === '2' && metaOff.startsWith('32 Karten in 2 Paketen'), `${JSON.stringify(s)} ${metaOff}`);
    await page.click('#start-study');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    await page.click('[data-grade="3"]');
    await page.locator('#card-front .word').waitFor();
    const offlineState = await page.evaluate(() => {
      const st = window.__spanischTrainer.state;
      const today = [...st.days.values()].pop();
      return { reviews: today.reviewCount, reps1: st.progress.get('ES-0001').reps };
    });
    check('4d Offline lernen und bewerten funktioniert (3. Bewertung, ES-0001 jetzt 2 Wiederholungen)', offlineState.reviews === 3 && offlineState.reps1 === 2, JSON.stringify(offlineState));
    const page2 = await context.newPage();
    page2.on('pageerror', (e) => consoleErrors.push(`pageerror(page2): ${e.message}`));
    await page2.goto(base + '#karten');
    await page2.locator('#browse-info').waitFor();
    check('4e Offline: zweite Seite /spanisch-trainer/#karten lädt', (await page2.locator('#browse-info').innerText()).includes('32 Karten'));
    await page2.screenshot({ path: path.join(OUT, '04-offline-karten.png') });
    await page2.close();
    await context.setOffline(false);

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
