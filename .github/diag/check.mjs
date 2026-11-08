// Diagnóstico: abre la web publicada en Chromium y registra teselas, errores y capturas.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('diag', { recursive: true });
const URL = process.env.SITE || 'https://otazuamiguel.github.io/TrainViewer/';
const log = [];
const b = await chromium.launch();
for (const [name, vp] of [['escritorio', { width: 1440, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp });
  p.on('console', m => log.push(`[${name}] console.${m.type()}: ${m.text().slice(0, 200)}`));
  p.on('pageerror', e => log.push(`[${name}] PAGEERROR: ${e.message}`));
  p.on('response', async r => {
    const u = r.url();
    if (/tile|cartocdn|basemap|arcgis|ign\.es|openstreetmap|\.png|\.jpe?g/i.test(u) && !u.includes('github.io')) {
      let extra = '';
      const ct = r.headers()['content-type'] || '';
      if (!ct.startsWith('image/')) { try { extra = ' cuerpo=' + (await r.text()).slice(0, 160).replace(/\s+/g, ' '); } catch {} }
      log.push(`[${name}] ${r.status()} ${ct} ${u.slice(0, 120)}${extra}`);
    }
  });
  p.on('requestfailed', r => log.push(`[${name}] FALLO ${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(20000);
  const info = await p.evaluate(() => ({
    conn: document.getElementById('conn')?.innerText, total: document.getElementById('k-total')?.innerText,
    diag: document.getElementById('diag')?.textContent, tiles: document.querySelectorAll('.leaflet-tile-loaded').length,
    bodyText: document.body.innerText.match(/api.?key[^\n]{0,80}/i)?.[0] || null,
  }));
  log.push(`[${name}] ESTADO ${JSON.stringify(info)}`);
  log.push(`[${name}] OFICIAL ${await p.$$eval('#offlist .off-row', x => x.length)} avisos · ${await p.$$eval('.leaflet-incid-pane path', x => x.length)} trazos · semana: ${await p.$eval('#spark', e => e.innerText.replace(/\n+/g, ' '))}`);
  // Movimiento: cuántos trenes cambian de posición en 2 s
  const tf = () => p.evaluate(() => [...document.querySelectorAll('.tmk')].map(e => e.style.transform));
  const m1 = await tf(); await p.waitForTimeout(2000); const m2 = await tf();
  log.push(`[${name}] MOVIMIENTO ${m1.filter((v, i) => v !== m2[i]).length}/${m1.length} trenes se han movido en 2 s · conexión: ${await p.$eval('#conn', e => e.innerText)}`);
  // Ficha de tren: pulsa un tren visible
  const pt = await p.evaluate(() => { const e = [...document.querySelectorAll('.tmk')].find(e => { const r = e.getBoundingClientRect(); return r.x > 420 && r.y > 80 && r.x < innerWidth - 60 && r.y < innerHeight - 60; }); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  if (pt) { await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(2500);
    log.push(`[${name}] FOCO ${await p.$eval('#map', e => e.classList.contains('focus'))}`); log.push(`[${name}] FICHA ${(await p.$eval('#trainv', e => e.innerText)).replace(/\n+/g, ' | ').slice(0, 500)}`);
    await p.screenshot({ path: `diag/${name}-tren.png` }); await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
  await p.screenshot({ path: `diag/${name}.png` });
  for (const q of ['00808', 'Pamplona Madrid', 'A Coruña Madrid']) {
    await p.fill('#q', q); await p.waitForTimeout(700);
    log.push(`[${name}] BUSQUEDA "${q}": ${(await p.$eval('#results', e => e.innerText.replace(/\n+/g, ' · '))).slice(0, 400)}`);
  }
  await p.fill('#q', ''); await p.waitForTimeout(200);
  log.push(`[${name}] SIN GPS ${await p.$$eval('.tmk.est', x => x.length)} trenes con posición estimada · con GPS ${await p.$$eval('.tmk:not(.est)', x => x.length)}`);
  await p.fill('#q', '00808'); await p.waitForTimeout(500); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  log.push(`[${name}] 808 en el mapa: ${await p.$$eval('.tmk.focused', x => x.length)} · ${(await p.$eval('#trainv', e => e.innerText.replace(/\n+/g, ' | '))).slice(0, 300)}`);
  await p.screenshot({ path: `diag/${name}-808.png` });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // Panel de estación: busca Madrid y abre su panel
  await p.fill('#q', 'Atocha'); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(2500);
  log.push(`[${name}] ESTACION ${(await p.$eval('#station', e => e.innerText)).replace(/\n+/g, ' | ').slice(0, 700)}`);
  await p.screenshot({ path: `diag/${name}-estacion.png` });
}
await b.close();
writeFileSync('diag/log.txt', log.join('\n'));
console.log(log.filter((l, i, a) => a.indexOf(l) === i).slice(0, 120).join('\n'));
