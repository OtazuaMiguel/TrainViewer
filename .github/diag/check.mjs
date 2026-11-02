// Diagnóstico: abre la web publicada en Chromium y registra teselas, errores y capturas.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('diag', { recursive: true });
const URL = process.env.SITE || 'https://paticuaker.github.io/TrainViewer/';
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
  await p.screenshot({ path: `diag/${name}.png` });
}
await b.close();
writeFileSync('diag/log.txt', log.join('\n'));
console.log(log.filter((l, i, a) => a.indexOf(l) === i).slice(0, 120).join('\n'));
