// Recolector periódico (GitHub Actions, cada ~15 min). Genera en <salida>/:
//   historico.json   muestras de puntualidad de los últimos 8 días (para la gráfica de 7 días)
//   incidencias.json incidencias y avisos oficiales de Adif situados sobre los tramos del mapa
// Uso: node scripts/datos.mjs <salida> [<carpeta con los ficheros anteriores>]
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from './lib/incidencias.mjs';

const OUT = process.argv[2] || 'datos-out';
const PREV = process.argv[3] || 'prev';
mkdirSync(OUT, { recursive: true });
const FLOTA = 'https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json';
const ADIF_ESTADO = 'https://www.adif.es/viajeros/estado-de-la-red';
const ADIF_AVISOS = 'https://www.adif.es/viajeros/avisos';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const CAT_OF = { 2: 'av', 25: 'av', 28: 'av', 4: 'ld', 5: 'ld', 7: 'ld', 8: 'ld', 9: 'ld', 10: 'ld', 11: 'ld', 13: 'ld', 24: 'ld' };

async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i >= tries - 1) throw e; await new Promise(r => setTimeout(r, 3000 * (i + 1))); }
  }
}

// ---------- 1. Histórico de puntualidad ----------
async function historico() {
  let hist = { updated: null, samples: [] };
  const prevFile = join(PREV, 'historico.json');
  if (existsSync(prevFile)) { try { hist = JSON.parse(readFileSync(prevFile, 'utf8')); } catch {} }
  try {
    const d = await getJSON(FLOTA);
    const trenes = d.trenes || [];
    const by = { av: [0, 0, 0], ld: [0, 0, 0], md: [0, 0, 0] };   // n, puntuales, suma de retraso
    for (const t of trenes) {
      const dl = Math.max(0, Math.round(+t.ultRetraso || 0)), c = by[CAT_OF[+t.codProduct] || 'md'];
      c[0]++; if (dl < 5) c[1]++; c[2] += dl;
    }
    const n = trenes.length, on = by.av[1] + by.ld[1] + by.md[1], sum = by.av[2] + by.ld[2] + by.md[2];
    if (n) hist.samples.push({ t: Date.now(), n, p: +(on / n * 100).toFixed(1), d: +(sum / n).toFixed(1),
      av: by.av[0] ? +(by.av[1] / by.av[0] * 100).toFixed(1) : null, ld: by.ld[0] ? +(by.ld[1] / by.ld[0] * 100).toFixed(1) : null,
      md: by.md[0] ? +(by.md[1] / by.md[0] * 100).toFixed(1) : null });
    console.log(`Histórico: ${n} trenes, puntualidad ${n ? (on / n * 100).toFixed(1) : '–'} %`);
  } catch (e) { console.log('::warning::No se pudo leer flotaLD.json: ' + e.message); }
  const cutoff = Date.now() - 8 * 864e5;
  hist.samples = hist.samples.filter(s => s.t >= cutoff).sort((a, b) => a.t - b.t);
  hist.updated = new Date().toISOString();
  writeFileSync(join(OUT, 'historico.json'), JSON.stringify(hist));
  console.log(`historico.json: ${hist.samples.length} muestras`);
}

// ---------- 2. Incidencias oficiales de Adif ----------
async function incidencias() {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const p = await b.newPage({ userAgent: UA });
  const items = [];
  try {
    await p.goto(ADIF_ESTADO, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForSelector('article.aviso-item, .listado-informacion-red-contenedor', { timeout: 20000 }).catch(() => {});
    const estado = await p.$$eval('article.aviso-item', arts => arts.map(a => ({
      id: 'estado-' + (a.dataset.articleId || ''),
      zones: (a.querySelector('.aviso-item__ambito')?.textContent || '').trim(),
      title: (a.querySelector('.aviso-card__titulo')?.textContent || '').trim(),
      text: [...a.querySelectorAll('.aviso-card__content p')].map(x => x.textContent.trim()).filter(Boolean).join(' ') || (a.querySelector('.aviso-card__content')?.textContent || '').trim(),
    })));
    for (const e of estado) items.push({ ...e, kind: 'estado', url: ADIF_ESTADO });
    console.log(`Estado de la red: ${estado.length} incidencias`);
  } catch (e) { console.log('::warning::Estado de la red: ' + e.message); }
  try {
    await p.goto(ADIF_AVISOS, { waitUntil: 'networkidle', timeout: 60000 });
    const avisos = await p.$$eval('a.aviso-card', cards => cards.map(a => ({
      url: a.href,
      zones: (a.querySelector('.aviso-card__header')?.textContent || '').trim(),
      title: (a.querySelector('.sr-only')?.textContent || a.querySelector('strong')?.textContent || '').replace(/^Leer aviso:\s*/, '').trim(),
      text: (a.querySelector('.aviso-card__content')?.textContent || '').replace(/\s+/g, ' ').trim(),
    })));
    // El resumen viene truncado: se lee el aviso completo (fechas, tramos exactos)
    for (const av of avisos) {
      try {
        await p.goto(av.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const full = await p.evaluate(title => {
          const nodes = [...document.querySelectorAll('h1, h2')].filter(h => h.textContent.trim().length > 3 && !/Accidente en Urda/.test(h.textContent));
          const h = nodes.find(h => title && h.textContent.includes(title.slice(0, 25))) || nodes[0];
          let box = h; for (let i = 0; i < 4 && box && box.innerText.length < 300; i++) box = box.parentElement;
          return box ? box.innerText.replace(/\s+/g, ' ').trim() : '';
        }, av.title);
        if (full.length > av.text.length) av.text = full.slice(0, 4000);
      } catch {}
      const slug = new URL(av.url).pathname.split('/').pop();
      items.push({ ...av, id: 'aviso-' + slug, kind: 'aviso' });
    }
    console.log(`Avisos: ${avisos.length}`);
  } catch (e) { console.log('::warning::Avisos: ' + e.message); }
  await b.close();

  const out = compile(items, new Date());
  out.updated = new Date().toISOString();
  out.sources = [ADIF_ESTADO, ADIF_AVISOS];
  writeFileSync(join(OUT, 'incidencias.json'), JSON.stringify(out));
  for (const it of out.items) console.log(` - [${it.severity}] ${it.title} -> ${it.edges.join(', ') || it.note || '—'}`);
  if (!items.length) throw new Error('No se ha podido leer ninguna incidencia de Adif');
}

await historico();
await incidencias().catch(e => {
  console.log('::warning::' + e.message + ' — se conservan las incidencias anteriores');
  const prev = join(PREV, 'incidencias.json');
  if (existsSync(prev)) copyFileSync(prev, join(OUT, 'incidencias.json'));
});
