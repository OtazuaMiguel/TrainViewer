// Regenera src/geodata.json: trazado real de las vías, mapa base integrado y catálogo de estaciones.
// Fuentes: Natural Earth (dominio público) y el catálogo público de estaciones de Renfe.
// Uso: node scripts/build-geodata.mjs   (descarga ~75 MB a .cache/ la primera vez)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

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
let edges = {}, sec, fallback = [];
const neEdges = {};
{ const snap = {}; for (const k in ST) { const [n] = near(ST[k].c, 12000); snap[k] = n; }
  for (const L of LINES) for (let i = 0; i < L.path.length - 1; i++) {
    const a = L.path[i], b = L.path[i + 1], id = a + '-' + b, direct = hav(ST[a].c, ST[b].c);
    const r = snap[a] >= 0 && snap[b] >= 0 ? dij(snap[a], snap[b]) : null;
    // si el trazado encontrado es demasiado largo (línea nueva que no está en Natural Earth), la app dibuja una curva aproximada
    if (r && r.len <= direct * (L.type === 'av' ? 1.45 : 1.95) + 15000) neEdges[id] = enc(dp([ST[a].c, ...r.path.map(i => P[i]), ST[b].c], 0.0015));
    else fallback.push(id);
  } }

// --- 1b. Trazado real de OpenStreetMap (rama «osm», generada por el flujo vias.yml). Si no está, se usa Natural Earth.
const est = await getJSON('estaciones.geojson', STATION_SOURCES);
const C0 = await getJSON('ne_10m_admin_0_countries.geojson', NE + 'ne_10m_admin_0_countries.geojson');
let osm = null;
try {
  const f = join(cache, 'osm-rail.json.gz');
  if (!existsSync(f)) {
    const r = await fetch('https://raw.githubusercontent.com/Paticuaker/TrainViewer/osm/osm-rail.json.gz');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  osm = JSON.parse(gunzipSync(readFileSync(f)).toString());
} catch (e) { console.warn('Sin trazado de OpenStreetMap (' + e.message + '): se usa Natural Earth'); }

if (!osm) {
  edges = neEdges;
  sec = rail.map(l => dp(l, 0.002)).filter(l => l.length > 1).map(enc);
  console.log(`tramos con trazado real: ${Object.keys(edges).length} · aproximados: ${fallback.join(', ') || 'ninguno'}`);
} else {
  ({ edges, sec } = fromOSM(osm));
}

function fromOSM(osm) {
  // Clases de vía: «hs» ancho estándar / alta velocidad, «ib» ancho ibérico, «nar» vía estrecha
  const cls = t => {
    const g = t.gauge || '', hsTag = t.highspeed === 'yes', hs = hsTag || /1435/.test(g), ib = /1668/.test(g) || (!g && !hs && t.railway !== 'narrow_gauge');
    const nar = t.railway === 'narrow_gauge' || (!hs && !ib && /^(1000|914|600)/.test(g));
    return { hs, ib, nar, hsTag };
  };
  const skipUse = new Set(['industrial', 'military', 'tourism', 'test']);
  // En Francia sólo interesa el corredor de los trenes de Renfe (Perpiñán – Montpellier – Marsella / Lyon)
  const FR = (C0.features.find(f => f.properties.ADM0_A3 === 'FRA')?.geometry.coordinates || []).map(p => p[0]);
  const inRing = ([la, lo], ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inFrance = p => p[0] > 42.3 && FR.some(r => inRing(p, r));
  const ways = osm.ways.filter(w => !skipUse.has(w.t.usage)).filter(w => { const m = w.g[w.g.length >> 1]; return !(m[1] < 2.6 && inFrance(m)); }).map(w => ({ ...w, c: cls(w.t) }));
  const key = p => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const idx = new Map(), N = [], A = [], NC = [];   // nodos, adyacencia [vecino, metros, clase], clases que pasan por el nodo
  const nid = p => { const k = key(p); let i = idx.get(k); if (i === undefined) { i = N.length; idx.set(k, i); N.push(p); A.push([]); NC.push({ hs: false, ib: false, nar: false, hsTag: false }); } return i; };
  const NR = new Map();   // nodos extremos de vía -> líneas (ref/nombre) a las que pertenecen
  for (const w of ways) {
    let prev = -1;
    const line = w.t.ref || w.t.name;
    if (line) for (const p of [w.g[0], w.g[w.g.length - 1]]) { const i = nid(p); (NR.get(i) || NR.set(i, new Set()).get(i)).add(line); }
    for (const p of w.g) {
      const i = nid(p);
      for (const k in w.c) if (w.c[k]) NC[i][k] = true;
      if (prev >= 0 && prev !== i) { const d = hav(N[prev], N[i]); A[prev].push([i, d, w.c]); A[i].push([prev, d, w.c]); }
      prev = i;
    }
  }
  const GG = 0.02, grid = new Map(), gk2 = (a, b) => a + ':' + b;
  N.forEach((p, i) => { const k = gk2(Math.floor(p[0] / GG), Math.floor(p[1] / GG)); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const nearest = (p, maxD, ok) => {
    let best = -1, bd = maxD; const a = Math.floor(p[0] / GG), b = Math.floor(p[1] / GG), r = Math.ceil(maxD / 2000) + 1;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const n of grid.get(gk2(a + i, b + j)) || []) {
      if (ok && !ok(n)) continue; const d = hav(p, N[n]); if (d < bd) { bd = d; best = n; }
    }
    return [best, bd];
  };
  // Une extremos sueltos muy próximos (vías troceadas en OSM sin nodo común)
  let joined = 0;
  for (let i = 0; i < N.length; i++) if (A[i].length === 1) {
    const [n, d] = nearest(N[i], 25, n => n !== i && n !== A[i][0][0]);
    if (n >= 0) { A[i].push([n, d, A[i][0][2]]); A[n].push([i, d, A[i][0][2]]); joined++; }
  }
  // Huecos en OSM dentro de una misma línea (p. ej. 266 m en la Monforte–Redondela junto a Ribadavia): se unen hasta 1,5 km
  let gaps = 0;
  for (const [i, ls] of NR) if (A[i].length === 1) {
    const [n, d] = nearest(N[i], 1500, n => n !== i && A[n].length === 1 && [...(NR.get(n) || [])].some(l => ls.has(l)) && hav(N[n], N[A[i][0][0]]) > d0(i, n));
    if (n >= 0) { A[i].push([n, d, A[i][0][2]]); A[n].push([i, d, A[i][0][2]]); gaps++; }
  }
  function d0(i, n) { return hav(N[i], N[n]); }   // el otro extremo debe quedar «por delante», no volviendo sobre la vía
  console.log(`OSM: ${gaps} huecos unidos dentro de una misma línea`);
  console.log(`OSM: ${ways.length} vías · ${N.length} nodos · ${joined} uniones de extremos sueltos`);

  // Coste de una vía según el tipo de línea que se busca
  const cost = (type, c) => c.nar ? 20 : type === 'av' ? (c.hs ? 1 : 1.8) : (c.ib ? (c.hsTag ? 1.15 : 1) : 2.5);
  const catBy = new Map(est.features.map(f => f.properties).map(p => [String(p.CODIGO).padStart(5, '0'), [+p.LAT, +p.LON]]));
  // Punto de anclaje de cada estación en cada clase de línea: la estación real (catálogo Renfe/Adif) sobre la vía de esa clase
  const anchorCache = {};
  function anchor(k, type) {
    const ck = k + type; if (anchorCache[ck]) return anchorCache[ck];
    const pref = n => type === 'av' ? NC[n].hs : NC[n].ib && !NC[n].hsTag;
    const pts = [...(ST[k].k || []).map(c => catBy.get(c)).filter(Boolean), ST[k].c];
    let best = null;
    for (const p of pts) for (const ok of [pref, n => !NC[n].nar]) {
      const [n, d] = nearest(p, 6000, ok);
      if (n >= 0) { const sc = d + (ok === pref ? 0 : 1500) + (p === ST[k].c ? 300 : 0); if (!best || sc < best.sc) best = { n, d, sc }; }
    }
    if (best) best.p = best.d > 400 ? (pts.find(p => hav(p, N[best.n]) <= best.d + 1) || ST[k].c) : null;   // estación lejos de toda vía de OSM
    return anchorCache[ck] = best;
  }
  // A* entre las vías de dos estaciones: sale de cualquier nodo a <400 m del ancla de origen y termina en el primero
  // a <400 m del de destino (así no da la vuelta para entrar por una vía concreta de la estación)
  const around = (n, R) => { const out = []; const p = N[n], a = Math.floor(p[0] / GG), b = Math.floor(p[1] / GG);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const m of grid.get(gk2(a + i, b + j)) || []) if (!NC[m].nar && hav(p, N[m]) <= R) out.push(m);
    return out; };
  function astar(s, t, type) {
    const goal = N[t], goals = new Set(around(t, 400)); goals.add(t);
    const g = new Float64Array(N.length).fill(Infinity), real = new Float64Array(N.length), prev = new Int32Array(N.length).fill(-1);
    const h = [];
    const push = x => { h.push(x); let i = h.length - 1; while (i > 0) { const q = (i - 1) >> 1; if (h[q][0] <= h[i][0]) break; [h[q], h[i]] = [h[i], h[q]]; i = q; } };
    const pop = () => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
    const hh = v => Math.max(0, hav(N[v], goal) - 400);
    for (const m of [s, ...around(s, 400)]) { if (g[m] === 0) continue; g[m] = 0; push([hh(m), m]); }
    const done = new Uint8Array(N.length);
    let end = -1;
    while (h.length) {
      const [, u] = pop(); if (done[u]) continue; done[u] = 1; if (goals.has(u)) { end = u; break; }
      for (const [v, d, c] of A[u]) { const nd = g[u] + d * cost(type, c); if (nd < g[v]) { g[v] = nd; real[v] = real[u] + d; prev[v] = u; push([nd + hh(v), v]); } }
    }
    if (end < 0) return null;
    const path = []; for (let u = end; u !== -1; u = prev[u]) path.push(N[u]);
    path.reverse();
    // se cierra en los puntos de anclaje para que los tramos consecutivos de una línea queden unidos
    if (hav(path[0], N[s]) > 1) path.unshift(N[s]);
    if (hav(path[path.length - 1], N[t]) > 1) path.push(N[t]);
    return { path, len: real[end], cost: g[end] };
  }

  // Bifurcaciones (j:1): el ancla es el punto real donde se separan las vías, que se busca como el último nodo
  // común de los caminos desde la estación anterior hacia cada una de las ramas
  for (const k in ST) if (ST[k].j) {
    const nb = [], type = LINES.find(L => L.path.includes(k))?.type || 'av';
    for (const L of LINES) { const i = L.path.indexOf(k); if (i > 0) nb.push(L.path[i - 1]); if (i >= 0 && i < L.path.length - 1) nb.push(L.path[i + 1]); }
    const [trunk, ...branches] = [...new Set(nb)];
    const T0 = anchor(trunk, type), paths = branches.map(b => { const B = anchor(b, type); return B && T0 ? astar(T0.n, B.n, type) : null; }).filter(Boolean);
    if (paths.length < 2) continue;
    // las vías dobles van por separado en OSM: se busca el primer punto en que las ramas se alejan más de 150 m
    const distTo = (p, line) => { let b = Infinity; const kx = Math.cos(p[0] * R);
      for (let i = 0; i < line.length - 1; i++) { const ax = line[i][1] * kx, ay = line[i][0], bx = line[i + 1][1] * kx, by = line[i + 1][0], px = p[1] * kx, py = p[0];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
        b = Math.min(b, Math.hypot(px - ax - t * dx, py - ay - t * dy) * 111195); }
      return b; };
    const A0p = paths[0].path, others = paths.slice(1).map(p => p.path);
    let at = -1;
    for (let i = 0; i < A0p.length; i++) if (others.some(o => distTo(A0p[i], o) > 150)) { at = Math.max(0, i - 1); break; }
    if (at < 0) continue;
    const pt = A0p[at], n = idx.get(key(pt));
    if (n === undefined) continue;
    anchorCache[k + type] = { n, d: hav(pt, ST[k].c), sc: 0, p: null };
    console.log(`bifurcación ${k}: ${pt[0].toFixed(4)}, ${pt[1].toFixed(4)} (a ${(hav(pt, ST[k].c) / 1000).toFixed(1)} km de la posición anterior)`);
  }
  const edges = {}, report = [];
  for (const L of LINES) for (let i = 0; i < L.path.length - 1; i++) {
    const a = L.path[i], b = L.path[i + 1], id = a + '-' + b, direct = hav(ST[a].c, ST[b].c);
    const A0 = anchor(a, L.type), B0 = anchor(b, L.type);
    const r = A0 && B0 ? astar(A0.n, B0.n, L.type) : null;
    if (r && r.len <= direct * (L.type === 'av' ? 1.6 : 2.1) + 20000) {
      const path = [...(A0.p ? [A0.p] : []), ...r.path, ...(B0.p ? [B0.p] : [])];
      edges[id] = enc(dp(path, 0.00012));
      report.push(`${id.padEnd(8)} ${(r.len / 1000).toFixed(0).padStart(4)} km · anclas a ${A0.d.toFixed(0)} m / ${B0.d.toFixed(0)} m`);
    } else if (neEdges[id]) { edges[id] = neEdges[id]; report.push(`${id.padEnd(8)} sin ruta OSM válida (${r ? (r.len / 1000).toFixed(0) + ' km' : 'sin camino'}) → Natural Earth`); }
    else report.push(`${id.padEnd(8)} sin trazado`);
  }
  console.log(report.join('\n'));

  // Red secundaria: cadenas de vía (de cruce a cruce), sin las vías dobles paralelas
  const deg = A.map(x => x.length);
  const seen = new Set(), chains = [];
  const ek = (u, v) => u < v ? u + '_' + v : v + '_' + u;
  for (let s = 0; s < N.length; s++) if (deg[s] !== 2) for (const [v0, , c0] of A[s]) {
    if (seen.has(ek(s, v0))) continue;
    const ch = [s]; let u = s, v = v0;
    for (;;) { seen.add(ek(u, v)); ch.push(v); if (deg[v] !== 2) break; const nx = A[v].find(x => x[0] !== u); if (!nx || seen.has(ek(v, nx[0]))) break; u = v; v = nx[0]; }
    chains.push(ch.map(i => N[i]));
  }
  const clen = c => { let s = 0; for (let i = 1; i < c.length; i++) s += hav(c[i - 1], c[i]); return s; };
  const withLen = chains.map(c => ({ c, len: clen(c) })).filter(x => x.len > 30).sort((x, y) => y.len - x.len);
  // Rejilla de puntos ya dibujados (empezando por la red principal) para descartar vías paralelas a <40 m
  const KG = 0.001, kept = new Set();
  const mark = pts => { for (let i = 0; i < pts.length - 1; i++) { const d = hav(pts[i], pts[i + 1]), n = Math.max(1, Math.ceil(d / 40)); for (let j = 0; j <= n; j++) { const f = j / n; kept.add(Math.round((pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f) / KG) + ':' + Math.round((pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f) / KG)); } } };
  const covered = p => { const a = Math.round(p[0] / KG), b = Math.round(p[1] / KG); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (kept.has((a + i) + ':' + (b + j))) return true; return false; };
  // marcado incremental: se rehace en orden para que una vía doble descarte a su gemela
  kept.clear(); for (const id in edges) mark(decodePoly(edges[id]));
  const final = [];
  for (const { c } of withLen) {
    let run = [];
    const flush = () => { if (run.length > 1 && clen(run) > 200) { final.push(run); mark(run); } run = []; };
    for (let i = 0; i < c.length; i++) {
      const p = c[i], cv = covered(p);
      if (!cv) { if (!run.length && i > 0) run.push(c[i - 1]); run.push(p); }
      else if (run.length) { run.push(p); flush(); }
    }
    flush();
  }
  // simplificación y troceado (trozos cortos = cajas pequeñas, búsquedas más rápidas en la app)
  const sec = [];
  for (const r of final) { const s = dp(r, 0.00025); for (let i = 0; i < s.length - 1; i += 120) sec.push(enc(s.slice(i, i + 121))); }
  console.log(`red secundaria: ${final.length} tramos · ${(final.reduce((s, r) => s + clen(r), 0) / 1000).toFixed(0)} km`);
  return { edges, sec };
}
function decodePoly(str) {
  const pts = []; let i = 0, la = 0, lo = 0;
  while (i < str.length) {
    for (const k of [0, 1]) { let r = 0, sh = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20); const v = r & 1 ? ~(r >> 1) : r >> 1; if (k) lo += v; else la += v; }
    pts.push([la / 1e5, lo / 1e5]);
  }
  return pts;
}

// --- 2. Mapa base integrado: países y provincias
const C = await getJSON('ne_10m_admin_0_countries.geojson', NE + 'ne_10m_admin_0_countries.geojson');
const bb = [34.2, -11.5, 46.3, 6.6], inbb = p => p[1] > bb[0] && p[1] < bb[2] && p[0] > bb[1] && p[0] < bb[3];
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
const cat = est.features.map(f => f.properties).filter(p => p.CODIGO < 99000)
  .map(p => [String(p.CODIGO).padStart(5, '0'), p.NOMBRE, +(+p.LAT).toFixed(5), +(+p.LON).toFixed(5)]);

writeFileSync(join(root, 'src/geodata.json'), JSON.stringify({ edges, sec, land, prov, cat }));
console.log(`src/geodata.json actualizado · ${cat.length} estaciones`);
