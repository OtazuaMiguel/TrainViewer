// Mide cuánto se separan las posiciones GPS reales de los trenes de las vías dibujadas en el mapa.
// Uso: node scripts/calibrar.mjs <gps.json.gz> [geodata.json ...]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { decodePolyline, hav } from './lib/network.mjs';

const [gpsFile, ...geoFiles] = process.argv.slice(2);
const gps = JSON.parse(gunzipSync(readFileSync(gpsFile)).toString());
const RAD = Math.PI / 180;
const prep = enc => {
  const geom = decodePolyline(enc); let s = 90, w = 180, n = -90, e = -180;
  for (const p of geom) { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }
  return { geom, bbox: [s - .05, w - .07, n + .05, e + .07] };
};
function nearest(list, p) {
  let best = Infinity; const k = Math.cos(p[0] * RAD);
  for (const e of list) {
    const b = e.bbox; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    const g = e.geom;
    for (let i = 0; i < g.length - 1; i++) {
      const ax = g[i][1] * k, ay = g[i][0], bx = g[i + 1][1] * k, by = g[i + 1][0], px = p[1] * k, py = p[0];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111195; if (d < best) best = d;
    }
  }
  return best;
}
const pts = gps.pts.filter(p => p[2] > 35 && p[2] < 44.5 && p[3] > -10 && p[3] < 4.5);
for (const f of geoFiles.length ? geoFiles : ['src/geodata.json']) {
  const geo = JSON.parse(readFileSync(f, 'utf8'));
  const main = Object.values(geo.edges).map(prep), sec = (geo.sec || []).map(prep);
  const ds = pts.map(p => Math.min(nearest(main, [p[2], p[3]]), nearest(sec, [p[2], p[3]]))).sort((a, b) => a - b);
  const q = x => ds[Math.min(ds.length - 1, Math.floor(ds.length * x))];
  const share = m => (ds.filter(d => d <= m).length / ds.length * 100).toFixed(1);
  console.log(`${f}: ${ds.length} posiciones · mediana ${q(.5).toFixed(0)} m · p90 ${q(.9).toFixed(0)} m · p99 ${q(.99).toFixed(0)} m · ` +
    `≤50 m ${share(50)} % · ≤200 m ${share(200)} % · >1 km ${(100 - +share(1000)).toFixed(1)} % · tamaño ${(JSON.stringify({ e: geo.edges, s: geo.sec }).length / 1024).toFixed(0)} KB`);
}
