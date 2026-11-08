// Descarga el trazado real de las vías desde OpenStreetMap (extractos de Geofabrik filtrados con osmium, o Overpass API) y, opcionalmente,
// unas muestras de posiciones GPS de los trenes de Renfe para comprobar el ajuste.
// Se ejecuta en GitHub Actions (flujo «vias.yml»); el resultado lo usa scripts/build-geodata.mjs.
// Uso: node scripts/osm-vias.mjs <salida> [minutos de muestras GPS] [todo:extracto.geojsonseq principal:otro.geojsonseq ...]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = process.argv[2] || 'osm-out';
const GPS_MIN = +(process.argv[3] || 0);
// Resto de argumentos: extractos ya filtrados con osmium (GeoJSON por líneas), como «todo:fichero» o «principal:fichero».
// Sin ellos se consulta Overpass (más lento y a veces saturado).
const FILES = process.argv.slice(4).map(a => { const [mode, ...f] = a.split(':'); return { mode, file: f.join(':') }; });
mkdirSync(OUT, { recursive: true });
const UA = 'TrainViewer/1.0 (+https://github.com/OtazuaMiguel/TrainViewer)';
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const KEEP = ['railway', 'highspeed', 'usage', 'gauge', 'electrified', 'maxspeed', 'name', 'ref', 'tracks', 'tunnel', 'bridge'];
const SKIP_USE = new Set(['industrial', 'military', 'tourism', 'test']);
const pickTags = tags => { const t = {}; for (const k of KEEP) if (tags?.[k]) t[k] = tags[k]; return t; };
const byId = new Map();

if (FILES.length) {
  // Vías en servicio (sin apartaderos, playas de vías ni ramales de servicio); de Portugal y Francia sólo las principales
  for (const { mode, file } of FILES) {
    let n = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const s = line.replace(/^\x1e/, '').trim(); if (!s) continue;
      let f; try { f = JSON.parse(s); } catch { continue; }
      const p = f.properties || {}, g = f.geometry;
      if (!g || g.type !== 'LineString' || p.service || !['rail', 'narrow_gauge'].includes(p.railway) || SKIP_USE.has(p.usage)) continue;
      if (mode === 'principal' && (p.usage !== 'main' || p.railway !== 'rail')) continue;
      const id = p['@id'] ?? f.id ?? (file + n);
      byId.set(id, { id, t: pickTags(p), g: g.coordinates.map(([x, y]) => [+y.toFixed(6), +x.toFixed(6)]) });
      n++;
    }
    console.log(`${file}: ${n} vías`);
  }
} else {
  const HEAD = '[out:json][timeout:900][maxsize:1073741824];';
  const QUERIES = [
    ['España', `${HEAD} area["ISO3166-1"="ES"][admin_level=2]->.a; way["railway"~"^(rail|narrow_gauge)$"][!"service"](area.a); out tags geom;`],
    ['Portugal', `${HEAD} area["ISO3166-1"="PT"][admin_level=2]->.a; way["railway"="rail"][!"service"]["usage"="main"](area.a); out tags geom;`],
    ['Sur de Francia', `${HEAD} way["railway"="rail"][!"service"]["usage"="main"](42.3,-2.0,46.0,6.0); out tags geom;`],
  ];
  for (const [i, [name, q]] of QUERIES.entries()) for (const e of await overpass(name, q, i === 0))
    if (e.type === 'way' && e.geometry?.length > 1 && !SKIP_USE.has(e.tags?.usage)) byId.set(e.id, { id: e.id, t: pickTags(e.tags), g: e.geometry.map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6)]) });
}
async function overpass(name, q, required) {
  for (let round = 0; round < 2; round++) for (const url of SERVERS) {
    try {
      console.log(`Overpass (${name}):`, url);
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(20 * 60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.elements?.length) throw new Error('respuesta vacía');
      return j.elements;
    } catch (e) { console.log('::warning::' + url + ': ' + e.message); await new Promise(r => setTimeout(r, 30000)); }
  }
  if (required) throw new Error('Ningún servidor Overpass respondió (' + name + ')');
  console.log(`::warning::${name}: sin datos`);
  return [];
}
const ways = [...byId.values()].filter(w => w.g.length > 1);
if (ways.length < 5000) throw new Error('Demasiado pocas vías: ' + ways.length);
writeFileSync(join(OUT, 'osm-rail.json.gz'), gzipSync(JSON.stringify({ generated: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL)', ways })));
console.log(`osm-rail.json.gz: ${ways.length} vías, ${ways.reduce((s, w) => s + w.g.length, 0)} puntos`);

// Muestras GPS de los trenes (para medir cuánto se separan de las vías dibujadas)
if (GPS_MIN > 0) {
  const FLOTA = 'https://tiempo-real.largorecorrido.renfe.com/renfe-visor/flotaLD.json';
  const RUTAS = 'https://tiempo-real.largorecorrido.renfe.com/renfe-visor/trenesConEstacionesLD.json';
  const seen = new Set(), pts = [];
  const end = Date.now() + GPS_MIN * 60000;
  let rutas = null;
  try { rutas = await (await fetch(RUTAS, { signal: AbortSignal.timeout(30000) })).json(); } catch (e) { console.log('::warning::rutas: ' + e.message); }
  while (Date.now() < end) {
    try {
      const d = await (await fetch(FLOTA, { signal: AbortSignal.timeout(30000) })).json();
      for (const t of d.trenes || []) {
        const k = t.codComercial + '|' + t.latitud + '|' + t.longitud;
        if (seen.has(k) || !t.latitud) continue;
        seen.add(k);
        pts.push([t.codComercial, +t.codProduct, +(+t.latitud).toFixed(6), +(+t.longitud).toFixed(6), t.codEstAnt, t.codEstSig, +t.time || 0]);
      }
    } catch (e) { console.log('::warning::flota: ' + e.message); }
    await new Promise(r => setTimeout(r, 15000));
  }
  writeFileSync(join(OUT, 'gps.json.gz'), gzipSync(JSON.stringify({ generated: new Date().toISOString(), pts, rutas })));
  console.log(`gps.json.gz: ${pts.length} posiciones`);
}
