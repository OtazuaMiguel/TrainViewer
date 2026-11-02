// Interpreta los textos de Adif (estado de la red y avisos) y los sitúa sobre los tramos del mapa.
// Reglas, por frase:
//   «entre X y/e Y», «línea/tramo/trayecto X-Y(-Z)», «Obras X-Y»  -> pares de lugares
//   «se sigue prestando / se mantiene el servicio en ...»           -> tramos EXCLUIDOS (funcionan)
//   «restablec / puesta en servicio / reanud»                       -> se ignora (ya no hay incidencia)
//   gravedad: interrump|cortad|suspend|cerrad|por carretera -> corte; retras|limitaci|vía única|únicamente -> precaución
// Los lugares se buscan en las estaciones de la red, el catálogo de Renfe y un pequeño nomenclátor de municipios.
import { ST, EDGES, CAT, hav, nearestOnEdges, stationPath, sliceEdge } from './network.mjs';

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\//g, ' / ').replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Municipios y puntos que aparecen en avisos y no son estaciones del catálogo
const GAZ = {
  'urda': [39.411, -3.716], 'mora': [39.685, -3.773], 'orgaz': [39.648, -3.879], 'villarrubia de santiago': [39.983, -3.367],
  'valdemoro': [40.191, -3.676], 'santa cruz de mudela': [38.642, -3.466], 'bobadilla': [37.040, -4.727], 'plasencia de jalon': [41.690, -1.241],
  'hernani': [43.266, -1.977], 'redondela': [42.283, -8.609], 'o porrino': [42.161, -8.620], 'lorca': [37.677, -1.701], 'aguilas': [37.406, -1.583],
  'archena': [38.117, -1.300], 'sagunt': [39.680, -0.278], 'sagunto': [39.680, -0.278], 'caudiel': [39.957, -0.563], 'alcoi': [38.698, -0.474],
  'huercal viator': [36.837, -2.425], 'la sagra': [40.090, -3.830], 'torrejon de velasco': [40.187, -3.777], 'parla': [40.237, -3.774],
  'adamuz': [38.027, -4.522], 'brazatortas': [38.657, -4.290], 'villanueva de cordoba': [38.323, -4.628], 'alcolea': [37.940, -4.668],
};
// Regiones / ciudades genéricas -> estación de referencia
const REGION = {
  'andalucia': 'SEV', 'comunitat valenciana': 'VLC', 'comunidad valenciana': 'VLC', 'levante': 'VLC', 'region de murcia': 'MUR',
  'galicia': 'SCQ', 'asturias': 'OVI', 'cantabria': 'SAN', 'cataluna': 'BCN', 'catalunya': 'BCN', 'pais vasco': 'BIL', 'euskadi': 'BIL',
  'extremadura': 'BAD', 'aragon': 'ZAR', 'castilla y leon': 'VAL', 'navarra': 'PAM', 'la rioja': 'LOG', 'francia': 'FIG',
};
const STATION_ALIAS = { 'donostia': 'SSB', 'donostia/san sebastian': 'SSB', 'san sebastian': 'SSB', 'valencia': 'VLC', 'alacant': 'ALC', 'castello': 'CAS', 'irun': 'IRU', 'a coruna': 'COU', 'la coruna': 'COU' };

// Nomenclátor: nombre normalizado -> {c, st?}
const PLACES = new Map();
const add = (name, c, st) => { const k = norm(name); if (k.length >= 3 && !PLACES.has(k)) PLACES.set(k, { name, c, st }); };
for (const k in ST) if (!ST[k].j) add(ST[k].n, ST[k].c, k);
for (const [n, st] of Object.entries(STATION_ALIAS)) add(n, ST[st].c, st);
for (const [n, c] of Object.entries(GAZ)) add(n, c);
for (const s of CAT) { add(s.n, s.c); const base = s.n.split(/ - |\//)[0]; if (base.length >= 4) add(base, s.c); }
const REGION_KEYS = Object.keys(REGION).sort((a, b) => b.length - a.length);
const PLACE_KEYS = [...PLACES.keys()].sort((a, b) => b.length - a.length);

// Busca el lugar más largo contenido en una frase corta
export function resolvePlace(phrase) {
  const p = ' ' + norm(phrase) + ' ';
  for (const r of REGION_KEYS) if (p.includes(' ' + r + ' ')) return { name: r, c: ST[REGION[r]].c, st: REGION[r], region: true, pos: p.indexOf(' ' + r + ' ') };
  let best = null;
  for (const k of PLACE_KEYS) { const i = p.indexOf(' ' + k + ' '); if (i >= 0 && (!best || i < best.pos)) { best = { ...PLACES.get(k), key: k, pos: i }; if (i <= 1) break; } }
  return best;
}

// Último lugar nombrado en un texto (para «entre esta y …»)
function lastPlace(text) {
  const p = ' ' + norm(text) + ' ';
  let best = null;
  for (const k of PLACE_KEYS) { const i = p.lastIndexOf(' ' + k + ' '); if (i >= 0 && (!best || i > best.pos)) best = { ...PLACES.get(k), key: k, pos: i }; }
  return best;
}

const SEV_CUT = /interrump|cortad|suspend|cerrad|sin circulaci|por carretera|transbord|transporte alternativo/;
const SEV_WARN = /retras|limitaci|via unica|unicamente|incidencia|averia|afectad/;
const RESTORED = /restablec|puesta en servicio|reanud|normalizad|se recupera|recupera(n)? (la|su) (circulacion|normalidad)/;
const OPERATING = /se sigue prestando|se mantiene(n)? (el|la|los)? ?(servicio|circulacion)|mantiene(n)? su (operacion|servicio)|siguen circulando|sigue operativ/;
const COMMUTER = /cercanias|rodalies|linea [cr]\d|\b[cr]\d{1,2}[a-z]?\b/;
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Pares de lugares en una frase (texto original, para respetar mayúsculas y guiones)
const NAME = "[A-ZÁÉÍÓÚÑ][\\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*(?:\\s(?:de|del|la|el|de la)?\\s?[A-ZÁÉÍÓÚÑ][\\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*)*";
const HYPHEN_CHAIN = new RegExp(`(?:^|[\\s(])(${NAME}(?:\\s?-\\s?${NAME})+)`, 'g');
export function pairsIn(sentence, generic = false) {
  const out = [];
  for (const m of sentence.matchAll(/\bentre\s+(?:las estaciones de |los municipios de )?(.+?)\s+(?:y|e)\s+(?:la |el |las |los )?(.+?)(?=[.,;:(]|\s+(?:en|por|hasta|desde|durante|se|para|registran|est[aá]|permanece|queda|ha|han|a partir)\b|$)/gi)) {
    let x = m[1];
    if (/^(esta|este|ella|dicha|dicho)$/i.test(x.trim())) { const lp = lastPlace(sentence.slice(0, m.index)); if (lp) x = lp.name; }
    out.push([x, m[2], 'entre']);
  }
  // Cadenas «A-B-C» sueltas (p. ej. «Madrid-Toledo y Málaga-Sevilla») en frases que hablan del servicio
  if (generic) for (const m of sentence.matchAll(HYPHEN_CHAIN)) {
    const parts = m[1].split(/\s?-\s?/);
    for (let i = 0; i < parts.length - 1; i++) out.push([parts[i], parts[i + 1], 'linea']);
  }
  for (const m of sentence.matchAll(/\b(?:l[ií]nea|tramos?|trayecto|recorrido|relaci[oó]n|corredor|obras(?: en la l[ií]nea)?|obras)\s+(?:de alta velocidad |de ancho convencional |ferroviari[ao] |convencional )?((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*(?:\s(?:de|del|la|el|y|de la)?\s?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*)*)(?:\s?-\s?(?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*(?:\s(?:de|del|la|el|de la)?\s?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚáéíóúñÑçÇ'·/.]*)*))+)/g)) {
    const parts = m[1].split(/\s?-\s?/);
    for (let i = 0; i < parts.length - 1; i++) out.push([parts[i], parts[i + 1], 'linea']);
  }
  return out;
}

// Une dos lugares por la red: devuelve trozos {edge, s0, s1}
function connect(A, B, mode) {
  const allow = e => mode === 'av' ? e.type === 'av' : mode === 'conv' ? e.type === 'conv' : true;
  const pool = EDGES.filter(allow);
  // Todas las líneas que pasan a menos de 8 km del lugar (un nudo como Sagunto está en varias)
  const snaps = P => P.st ? [{ st: P.st }] : pool.map(e => nearestOnEdges(P.c, [e])).filter(n => n && n.d < 8000);
  const SA = snaps(A), SB = snaps(B);
  if (!SA.length || !SB.length) return null;
  const straight = hav(A.c, B.c);
  let win = null;
  for (const a of SA) for (const b of SB) { const c = connectSnaps(a, b, allow); if (c && (!win || c.len < win.len)) win = c; }
  if (!win || win.len > straight * 2.2 + 25000) return null;   // rodeo absurdo: no se marca
  return { ...win, straight };
}
function connectSnaps(a, b, allow) {
  if (a.e && b.e && a.e === b.e) return { pieces: [{ e: a.e, s0: a.s, s1: b.s }], len: Math.abs(a.s - b.s) };
  // Extremos candidatos (estación o extremos del tramo donde cae el lugar)
  const ends = x => x.st ? [{ st: x.st, extra: 0, piece: null }] : [
    { st: x.e.a, extra: x.s, piece: { e: x.e, s0: 0, s1: x.s } },
    { st: x.e.b, extra: x.e.len - x.s, piece: { e: x.e, s0: x.s, s1: x.e.len } }];
  let best = null;
  for (const ea of ends(a)) for (const eb of ends(b)) {
    const p = ea.st === eb.st ? { edges: [], len: 0 } : stationPath(ea.st, eb.st, allow);
    if (!p) continue;
    const len = ea.extra + p.len + eb.extra;
    if (!best || len < best.len) best = { len, pieces: [ea.piece, ...p.edges.map(e => ({ e, s0: 0, s1: e.len })), eb.piece].filter(Boolean) };
  }
  return best;
}

function datesIn(t) {
  const out = [];
  for (const m of t.matchAll(/(\d{1,2})(?:\s*(?:,|y|al|-)\s*(\d{1,2}))*\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/g)) {
    const mo = MONTHS.indexOf(m[3]); const days = m[0].match(/\d{1,2}(?=\D)/g).map(Number);
    for (const d of days) out.push([mo, d]);
  }
  return out;
}

// item: {id, kind:'estado'|'aviso', title, zones, text, url}
export function interpret(item, today = new Date()) {
  const full = `${item.title}. ${item.text}`;
  const n = norm(full);
  const res = { ...item, severity: 'info', note: null, pieces: [], unmatched: [] };
  if (RESTORED.test(norm(item.title))) { res.severity = 'ok'; return res; }
  let itemSev = SEV_CUT.test(n) ? 'cut' : SEV_WARN.test(n) ? 'warn' : 'info';
  // Cortes programados en fechas concretas (fines de semana…): sólo cuentan si hoy es uno de esos días
  const dates = datesIn(n);
  if (itemSev === 'cut' && /fines de semana|los dias|siguientes|durante los/.test(n) && dates.length > 1) {
    const hit = dates.some(([mo, d]) => mo === today.getMonth() && d === today.getDate());
    if (!hit) { itemSev = 'plan'; res.note = 'Corte programado en fechas concretas; hoy hay servicio'; }
  }
  if (/unicamente|de lunes a|solo (los )?dias|horario/.test(n) && itemSev === 'cut') itemSev = 'warn';
  res.severity = itemSev;
  if (itemSev === 'info' || itemSev === 'ok') return res;

  const mode = /alta velocidad|\bave\b|\blav\b/.test(n) ? 'av' : 'any-conv';
  const sentences = full.split(/(?<=[.;])\s+/);
  const keep = [], drop = [];
  let specific = false;
  const found = [];
  for (const s of sentences) {
    const ns = norm(s);
    if (RESTORED.test(ns)) continue;
    const operating = OPERATING.test(ns);
    const generic = SEV_CUT.test(ns) || OPERATING.test(ns) || /retras|limitaci|via unica|unicamente|^obras/.test(ns);
    for (const [x, y, how] of pairsIn(s, generic)) {
      const A = resolvePlace(x), B = resolvePlace(y);
      if (!A || !B || A.key === B.key) { res.unmatched.push(`${x} / ${y}`); continue; }
      found.push({ A, B, how, operating, sev: SEV_CUT.test(ns) ? 'cut' : SEV_WARN.test(ns) ? 'warn' : itemSev });
      if (!operating && how === 'entre' && !A.region && !B.region) specific = true;
    }
  }
  for (const f of found) {
    if (!f.operating && f.how === 'entre' && (f.A.region || f.B.region) && specific) continue;   // «trenes entre Madrid y Andalucía» si ya hay un punto concreto
    // Sin «alta velocidad» en el texto se usan solo vías convencionales (evita marcar la LAV por obras de la red convencional)
    const tries = mode === 'av' ? ['av', 'any'] : ['conv'];
    let c = null; for (const m of tries) { c = connect(f.A, f.B, m); if (c) break; }
    if (!c) { res.unmatched.push(`${f.A.name} – ${f.B.name}`); continue; }
    (f.operating ? drop : keep).push(...c.pieces.map(p => ({ ...p, sev: f.sev === 'info' ? itemSev : (itemSev === 'plan' ? 'plan' : f.sev) })));
  }
  // Quita los tramos que Adif dice que siguen funcionando
  const dropped = new Set(drop.filter(p => (Math.abs(p.s1 - p.s0) / p.e.len) > 0.5).map(p => p.e.id));
  const seen = new Set(), rank = { cut: 3, warn: 2, plan: 1 };
  keep.sort((x, y) => rank[y.sev] - rank[x.sev]);                 // si un tramo sale dos veces, gana la frase más grave
  res.pieces = keep.filter(p => !dropped.has(p.e.id) && Math.abs(p.s1 - p.s0) > 200).filter(p => {
    const k = `${p.e.id}:${Math.round(Math.min(p.s0, p.s1) / 500)}:${Math.round(Math.max(p.s0, p.s1) / 500)}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
  if (!res.pieces.length) res.note = res.note || (COMMUTER.test(n) ? 'Cercanías/Rodalies: fuera de la red del mapa' : 'Tramo fuera de las líneas dibujadas en el mapa');
  return res;
}

// Une los trozos de todas las incidencias y genera la salida para la app
export function compile(items, today = new Date()) {
  const out = { items: [], overlays: [], edges: {} };
  const rank = { plan: 1, warn: 2, cut: 3 };
  for (const it of items) {
    const r = interpret(it, today);
    out.items.push({ id: r.id, kind: r.kind, title: r.title, zones: r.zones, text: r.text, url: r.url, severity: r.severity, note: r.note,
                     edges: [...new Set(r.pieces.map(p => p.e.id))], unmatched: r.unmatched });
    for (const p of r.pieces) {
      out.overlays.push({ item: r.id, sev: p.sev, edge: p.e.id, coords: sliceEdge(p.e, p.s0, p.s1) });
      const frac = Math.abs(p.s1 - p.s0) / p.e.len, cur = out.edges[p.e.id];
      if (p.sev === 'plan') continue;
      if (!cur || rank[p.sev] > rank[cur.sev]) out.edges[p.e.id] = { sev: p.sev, frac: +frac.toFixed(2), item: r.id };
    }
  }
  return out;
}
