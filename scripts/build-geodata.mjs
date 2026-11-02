// Regenera src/geodata.json: trazado real de las vías, mapa base integrado y catálogo de estaciones.
// Fuentes: Natural Earth (dominio público) y el catálogo público de estaciones de Renfe.
// Uso: node scripts/build-geodata.mjs   (descarga ~75 MB a .cache/ la primera vez)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const STATION_SOURCES = [
  'https://tiempo-real.largorecorrido.renfe.com/data/estaciones.geojson',
  'https://raw.githubusercontent.com/1ly4s0/trenes-espana.es/HEAD/data/estaciones.geojson',
];

async function getJSON(name, urls) {
  const file = join(cache, name);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (const url of [].concat(urls)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const txt = await res.text();
      writeFileSync(file, txt);
      console.log('descargado', url);
      return JSON.parse(txt);
    } catch (e) { console.warn('fallo', url, e.message); }
  }
  throw new Error('No se pudo obtener ' + name);
}

// ST y LINES se leen de la propia app para que no haya dos copias
const app = readFileSync(join(root, 'src/app.html'), 'utf8');
const ST = eval('(' + app.match(/const ST = (\{[\s\S]*?\n\});/)[1] + ')');
const LINES = eval(app.match(/const LINES = (\[[\s\S]*?\n\]);/)[1]);

const R = Math.PI / 180;
const hav = (a, b) => { const dLa = (b[0]-a[0])*R, dLo = (b[1]-a[1])*R; const s = Math.sin(dLa/2)**2 + Math.cos(a[0]*R)*Math.cos(b[0]*R)*Math.sin(dLo/2)**2; return 2*6371000*Math.asin(Math.sqrt(s)); };
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const A = pts[a], B = pts[b], k = Math.cos(A[0]*R);
    for (let i = a + 1; i < b; i++) {
      const p = pts[i], dx = (B[1]-A[1])*k, dy = B[0]-A[0], px = (p[1]-A[1])*k, py = p[0]-A[0], L = dx*dx + dy*dy;
      const t = L ? Math.max(0, Math.min(1, (px*dx + py*dy) / L)) : 0, d = Math.hypot(px - t*dx, py - t*dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function enc(pts) {
  let out = '', pl = 0, pg = 0;
  const e = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la*1e5), b = Math.round(lo*1e5); out += e(a - pl) + e(b - pg); pl = a; pg = b; }
  return out;
}

// --- 1. Grafo ferroviario de Natural Earth recortado a la península
const rr = await getJSON('ne_10m_railroads.geojson', NE + 'ne_10m_railroads.geojson');
const inB = ([x, y]) => x > -9.6 && x < 3.4 && y > 35.9 && y < 43.9;
const rail = [];
for (const f of rr.features) for (const c of (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)) if (c.some(inB)) rail.push(c.map(([x, y]) => [y, x]));
const nodes = new Map(), P = [], adj = [];
const nid = p => { const k = p[0].toFixed(5) + ',' + p[1].toFixed(5); let i = nodes.get(k); if (i === undefined) { i = P.length; nodes.set(k, i); P.push(p); adj.push([]); } return i; };
const link = (a, b) => { if (a === b) return; const d = hav(P[a], P[b]); adj[a].push([b, d]); adj[b].push([a, d]); };
const ends = [];
for (const l of rail) { let prev = null; for (const p of l) { const i = nid(p); if (prev !== null) link(prev, i); prev = i; } ends.push(nid(l[0]), nid(l[l.length - 1])); }
const G = 0.05, grid = new Map(), gk = p => Math.floor(p[0]/G) + ':' + Math.floor(p[1]/G);
P.forEach((p, i) => { const k = gk(p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
function near(p, maxD, ex) {
  let best = -1, bd = maxD; const a = Math.floor(p[0]/G), b = Math.floor(p[1]/G);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const n of grid.get((a+i) + ':' + (b+j)) || []) { if (ex && ex.has(n)) continue; const d = hav(p, P[n]); if (d < bd) { bd = d; best = n; } }
  return [best, bd];
}
for (const e of ends) { if (adj[e].length > 1) continue; const [n, d] = near(P[e], 1500, new Set([e, ...adj[e].map(x => x[0])])); if (n >= 0 && d > 1) link(e, n); }
function dij(s, t) {
  const dist = new Float64Array(P.length).fill(Infinity), prev = new Int32Array(P.length).fill(-1), h = [[0, s]]; dist[s] = 0;
  const push = x => { h.push(x); let i = h.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (h[q][0] <= h[i][0]) break; [h[q], h[i]] = [h[i], h[q]]; i = q; } };
  const pop = () => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2*i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
  while (h.length) { const [d, u] = pop(); if (d > dist[u]) continue; if (u === t) break; for (const [v, w] of adj[u]) { const nd = d + w; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } } }
  if (dist[t] === Infinity) return null;
  const path = []; for (let u = t; u !== -1; u = prev[u]) path.unshift(u);
  return { path, len: dist[t] };
}
const snap = {}; for (const k in ST) { const [n] = near(ST[k].c, 12000); snap[k] = n; }
const edges = {}, fallback = [];
for (const L of LINES) for (let i = 0; i < L.path.length - 1; i++) {
  const a = L.path[i], b = L.path[i + 1], id = a + '-' + b, direct = hav(ST[a].c, ST[b].c);
  const r = snap[a] >= 0 && snap[b] >= 0 ? dij(snap[a], snap[b]) : null;
  // si el trazado encontrado es demasiado largo (línea nueva que no está en Natural Earth), la app dibuja una curva aproximada
  if (r && r.len <= direct * (L.type === 'av' ? 1.45 : 1.95) + 15000) edges[id] = enc(dp([ST[a].c, ...r.path.map(i => P[i]), ST[b].c], 0.0015));
  else fallback.push(id);
}
console.log(`tramos con trazado real: ${Object.keys(edges).length} · aproximados: ${fallback.join(', ') || 'ninguno'}`);

// --- 2. Mapa base integrado: países y provincias
const C = await getJSON('ne_10m_admin_0_countries.geojson', NE + 'ne_10m_admin_0_countries.geojson');
const bb = [34.2, -11.5, 45.2, 5.5], inbb = p => p[1] > bb[0] && p[1] < bb[2] && p[0] > bb[1] && p[0] < bb[3];
const land = [];
for (const f of C.features) {
  const a3 = f.properties.ADM0_A3; if (!['ESP', 'PRT', 'FRA', 'AND', 'MAR', 'DZA', 'GIB'].includes(a3)) continue;
  for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)) {
    const ring = poly[0]; if (!ring.some(inbb)) continue;
    const pts = dp(ring.map(([x, y]) => [Math.max(bb[0]-1, Math.min(bb[2]+1, y)), Math.max(bb[1]-1, Math.min(bb[3]+1, x))]), 0.006);
    if (pts.length >= 4) land.push({ c: a3, p: enc(pts) });
  }
}
const PL = await getJSON('ne_10m_admin_1_states_provinces_lines.geojson', NE + 'ne_10m_admin_1_states_provinces_lines.geojson');
const prov = [];
for (const f of PL.features) if (f.properties.ADM0_A3 === 'ESP')
  for (const l of (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)) { const pts = dp(l.map(([x, y]) => [y, x]), 0.006); if (pts.length > 1) prov.push(enc(pts)); }

// --- 3. Catálogo de estaciones (código Adif/Renfe, nombre, posición)
const est = await getJSON('estaciones.geojson', STATION_SOURCES);
const cat = est.features.map(f => f.properties).filter(p => p.CODIGO < 99000)
  .map(p => [String(p.CODIGO).padStart(5, '0'), p.NOMBRE, +(+p.LAT).toFixed(5), +(+p.LON).toFixed(5)]);

writeFileSync(join(root, 'src/geodata.json'), JSON.stringify({ edges, land, prov, cat }));
console.log(`src/geodata.json actualizado · ${cat.length} estaciones`);
