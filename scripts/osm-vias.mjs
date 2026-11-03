// Descarga el trazado real de las vías de España desde OpenStreetMap (Overpass API) y, opcionalmente,
// unas muestras de posiciones GPS de los trenes de Renfe para comprobar el ajuste.
// Se ejecuta en GitHub Actions (flujo «vias.yml»); el resultado lo usa scripts/build-geodata.mjs.
// Uso: node scripts/osm-vias.mjs <salida> [minutos de muestras GPS]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUT = process.argv[2] || 'osm-out';
const GPS_MIN = +(process.argv[3] || 0);
mkdirSync(OUT, { recursive: true });
const UA = 'TrainViewer/1.0 (+https://github.com/Paticuaker/TrainViewer)';
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// Vías en servicio de España, y líneas principales de Portugal y del sur de Francia (trenes internacionales),
// sin apartaderos, playas de vías ni ramales de servicio
const Q = `[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="ES"][admin_level=2]->.es;
area["ISO3166-1"="PT"][admin_level=2]->.pt;
(
  way["railway"~"^(rail|narrow_gauge)$"][!"service"](area.es);
  way["railway"="rail"][!"service"]["usage"="main"](area.pt);
  way["railway"="rail"][!"service"]["usage"="main"](42.3,-2.0,46.0,6.0);
);
out tags geom;`;

async function overpass() {
  for (let round = 0; round < 3; round++) for (const url of SERVERS) {
    try {
      console.log('Overpass:', url);
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(Q), signal: AbortSignal.timeout(20 * 60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.elements?.length) throw new Error('respuesta vacía');
      return j;
    } catch (e) { console.log('::warning::' + url + ': ' + e.message); await new Promise(r => setTimeout(r, 30000)); }
  }
  throw new Error('Ningún servidor Overpass respondió');
}

const j = await overpass();
const KEEP = ['railway', 'highspeed', 'usage', 'gauge', 'electrified', 'maxspeed', 'name', 'ref', 'tracks', 'tunnel', 'bridge'];
const ways = j.elements.filter(e => e.type === 'way' && e.geometry?.length > 1).map(e => {
  const t = {}; for (const k of KEEP) if (e.tags?.[k]) t[k] = e.tags[k];
  return { id: e.id, t, g: e.geometry.map(p => [+p.lat.toFixed(6), +p.lon.toFixed(6)]) };
});
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
