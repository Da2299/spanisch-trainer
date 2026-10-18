// End-to-End-Abnahme mit Playwright (Chromium). Aufruf: node tests/e2e/run.mjs
// Prüft die Abnahmekriterien der Stufen 1–4 unter dem Pfad /spanisch-trainer/ (wie auf GitHub Pages).
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

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
let base = '';
const stat = (page, key) => page.locator(`[data-stat="${key}"] .stat-value`).innerText();
/** Kennzahlen von der Statistikseite. */
/** Ansicht neu aufbauen, falls der Hash bereits passt (hashchange feuert dann nicht). */
async function go(page, hash) {
  await page.goto(base + hash);
  await page.locator('#view').waitFor();
  await page.evaluate(() => window.__spanischTrainer && window.__spanischTrainer.state.ready && window.__spanischTrainer.rerender());
}
async function stats(page) {
  await go(page, '#statistik');
  await page.locator('[data-stat="due"]').waitFor();
  return { due: await stat(page, 'due'), neu: await stat(page, 'new'), learned: await stat(page, 'learned'), streak: await stat(page, 'streak') };
}
/** Startseite: Zusammenfassung und Modi. */
async function home(page) {
  await go(page, '#start');
  await page.locator('#today-summary').waitFor();
  const sum = page.locator('#today-summary');
  const out = { total: await sum.getAttribute('data-total'), due: await sum.getAttribute('data-due'), new: await sum.getAttribute('data-new'), minutes: await sum.getAttribute('data-minutes'), text: await sum.innerText(), modes: {} };
  for (const t of ['vocab', 'hear', 'verb']) {
    const b = page.locator(`#start-${t}`);
    if (await b.count()) out.modes[t] = { count: await b.getAttribute('data-count'), disabled: await b.isDisabled() };
  }
  out.meta = (await page.locator('#home-meta').count()) ? await page.locator('#home-meta').innerText() : '';
  return out;
}
/** Einstellungen öffnen, Bereich „Erweitert“ aufklappen. */
async function settings(page) {
  await page.goto(base + '#einstellungen');
  await page.locator('#advanced').waitFor();
  if (!(await page.locator('#advanced').evaluate((d) => d.open))) await page.click('#advanced summary');
}
async function setNumber(page, id, value, toastText) {
  await page.locator(id).fill(String(value));
  await page.locator(id).dispatchEvent('change');
  await page.locator('#toast.show', { hasText: toastText }).waitFor();
}
async function rateOne(page, grade) {
  await page.locator('#card-front').waitFor();
  const word = (await page.locator('#card-front .word').count()) ? await page.locator('#card-front .word').innerText() : await page.locator('#card-front').getAttribute('data-key');
  await page.click('#show-answer');
  await page.click(`[data-grade="${grade}"]`);
  return word;
}
async function openMore(page) {
  if (await page.locator('#more').evaluate((m) => m.classList.contains('hidden'))) await page.click('#more-toggle');
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const site = await buildSite();
  const { server, port } = await startServer(site);
  base = `http://127.0.0.1:${port}${PREFIX}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', acceptDownloads: true });
  await context.addInitScript(() => {
    window.__spoken = [];
    if (window.speechSynthesis) {
      const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
      window.speechSynthesis.speak = (u) => {
        window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang });
        return orig(u);
      };
    }
  });
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
    // ---- 1. Laden, Start, Statistik ----
    await page.goto(base);
    let h = await home(page);
    check('1a Start unter /spanisch-trainer/ erreichbar', page.url() === base + '#start' || page.url() === base, page.url());
    check('1b Start zeigt eine Zusammenfassung (15 Karten, etwa 5 Min) und den Knopf „Lernen (15)“', h.total === '15' && h.due === '0' && h.new === '15' && h.minutes === '5' && h.text.startsWith('Heute: 15 Karten') && h.modes.vocab.count === '15' && !h.modes.vocab.disabled, JSON.stringify(h));
    check('1c Keine Kacheln/Typtabelle auf dem Start; Hören/Verben erst sichtbar, wenn dort etwas ist (Hinweis statt Knöpfe)', (await page.locator('[data-stat]').count()) === 0 && (await page.locator('#type-table').count()) === 0 && !h.modes.hear && !h.modes.verb && (await page.locator('#locked-hint').innerText()).startsWith('Hören und Verben werden frei'), JSON.stringify(h.modes));
    check('1d 30 Karten geladen, kein Sicherungshinweis ohne Lernstand', h.meta.startsWith('30 Karten') && (await page.locator('#backup-hint').count()) === 0, h.meta);
    let s = await stats(page);
    check('1e Statistik: fällig 0, neu 15, gelernt 0, Serie 0; Typtabelle vorhanden', s.due === '0' && s.neu === '15' && s.learned === '0' && s.streak === '0' && (await page.locator('#type-table').count()) === 1, JSON.stringify(s));
    check('1f Vier Tabs (ohne Statistik)', (await page.locator('#tabs a').count()) === 4);
    console.log(`     ts-fsrs geladen von: ${await dbg(page, () => window.__spanischTrainer.state.libOrigin)}`);
    await page.goto(base + '#start');
    await page.screenshot({ path: path.join(OUT, '01-start.png') });

    // ---- Stufe 4: zwei Knöpfe, Sitzung mit Ende, Mehr ----
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    const simpleButtons = await page.locator('#ratings .rate-label').allInnerTexts();
    const simpleGrades = await dbg(page, () => [...document.querySelectorAll('#ratings .rate')].map((b) => b.dataset.grade));
    check('S4-1 Standard: zwei Knöpfe Vergessen/Gewusst (Bewertung 1 und 3) mit Intervall', simpleButtons.join(',') === 'Vergessen,Gewusst' && simpleGrades.join(',') === '1,3' && (await page.locator('#ratings .rate-interval').allInnerTexts()).join(',') === '1 Min,10 Min', simpleButtons.join(','));
    check('S4-2 Rückseite ohne Nebenbedeutungen/Notiz/Aussetzen; „Mehr“ klappt sie auf', (await page.locator('#more').evaluate((m) => m.classList.contains('hidden'))) && (await page.locator('#more-toggle').innerText()) === 'Mehr');
    await page.keyboard.press('m');
    check('S4-3 Taste M öffnet „Mehr“ mit Notizfeld und Aussetzen', !(await page.locator('#more').evaluate((m) => m.classList.contains('hidden'))) && (await page.locator('#more #note').count()) === 1 && (await page.locator('#more #suspend-card').count()) === 1);
    await page.screenshot({ path: path.join(OUT, '02-rueckseite.png') });
    await page.keyboard.press('2'); // einfach: 2 = Gewusst (3)
    await page.locator('#card-front .word').waitFor();
    let lastR = await dbg(page, () => window.__spanischTrainer.state.reviews.slice(-1)[0]);
    check('S4-4 Taste 2 im einfachen Modus = Gewusst (Bewertung 3)', lastR.rating === 3 && lastR.cardId === 'ES-0001');
    const prog = await dbg(page, () => ({ done: document.querySelector('#session-progress').dataset.done, total: document.querySelector('#session-progress').dataset.total }));
    check('S4-5 Fortschritt in der Sitzung (1 / 15)', prog.done === '1' && prog.total === '15', JSON.stringify(prog));
    await page.keyboard.press('z');
    await page.locator('#toast.show', { hasText: 'zurückgenommen' }).waitFor();
    check('S4-6 Rückgängig setzt den Fortschritt zurück', (await page.locator('#session-progress').getAttribute('data-done')) === '0' && (await page.locator('#card-front .word').innerText()) === 'de');
    // Sitzung mit 5 Karten bis zum Ende
    await settings(page);
    await setNumber(page, '#session-size', 5, 'Karten pro Sitzung: 5');
    await page.goto(base + '#lernen');
    let steps = 0;
    let stepsText = '';
    for (let i = 0; i < 15; i++) {
      await page.locator('#card-front:not(.hidden), #session-done').first().waitFor();
      if (await page.locator('#session-done').count()) break;
      if (i === 5) stepsText = await page.locator('#session-progress .progress-text').innerText();
      await rateOne(page, 3);
      steps++;
    }
    await page.locator('#session-done').waitFor();
    const doneScreen = { count: await page.locator('#done-count').innerText(), pct: await page.locator('#done-pct').innerText(), left: await page.locator('#done-left').innerText(), next: await page.locator('#next-session').innerText(), detail: await page.locator('#done-detail').innerText(), steps, stepsText };
    check('S4-7 Sitzung mit 5 neuen Karten: 10 Bewertungen (Lernschritte), Fortschritt „5 / 5 · noch 5“, Abschluss 5 Karten, 100 % gewusst, Rest 10, „Weitere Sitzung (5)“', doneScreen.count === '5' && doneScreen.pct === '100 %' && doneScreen.left.startsWith('10 Karten warten') && doneScreen.next === 'Weitere Sitzung (5)' && steps === 10 && stepsText === '5 / 5 · noch 5' && doneScreen.detail.startsWith('10 Bewertungen'), JSON.stringify(doneScreen));
    await page.screenshot({ path: path.join(OUT, '03-sitzung-ende.png') });
    await page.click('#next-session');
    await page.locator('#card-front .word').waitFor();
    check('S4-8 „Weitere Sitzung“ startet die nächste Einheit mit 0 / 5', (await page.locator('#session-progress').getAttribute('data-done')) === '0' && (await page.locator('#session-progress').getAttribute('data-total')) === '5');
    // Für die weiteren Prüfungen: vier Stufen, große Sitzung
    await settings(page);
    await page.locator('#rating-mode').selectOption('full');
    await page.locator('#toast.show', { hasText: 'Vier Bewertungsstufen' }).waitFor();
    await setNumber(page, '#session-size', 100, 'Karten pro Sitzung: 100');
    check('S4-9 Einstellungen: oben nur Lernen und Sicherung, Rest unter „Erweitert“', (await page.locator('#advanced #rating-mode').count()) === 1 && (await page.locator('#advanced #retention').count()) === 1 && (await page.locator('#advanced #fsrs-params').count()) === 1 && (await page.locator('#advanced #import-package-btn').count()) === 1 && (await page.locator('#advanced #reset-progress').count()) === 1 && (await page.locator('#export-progress').count()) === 1 && (await page.locator('#hearing-mode').count()) === 0 && (await page.locator('#verb-mode').count()) === 0);
    check('S4-10 Hinweistext zur Hauptbedeutung vorhanden', (await page.locator('#meaning-hint').innerText()) === 'Bewerte nur die Hauptbedeutung. Wendungen und Nebenbedeutungen sind Zusatzwissen.');

    // ---- S1a. Zielretention ----
    const intervalsAt = async (rr, label) => {
      await settings(page);
      await page.locator('#retention').fill(String(rr));
      await page.locator('#toast.show', { hasText: `Zielretention: ${label}` }).waitFor();
      await page.goto(base + '#lernen');
      await page.locator('#card-front .word').waitFor();
      await page.click('#show-answer');
      return (await page.locator('#ratings .rate-interval').allInnerTexts()).join(',');
    };
    const iv95 = await intervalsAt(0.95, '95 %');
    const iv80 = await intervalsAt(0.8, '80 %');
    const iv90 = await intervalsAt(0.9, '90 %');
    check('S1a Zielretention ändert die Intervalle (Einfach bei neuer Karte: 3 T / 28 T / 8 T)', iv95.endsWith(',3 T') && iv80.endsWith(',28 T') && iv90 === '1 Min,6 Min,10 Min,8 T', `${iv95} | ${iv80} | ${iv90}`);
    await page.reload();
    await settings(page);
    check('S1a-2 Zielretention bleibt nach Neuladen', (await page.locator('#retention').inputValue()) === '0.9' && (await page.locator('#retention-value').innerText()) === '90 %');

    // ---- 2. Bewerten (vier Stufen), Rückseite, Rückgängig, Protokoll ----
    // Stand: ES-0001..ES-0005 sind nach zwei Lernschritten im Zustand Review, ES-0006 ff. neu.
    await page.goto(base + '#lernen');
    await page.locator('#card-front .word').waitFor();
    const firstKey = await page.locator('#card-front').getAttribute('data-key');
    check('2a Nichts fällig → erste neue Karte nach Rang (ES-0006 „ser“)', firstKey === 'ES-0006', firstKey);
    await page.click('#show-answer');
    const backText = await page.locator('#card-back').innerText();
    check('2b Rückseite: Hauptbedeutung, Wortart, Beispiel; Nebenbedeutungen erst unter „Mehr“', (await page.locator('#card-back .meaning-main').count()) === 1 && (await page.locator('#card-back .example').count()) === 1 && (await page.locator('#more .meaning-rest, #more #note').count()) >= 1, backText.replace(/\n/g, ' | '));
    await page.click('[data-grade="3"]'); // ser
    const w7 = await rateOne(page, 1); // estar
    check('2c Neue Karten nach Rang (estar folgt auf ser)', w7 === 'estar', w7);
    await page.locator('#card-front .word').waitFor();
    await page.waitForTimeout(350);
    await page.click('#show-answer');
    const main8 = await page.locator('#card-back .meaning-main').innerText();
    await openMore(page);
    const rest8 = await page.locator('#more .meaning-rest').innerText();
    check('2d ES-0008 tener: Hauptbedeutung „haben“, Rest „tener que + Infinitiv = müssen“', main8 === 'haben' && rest8.startsWith('tener que'), `${main8} | ${rest8}`);
    await page.locator('#note').fill('Merkhilfe für tener');
    await page.waitForTimeout(700);
    let st = await dbg(page, () => window.__spanischTrainer.state.cardmeta.get('ES-0008'));
    check('2e Notiz wird gespeichert', st && st.note === 'Merkhilfe für tener', JSON.stringify(st));
    await page.click('[data-grade="3"]');
    await page.locator('#card-front .word').waitFor();
    st = await dbg(page, () => ({ size: window.__spanischTrainer.state.progress.size, reviews: window.__spanischTrainer.state.reviews.length, word: document.querySelector('#card-front .word').textContent }));
    check('2f Lernstand 8 Karten, Protokoll 13 Einträge (5 + 5 + 3)', st.size === 8 && st.reviews === 13, JSON.stringify(st));
    await page.keyboard.press('z');
    await page.locator('#toast.show', { hasText: 'zurückgenommen' }).waitFor();
    st = await dbg(page, () => ({ word: document.querySelector('#card-front .word').textContent, size: window.__spanischTrainer.state.progress.size, reviews: window.__spanischTrainer.state.reviews.length }));
    check('2g Rückgängig: tener wieder angezeigt, Lernstand 7, Protokoll 12', st.word === 'tener' && st.size === 7 && st.reviews === 12, JSON.stringify(st));
    await page.waitForTimeout(400); // Antwortdauer messbar machen
    await page.click('#show-answer');
    await page.click('[data-grade="3"]');
    await page.locator('#card-front .word').waitFor();
    await page.click('#show-answer');
    await openMore(page);
    await page.click('#suspend-card');
    await page.locator('#toast.show', { hasText: 'ausgesetzt' }).waitFor();
    await page.locator('#card-front .word').waitFor();
    check('2h Aussetzen aus der Lernansicht (ES-0009 hacer): nächste Karte „poder“ (ES-0010)', (await page.locator('#card-front .word').innerText()) === 'poder');
    h = await home(page);
    check('2i Start: Rest heute und „1 ausgesetzt“, Sicherungshinweis erscheint', h.meta.includes('1 ausgesetzt') && (await page.locator('#backup-hint').count()) === 1 && Number(h.total) > 0, JSON.stringify(h));
    s = await stats(page);
    check('2j Statistik: 3 Lernkarten fällig (ser, estar, tener), gelernt 8, Serie 1', s.learned === '8' && s.streak === '1' && s.due === '3', JSON.stringify(s));
    await page.reload();
    const s2 = await stats(page);
    check('2k Nach Neuladen identisch', JSON.stringify(s2) === JSON.stringify(s), JSON.stringify(s2));
    check('2l Speicher ist IndexedDB', (await dbg(page, () => window.__spanischTrainer.state.storage.kind)) === 'indexeddb');

    // ---- S1b. Protokoll als CSV, FSRS-Parameter ----
    await settings(page);
    const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-reviews')]);
    const csvPath = path.join(OUT, csvDl.suggestedFilename());
    await csvDl.saveAs(csvPath);
    const lines = (await fs.readFile(csvPath, 'utf8')).trim().split('\r\n');
    const rows = lines.slice(1).map((l) => l.split(','));
    const nowMs = Date.now();
    const plausible = rows.every((r) => /^ES-\d{4}$/.test(r[0]) && Math.abs(Number(r[1]) - nowMs) < 900000 && ['1', '2', '3', '4'].includes(r[2]) && ['0', '1', '2', '3'].includes(r[3]) && Number(r[4]) >= 0);
    check('S1b CSV: Kopfzeile card_id,review_time,review_rating,review_state,review_duration + 13 Zeilen mit plausiblen Werten', lines[0] === 'card_id,review_time,review_rating,review_state,review_duration' && rows.length === 13 && plausible && rows.some((r) => Number(r[4]) >= 300), `${lines.length} Zeilen, Zustände ${rows.map((r) => r[3]).join('')}`);
    await page.locator('#fsrs-params').fill('1,2,3');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'Erwartet 17, 19 oder 21' }).waitFor();
    await page.locator('#fsrs-params').fill('0.4,0.6,2.4,5.8,4.93,0.94,0.86,0.01,1.49,0.14,0.94,2.18,0.05,0.34,1.26,0.29,2.61,0.5,0.6');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'übernommen' }).waitFor();
    check('S1-Parameter: ungültig abgewiesen, 19 Werte aktiv', (await page.locator('#fsrs-params-status').innerText()).includes('19 Werte'));
    await page.locator('#fsrs-params').fill('');
    await page.click('#fsrs-params-save');
    await page.locator('#toast.show', { hasText: 'Standardparameter' }).waitFor();

    // ---- 3. Paket-Import, Kartenliste, Leeches ----
    const extra = ['#separator:tab', '#html:false', '#guid column:1', '#deck column:0', '#tags column:8',
      'ES-0002\t2\tque\tdass (aktualisiert); der/die/das\tKonjunktion\tCreo que sí.\tIch glaube schon.\ttest',
      'ES-0031\t31\tgracias\tdanke\tInterjektion\tMuchas gracias.\tVielen Dank.\ttest',
      'ES-0032\t32\tperdón\tEntschuldigung\tInterjektion\tPerdón, ¿qué hora es?\tEntschuldigung, wie spät ist es?\ttest'].join('\n') + '\n';
    const extraPath = path.join(OUT, 'Spanisch_01_Rang_0031-0032.txt');
    await fs.writeFile(extraPath, extra);
    await page.locator('#import-package').setInputFiles(extraPath);
    await page.locator('#toast.show', { hasText: 'Spanisch_01' }).waitFor();
    check('3a Paket-Import meldet 2 neu, 1 aktualisiert', (await page.locator('#toast').innerText()).includes('2 neu, 1 aktualisiert'));
    await page.reload();
    await page.goto(base + '#karten');
    await page.fill('#search', 'gracias');
    check('3b Importierte Karte nach Neuladen auffindbar', (await page.locator('#card-list .list-item').count()) === 1);
    await page.fill('#search', 'ES-0002');
    const li = await page.locator('#card-list .list-item').first().innerText();
    check('3c Erneut geladene Kennung: Felder aktualisiert, Lernstand erhalten', li.includes('dass (aktualisiert)') && !li.includes('Neu'), li.replace(/\n/g, ' | '));
    await page.fill('#search', '');
    await page.click('[data-filter="suspended"]');
    check('3d Filter „Ausgesetzt“ zeigt ES-0009', (await page.locator('#card-list .list-item').count()) === 1 && (await page.locator('#card-list .list-item').first().getAttribute('data-id')) === 'ES-0009');
    await page.click('#card-list .list-item');
    check('3e Detail: „Wieder aufnehmen“', (await page.locator('#detail-suspend').innerText()) === 'Wieder aufnehmen');
    await dbg(page, async () => {
      for (let i = 0; i < 8; i++) await window.__spanischTrainer.rateCard('ES-0030', 1, { durationMs: 1000 });
    });
    await page.click('[data-filter="difficult"]');
    check('3f Filter „Schwierig“ zeigt ES-0030 nach 8× Nochmal', (await page.locator('#card-list .list-item').count()) === 1 && (await page.locator('#card-list .list-item').first().getAttribute('data-id')) === 'ES-0030');

    // ---- Statistik ----
    await page.goto(base + '#statistik');
    await page.locator('#bars').waitFor();
    const statsInfo = await dbg(page, () => ({ bars: document.querySelectorAll('#bars .bar').length, today: document.querySelector('#bars .bar-col:last-child .bar').dataset.count, acc: document.querySelector('[data-stat="accuracy"] .stat-value').textContent, byState: Object.fromEntries([...document.querySelectorAll('#by-state dd')].map((d) => [d.dataset.state, d.textContent])), reviews: window.__spanischTrainer.state.reviews.length }));
    check('S1-Statistik: 30 Balken, heute = alle Bewertungen, Trefferquote, Zustände mit 1 ausgesetzt / 1 schwierig', statsInfo.bars === 30 && Number(statsInfo.today) === statsInfo.reviews && /%/.test(statsInfo.acc) && statsInfo.byState.suspended === '1' && statsInfo.byState.difficult === '1', JSON.stringify(statsInfo));
    await page.screenshot({ path: path.join(OUT, '04-statistik.png'), fullPage: true });

    // ---- S1d. Sicherung: Export → Löschen → Import → identisch ----
    let before = await stats(page);
    let homeBefore = await home(page);
    await settings(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-progress')]);
    const exportPath = path.join(OUT, download.suggestedFilename());
    await download.saveAs(exportPath);
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    check('S1d-1 Export (Format 2): Lernstände, Protokoll, Notizen/Markierungen, Einstellungen inkl. ratingMode/sessionSize', exported.format === 2 && exported.progress.length === 9 && exported.reviews.length === statsInfo.reviews && exported.cardmeta.length === 2 && exported.settings.ratingMode === 'full' && exported.settings.sessionSize === 100, `${exported.progress.length}/${exported.reviews.length}/${exported.cardmeta.length}`);
    await page.locator('#toast.show', { hasText: 'Sicherung als Datei' }).waitFor();
    check('S1d-2 Sicherungshinweis nach Export verschwunden', (await page.goto(base + '#start'), await page.locator('#today-summary').waitFor(), (await page.locator('#backup-hint').count()) === 0));
    await settings(page);
    await page.click('#reset-progress');
    await page.locator('#toast.show', { hasText: 'zurückgesetzt' }).waitFor();
    s = await stats(page);
    check('S1d-3 Zurücksetzen: gelernt 0, neu 15', s.learned === '0' && s.neu === '15' && s.due === '0', JSON.stringify(s));
    await settings(page);
    await page.locator('#import-progress').setInputFiles(exportPath);
    await page.locator('#toast.show', { hasText: 'Wiederhergestellt' }).waitFor();
    await page.reload();
    s = await stats(page);
    const homeAfter = await home(page);
    st = await dbg(page, () => ({ reviews: window.__spanischTrainer.state.reviews.length, note: window.__spanischTrainer.state.cardmeta.get('ES-0008')?.note, susp: window.__spanischTrainer.state.cardmeta.get('ES-0009')?.suspended }));
    check('S1d-4 Nach Import identischer Stand (Statistik, Start, Protokoll, Notiz, Markierung)', JSON.stringify(s) === JSON.stringify(before) && homeAfter.text === homeBefore.text && st.reviews === statsInfo.reviews && st.note === 'Merkhilfe für tener' && st.susp === true, `${JSON.stringify(s)} vs ${JSON.stringify(before)}`);

    // ---- Stufe 2: Hören als eigener Modus ----
    h = await home(page);
    const hearNew = await dbg(page, () => window.__spanischTrainer.plan().types.hear);
    check('S2a-1 Start: „Hören“ als eigener Einstieg, so viele Karten wie Review-Vokabeln mit Beispielsatz', h.modes.hear && h.modes.hear.count === String(hearNew.unseen) && Number(h.modes.hear.count) >= 5 && !h.modes.hear.disabled, JSON.stringify({ hear: h.modes.hear, hearNew }));
    const vocabSession = await dbg(page, () => window.__spanischTrainer.plan().sessions.vocab.entries.map((e) => e.type));
    check('S2c Vokabelsitzung enthält keine Hör-/Verbkarten (ein Modus zur Zeit)', vocabSession.every((t) => t === 'vocab'), [...new Set(vocabSession)].join(','));
    await page.click('#start-hear');
    await page.locator('#card-front[data-type="hear"]').waitFor();
    const hearCardId = (await page.locator('#card-front').getAttribute('data-key')).replace(/:H$/, '');
    const hearCard = await dbg(page, (id) => window.__spanischTrainer.state.cards.get(id), hearCardId);
    const frontText = (await page.locator('#card-front').innerText()).replace(/\s+/g, ' ').trim();
    const spokenBefore = await dbg(page, () => window.__spoken.slice(-1)[0]);
    check('S2b-1 Hörkarte: Vorderseite ohne Text, nur Lautsprecher und Knöpfe', (await page.locator('#card-front .word').count()) === 0 && frontText === '🔊 Nur hören – was wurde gesagt? Noch einmal Langsamer', frontText);
    check('S2b-2 Beispielsatz automatisch vorgelesen (es-ES)', spokenBefore && spokenBefore.text === hearCard.exEs && spokenBefore.lang === 'es-ES', JSON.stringify(spokenBefore));
    await page.click('#hear-slow');
    const slow = await dbg(page, () => window.__spoken.slice(-1)[0]);
    check('S2b-3 „Langsamer“ liest mit Tempo 0,8', slow.text === hearCard.exEs && Math.abs(slow.rate - 0.8) < 1e-6, JSON.stringify(slow));
    await page.click('#show-answer');
    const markText = await page.locator('#card-back[data-type="hear"] #example-text mark').allInnerTexts();
    const backHear = await page.locator('#card-back').innerText();
    check('S2b-4 Rückseite: Satz mit markiertem Lernwort, deutscher Satz, Lernwort + Hauptbedeutung', markText.length === 1 && hearCard.exEs.toLowerCase().includes(markText[0].toLowerCase()) && backHear.includes(hearCard.exDe) && backHear.includes(hearCard.es), `mark=„${markText[0]}“`);
    await page.click('[data-grade="3"]');
    await page.locator('#card-front').waitFor();
    const hearReview = await dbg(page, () => window.__spanischTrainer.state.reviews.slice(-1)[0]);
    check('S2b-5 Hörkarte mit eigenem Lernstand (Kennung:H) und Kartentyp „hear“ im Protokoll', hearReview.cardType === 'hear' && hearReview.cardId === hearCardId + ':H');
    await page.goto(base + '#statistik');
    await page.locator('#type-table tr[data-type="hear"]').waitFor();
    const hearCol = await dbg(page, () => Object.fromEntries([...document.querySelectorAll('#by-state-table td[data-type="hear"]')].map((td) => [td.dataset.state, Number(td.textContent)])));
    check('S2e Statistik je Modus: Spalte Hören (1 lernen)', hearCol.learning === 1 && hearCol.new >= 4, JSON.stringify(hearCol));
    await settings(page);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#export-progress')]);
    const exp2Path = path.join(OUT, 'export-stufe2.json');
    await dl2.saveAs(exp2Path);
    const exp2 = JSON.parse(await fs.readFile(exp2Path, 'utf8'));
    check('S2d Export enthält Lernstand beider Typen', exp2.progress.some((p) => p.id.endsWith(':H')) && exp2.progress.some((p) => !p.id.includes(':')) && exp2.settings.newHearPerDay === 10);
    await page.locator('#toast.show', { hasText: 'Sicherung als Datei' }).waitFor();

    // ---- Stufe 3: Verben als eigener Modus ----
    await page.reload();
    await page.goto(base + '#start');
    await page.locator('#today-summary').waitFor();
    await dbg(page, async () => {
      await window.__spanischTrainer.rateCard('ES-0011', 4, { durationMs: 1000 }); // tener → Review
    });
    h = await home(page);
    const verbPlan = await dbg(page, () => window.__spanischTrainer.plan().types.verb);
    check('S3a-1 ES-0011 (tener) in Review → Einstieg „Verben (9)“, hablar/ir gesperrt', h.modes.verb && h.modes.verb.count === '9' && verbPlan.locked === 8, JSON.stringify({ verb: h.modes.verb, verbPlan }));
    await page.click('#start-verb');
    await page.locator('#card-front[data-type="verb"]').waitFor();
    check('S3a-2 Erste Verbformkarte: tengo (Infinitiv vorn, „ich · Präsens“)', (await page.locator('#verb-lemma').innerText()) === 'tener' && (await page.locator('#form-meta').innerText()) === 'ich · Präsens' && (await page.locator('#card-front').getAttribute('data-key')) === 'V:tener:tengo:Präsens');
    await page.click('#show-answer');
    const spokenForm = await dbg(page, () => window.__spoken.slice(-1)[0]);
    check('S3a-3 Rückseite: „tengo“ vorgelesen, Hinweis „unregelmäßig“ mit Mustern', (await page.locator('#verb-form').innerText()) === 'tengo' && spokenForm.text === 'tengo' && (await page.locator('#irregular-hint').innerText()).includes('e→ie'), JSON.stringify(spokenForm));
    await page.click('[data-grade="4"]');
    await rateOne(page, 4); // tiene
    await page.locator('#card-front').waitFor();
    check('S3b-1 Dritte Karte tienes: Lückentext ersetzt die Form im Satz', (await page.locator('#card-front').getAttribute('data-key')) === 'V:tener:tienes:Präsens' && (await page.locator('#gap-sentence').innerText()) === '¿____ (tener) tiempo mañana?' && (await page.locator('#form-meta').innerText()) === 'du · Präsens');
    await page.click('#show-answer');
    await openMore(page);
    const gapBack = await page.locator('#card-back').innerText();
    check('S3b-2 Aufgedeckt: vollständiger Satz mit hervorgehobener Form, Übersetzung, Link zur Tabelle unter „Mehr“', (await page.locator('#example-text mark').innerText()) === 'Tienes' && gapBack.includes('¿Tienes tiempo mañana?') && gapBack.includes('Hast du morgen Zeit?') && (await page.locator('#more #verb-table-link').count()) === 1, gapBack.replace(/\n/g, ' | '));
    await page.click('[data-grade="4"]');
    await page.locator('#card-front').waitFor();
    // Tipp-Modus
    await settings(page);
    await page.locator('#tip-mode').check();
    await page.locator('#toast.show', { hasText: 'Tipp-Modus ein' }).waitFor();
    await page.goto(base + '#lernen/verb');
    await page.locator('#card-front[data-type="verb"]').waitFor();
    check('S3c-1 Tipp-Modus: Textfeld statt „Antwort zeigen“ (Karte tenemos)', (await page.locator('#tip-input').count()) === 1 && (await page.locator('#show-answer').count()) === 0 && (await page.locator('#card-front').getAttribute('data-key')) === 'V:tener:tenemos:Präsens');
    await page.locator('#tip-input').fill(' Tenemos ');
    await page.keyboard.press('Enter');
    await page.locator('#tip-verdict').waitFor();
    check('S3c-2 „ Tenemos “ richtig → „Gut“ vorbelegt', (await page.locator('#tip-verdict').innerText()) === 'Richtig' && (await page.locator('.rate.preselected').getAttribute('data-grade')) === '3' && (await page.locator('#confirm-rating').innerText()) === 'Bestätigen: Gut');
    await page.click('#confirm-rating');
    await page.locator('#card-front').waitFor();
    lastR = await dbg(page, () => window.__spanischTrainer.state.reviews.slice(-1)[0]);
    check('S3c-3 Bestätigen übernimmt 3; nächste Karte tenía', lastR.cardId === 'V:tener:tenemos:Präsens' && lastR.rating === 3 && (await page.locator('#card-front').getAttribute('data-key')) === 'V:tener:tenía:Imperfekt');
    await page.locator('#tip-input').fill('tenia');
    await page.click('#tip-check');
    await page.locator('#tip-verdict').waitFor();
    check('S3c-4 „tenia“ falsch (Akzent) → „Nochmal“ vorbelegt, Unterschied „í“ markiert', (await page.locator('#tip-verdict').innerText()) === 'Falsch' && (await page.locator('.rate.preselected').getAttribute('data-grade')) === '1' && (await page.locator('#tip-expected .diff').allInnerTexts()).join('') === 'í');
    await page.click('[data-grade="2"]');
    await page.locator('#card-front').waitFor();
    lastR = await dbg(page, () => window.__spanischTrainer.state.reviews.slice(-1)[0]);
    check('S3c-5 Bewertung vor dem Bestätigen geändert (Schwer)', lastR.rating === 2);
    await settings(page);
    await page.locator('#tip-mode').uncheck();
    await page.locator('#toast.show', { hasText: 'Tipp-Modus aus' }).waitFor();
    // Tabelle und Muster
    await page.goto(base + '#karten');
    await page.fill('#search', 'ES-0011');
    await page.click('#card-list .list-item');
    await page.click('#detail-verb-link');
    await page.locator('.verb-group').first().waitFor();
    const table = await dbg(page, () => ({ tempora: [...document.querySelectorAll('.verb-group')].map((g) => g.dataset.tempus), irregular: [...document.querySelectorAll('.verb-table .vt-row.irregular')].map((r) => r.dataset.form).sort(), regular: [...document.querySelectorAll('.verb-table .vt-row:not(.irregular)')].map((r) => r.dataset.form).sort(), bars: [...document.querySelectorAll('.verb-table .freq-bar')].map((b) => b.style.width) }));
    check('S3d Tabelle: Tempus-Reihenfolge, unregelmäßige hervorgehoben, Balken', table.tempora.join(',') === 'Präsens,Indefinido,Imperfekt,Subjuntivo Präsens,Partizip' && table.irregular.join(',') === 'tenga,tengo,tiene,tienen,tienes,tuve' && table.regular.join(',') === 'tenemos,tenido,tenía' && table.bars[0] === '100%', JSON.stringify(table.tempora));
    await page.goto(base + '#muster');
    const muster = await dbg(page, () => [...document.querySelectorAll('section[data-muster]')].map((s) => `${s.dataset.muster}:${[...s.querySelectorAll('[data-lemma]')].map((l) => l.dataset.lemma).join('+')}`));
    check('S3d-2 Muster-Übersicht', muster.includes('e→ie:tener') && muster.includes(':hablar'), muster.join(' | '));
    const verbSession = await dbg(page, () => window.__spanischTrainer.plan().sessions);
    check('S3e Sitzungen getrennt: Verbkarten nur in „Verben“, keine in Vokabeln/Hören', verbSession.vocab.entries.every((e) => e.type === 'vocab') && verbSession.hear.entries.every((e) => e.type === 'hear') && verbSession.verb.entries.every((e) => e.type === 'verb') && verbSession.verb.total === 6 && verbSession.verb.new === 4 && verbSession.verb.due === 2, JSON.stringify({ v: verbSession.vocab.total, h: verbSession.hear.total, f: verbSession.verb.total }));
    // Austausch der Verbdatei
    const bigger = JSON.parse(await fs.readFile(path.join(ROOT, 'data/verben.json'), 'utf8'));
    bigger.verben.push({ lemma: 'comer', kennung: 'ES-0099', label: 'Verb', muster: ['regelmäßig -er'], formen: [{ form: 'como', tempus: 'Präsens', person: 'ich', haeufigkeit: 50000, unregelmaessig: false }], saetze: [] });
    await fs.writeFile(path.join(site, 'data/verben.json'), JSON.stringify(bigger));
    const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
    const p4 = await ctx3.newPage();
    attach(p4, '(verben)');
    await p4.goto(base + '#muster');
    await p4.locator('section[data-muster]').first().waitFor();
    const lemmas = await dbg(p4, () => [...new Set([...document.querySelectorAll('[data-lemma]')].map((l) => l.dataset.lemma))].sort());
    check('S3f Datei mit 4 Verben ohne Codeänderung', lemmas.join(',') === 'comer,hablar,ir,tener', lemmas.join(','));
    await ctx3.close();
    await fs.writeFile(path.join(site, 'data/verben.json'), await fs.readFile(path.join(ROOT, 'data/verben.json'), 'utf8'));

    // ---- 4. Offline ----
    await page.reload();
    before = await stats(page);
    homeBefore = await home(page);
    const reviewsBeforeOffline = await dbg(page, () => window.__spanischTrainer.state.reviews.length);
    const swState = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
      const keys = await caches.keys();
      const cache = await caches.open(keys.find((k) => k.startsWith('spanisch-trainer-')));
      return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, cached: (await cache.keys()).map((r) => new URL(r.url).pathname), keys };
    });
    check('4a Service Worker aktiv mit Scope /spanisch-trainer/', swState.controlled && swState.scope === base, JSON.stringify({ scope: swState.scope, keys: swState.keys }));
    check('4b Daten, Verbdaten, Module und FSRS-Kopie im Cache', ['data/Spanisch_00_Rang_0001-0030.txt', 'data/verben.json', 'lib/ts-fsrs.js', 'js/views/stats.js', 'js/views/verbs.js', 'js/verbs.js', 'js/migrate.js'].every((f) => swState.cached.includes(PREFIX + f)), `${swState.cached.length} Einträge`);
    await context.setOffline(true);
    await page.reload();
    const homeOff = await home(page);
    const sOff = await stats(page);
    check('4c Offline: Start und Statistik unverändert', homeOff.text === homeBefore.text && JSON.stringify(sOff) === JSON.stringify(before), `${homeOff.text} | ${JSON.stringify(sOff)}`);
    await page.goto(base + '#start');
    await page.click('#start-vocab');
    await rateOne(page, 3);
    const offlineState = await dbg(page, () => window.__spanischTrainer.state.reviews.length);
    check('4d Offline lernen und bewerten funktioniert', offlineState === reviewsBeforeOffline + 1, `${offlineState}`);
    const page2 = await context.newPage();
    attach(page2, '(page2)');
    await page2.goto(base + '#statistik');
    await page2.locator('#bars').waitFor();
    check('4e Offline: zweite Seite /spanisch-trainer/#statistik lädt', (await page2.locator('#bars .bar').last().getAttribute('data-count')) === String(reviewsBeforeOffline + 1));
    await page2.close();
    await context.setOffline(false);

    // ---- S1e. Migration aus Schema 1 ----
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
          tx.objectStore('progress').put({ id: 'ES-0001', due: '2026-10-10T10:00:00.000Z', stability: 8.3, difficulty: 1, elapsed_days: 0, scheduled_days: 8, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: '2026-10-02T10:00:00.000Z' });
          tx.objectStore('progress').put({ id: 'ES-0002', due: '2099-01-01T10:00:00.000Z', stability: 30, difficulty: 2, elapsed_days: 0, scheduled_days: 30, learning_steps: 0, reps: 3, lapses: 0, state: 2, last_review: '2026-10-02T10:00:00.000Z' });
          tx.objectStore('days').put({ id: '2026-10-02', newCount: 2, reviewCount: 3 });
          tx.objectStore('meta').put({ id: 'settings', newPerDay: 20, autoSpeak: false });
          tx.oncomplete = () => (db.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    });
    await p3.goto(base);
    base = base; // (unverändert)
    const hm = await (async () => {
      await p3.locator('#today-summary').waitFor();
      return { total: await p3.locator('#today-summary').getAttribute('data-total'), due: await p3.locator('#today-summary').getAttribute('data-due') };
    })();
    const mig = await dbg(p3, () => ({ schema: window.__spanischTrainer.state.schema, again: window.__spanischTrainer.state.progress.get('ES-0001').againCount, settings: window.__spanischTrainer.state.settings }));
    check('S1e Alter Lernstand (Schema 1) übernommen: 1 fällig + 20 neu (alte Einstellung) + 2 Hörkarten, Schema 1→2, Vorlesen aus, neue Standardwerte ergänzt', hm.due === '1' && hm.total === '23' && mig.schema.from === 1 && mig.schema.to === 2 && mig.again === 0 && mig.settings.autoSpeak === false && mig.settings.ratingMode === 'simple' && mig.settings.sessionSize === 15, `${JSON.stringify(hm)} ${JSON.stringify(mig)}`);
    await ctx2.close();

    // ---- 5. Konsole ----
    const ignorable = (t) => /@ https:\/\/cdn\.jsdelivr\.net\//.test(t);
    const real = consoleErrors.filter((t) => !ignorable(t));
    check('5a Keine Fehler in der Browserkonsole', real.length === 0, real.join(' || ') || `(${consoleErrors.length - real.length} CDN-Netzfehler der Sandbox ignoriert)`);
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
