// Red ferroviaria idéntica a la de la app: lee ST, LINES y las funciones de geometría de src/app.html
// y las vías de src/geodata.json, para que los tramos calculados aquí coincidan con los del mapa.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = readFileSync(join(root, 'src/app.html'), 'utf8');
const geo = JSON.parse(readFileSync(join(root, 'src/geodata.json'), 'utf8'));

const grab = re => { const m = app.match(re); if (!m) throw new Error('No encontrado en app.html: ' + re); return m[1]; };
export const ST = eval('(' + grab(/const ST = (\{[\s\S]*?\n\});/) + ')');
export const LINES = eval(grab(/const LINES = (\[[\s\S]*?\n\]);/));
// Funciones copiadas tal cual de la app (una línea o varias, cerradas por "}" al inicio de línea)
const fnOf = n => { const one = app.match(new RegExp('^(function ' + n + '\\(.*\\})\\s*$', 'm')); return one ? one[1] : grab(new RegExp('^(function ' + n + '\\([\\s\\S]*?\\n\\})', 'm')); };
const fnSrc = ['mulberry32', 'hash', 'decodePolyline', 'buildGeom'].map(fnOf);
const RAD = Math.PI / 180;
const { mulberry32, hash, decodePolyline, buildGeom } = new Function('RAD', fnSrc.join('\n') + '\nreturn {mulberry32, hash, decodePolyline, buildGeom};')(RAD);
export { decodePolyline };

export function hav(a, b) {
  const dLa = (b[0] - a[0]) * RAD, dLo = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

export const EDGES = [];
export const ADJ = {};
for (const k in ST) ADJ[k] = [];
for (const L of LINES) for (let i = 0; i < L.path.length - 1; i++) {
  const a = L.path[i], b = L.path[i + 1], id = a + '-' + b;
  const geom = geo.edges[id] ? decodePolyline(geo.edges[id]) : buildGeom(ST[a].c, ST[b].c, hash(id));
  const cum = [0];
  for (let j = 1; j < geom.length; j++) cum.push(cum[j - 1] + hav(geom[j - 1], geom[j]));
  const e = { id, a, b, type: L.type, line: L.name, name: `${ST[a].n} – ${ST[b].n}`, geom, cum, len: cum[cum.length - 1] };
  EDGES.push(e); ADJ[a].push({ e, to: b }); ADJ[b].push({ e, to: a });
}
export const EDGE = Object.fromEntries(EDGES.map(e => [e.id, e]));
export const CAT = geo.cat.map(([code, n, la, lo]) => ({ code, n, c: [la, lo] }));

// Punto más cercano de un conjunto de tramos
export function nearestOnEdges(p, edges) {
  let best = null;
  const k = Math.cos(p[0] * RAD);
  for (const e of edges) {
    const g = e.geom;
    for (let i = 0; i < g.length - 1; i++) {
      const ax = g[i][1] * k, ay = g[i][0], bx = g[i + 1][1] * k, by = g[i + 1][0], px = p[1] * k, py = p[0];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111195;
      if (!best || d < best.d) best = { e, d, s: e.cum[i] + t * (e.cum[i + 1] - e.cum[i]) };
    }
  }
  return best;
}

// Camino más corto entre dos estaciones de la red; `allow(e)` filtra los tramos utilizables
export function stationPath(o, d, allow = () => true) {
  const dist = {}, prev = {}, done = new Set();
  for (const k in ST) dist[k] = Infinity;
  dist[o] = 0;
  for (;;) {
    let u = null, best = Infinity;
    for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
    if (u === null) return null;
    if (u === d) break;
    done.add(u);
    for (const { e, to } of ADJ[u]) {
      if (!allow(e)) continue;
      const nd = best + e.len;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = { u, e }; }
    }
  }
  const edges = [];
  for (let k = d; k !== o; k = prev[k].u) edges.unshift(prev[k].e);
  return { edges, len: dist[d] };
}

// Trozo de geometría de un tramo entre dos distancias
export function sliceEdge(e, s0, s1) {
  if (s0 > s1) [s0, s1] = [s1, s0];
  const at = s => {
    let i = 1; while (i < e.cum.length - 1 && e.cum[i] < s) i++;
    const f = (s - e.cum[i - 1]) / ((e.cum[i] - e.cum[i - 1]) || 1), p = e.geom[i - 1], q = e.geom[i];
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  };
  const pts = [at(s0)];
  for (let i = 0; i < e.geom.length; i++) if (e.cum[i] > s0 && e.cum[i] < s1) pts.push(e.geom[i]);
  pts.push(at(s1));
  return pts.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
}
