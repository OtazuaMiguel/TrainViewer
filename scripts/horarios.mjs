// Horario oficial de Renfe (GTFS de Alta Velocidad, Larga y Media Distancia) -> horarios.json compacto
// con los trenes de ayer, hoy y mañana (hora peninsular). Uso: node scripts/horarios.mjs <carpeta GTFS> <salida.json>
// Formato de salida:
//   stops:    { código: [nombre, lat, lon] }
//   products: [ 'AVE', 'ALVIA', ... ]
//   days:     { 'AAAA-MM-DD': [ [número, índiceProducto, [código, llegadaMin, salidaMin, código, ...]], ... ] }
//             (minutos desde la medianoche de ese día; pueden pasar de 1440 si el tren cruza la medianoche)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('Uso: node scripts/horarios.mjs <carpeta GTFS> <salida.json>'); process.exit(1); }

function csv(file) {
  const text = readFileSync(join(dir, file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = line => { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const v = split(l), o = {}; head.forEach((h, i) => o[h] = v[i] ?? ''); return o; });
}
const norm = c => String(c).trim().replace(/^0+(?=\d)/, '');
const mins = t => { const m = /^(\d+):(\d\d)(?::(\d\d))?$/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : null; };

// Fechas (Madrid) de ayer, hoy y mañana
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const days = [-1, 0, 1].map(k => fmt.format(new Date(Date.now() + k * 864e5)));      // AAAA-MM-DD
const ymd = d => d.replace(/-/g, '');
const weekday = d => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(d + 'T12:00:00Z').getUTCDay()];

const routes = new Map(csv('routes.txt').map(r => [r.route_id, r.route_short_name || r.route_long_name || 'Tren']));
const trips = csv('trips.txt');
const cal = new Map(csv('calendar.txt').map(c => [c.service_id, c]));
const exc = new Map();
try { for (const e of csv('calendar_dates.txt')) { if (!exc.has(e.service_id)) exc.set(e.service_id, new Map()); exc.get(e.service_id).set(e.date, e.exception_type); } } catch {}
const runs = (sid, d) => {
  const e = exc.get(sid)?.get(ymd(d));
  if (e === '1') return true; if (e === '2') return false;
  const c = cal.get(sid); return !!c && c.start_date <= ymd(d) && ymd(d) <= c.end_date && c[weekday(d)] === '1';
};

// Paradas por viaje
const st = new Map();
for (const s of csv('stop_times.txt')) {
  if (!st.has(s.trip_id)) st.set(s.trip_id, []);
  st.get(s.trip_id).push([+s.stop_sequence, norm(s.stop_id), mins(s.arrival_time), mins(s.departure_time)]);
}
const products = [], pIdx = p => { let i = products.indexOf(p); if (i < 0) { i = products.length; products.push(p); } return i; };
const usedStops = new Set();
const out_days = {};
for (const d of days) {
  const list = [];
  for (const t of trips) {
    if (!runs(t.service_id, d)) continue;
    const s = (st.get(t.trip_id) || []).sort((a, b) => a[0] - b[0]);
    if (s.length < 2) continue;
    // Ayer sólo interesa si el tren sigue circulando pasada la medianoche
    if (d === days[0] && Math.max(...s.map(x => x[3] ?? x[2] ?? 0)) < 1440) continue;
    const flat = [];
    for (const [, code, a, dep] of s) { flat.push(code, a ?? dep, dep ?? a); usedStops.add(code); }
    list.push([norm(t.trip_short_name || t.trip_id), pIdx(routes.get(t.route_id) || 'Tren'), flat]);
  }
  list.sort((a, b) => a[2][2] - b[2][2]);
  out_days[d] = list;
}
const stops = {};
for (const s of csv('stops.txt')) { const c = norm(s.stop_id); if (usedStops.has(c)) stops[c] = [s.stop_name, +(+s.stop_lat).toFixed(5), +(+s.stop_lon).toFixed(5)]; }

const result = { generated: new Date().toISOString(), source: 'https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip', today: days[1], products, stops, days: out_days };
writeFileSync(out, JSON.stringify(result));
console.log(`horarios.json: ${Object.keys(stops).length} estaciones · ` + days.map(d => `${d}: ${out_days[d].length} trenes`).join(' · ') + ` · ${(JSON.stringify(result).length / 1024).toFixed(0)} KB`);
