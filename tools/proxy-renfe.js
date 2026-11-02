// Proxy CORS mínimo para el mapa ferroviario (opcional).
// Uso:  node proxy-renfe.js   → en la app, «Fuente de datos» → Proxy propio: http://localhost:8787/?url={url}
// Sólo reenvía peticiones GET a los ficheros públicos del visor de Renfe.
const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8787;
const ALLOWED_HOST = 'tiempo-real.largorecorrido.renfe.com';
const ALLOWED_PATHS = new Set(['/renfe-visor/flotaLD.json', '/renfe-visor/trenesConEstacionesLD.json']);

http.createServer((req, res) => {
  const cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Cache-Control': 'no-store'};
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let target;
  try { target = new URL(new URL(req.url, 'http://localhost').searchParams.get('url')); } catch { target = null; }
  if (!target || target.protocol !== 'https:' || target.hostname !== ALLOWED_HOST || !ALLOWED_PATHS.has(target.pathname)) {
    res.writeHead(400, {...cors, 'Content-Type': 'text/plain'}); return res.end('URL no permitida');
  }
  https.get(target, {headers: {'User-Agent': 'mapa-ferroviario-proxy/1.0'}}, up => {
    res.writeHead(up.statusCode || 502, {...cors, 'Content-Type': up.headers['content-type'] || 'application/json'});
    up.pipe(res);
  }).on('error', e => { res.writeHead(502, {...cors, 'Content-Type': 'text/plain'}); res.end('Error: ' + e.message); });
}).listen(PORT, () => console.log(`Proxy Renfe escuchando en http://localhost:${PORT}/?url={url}`));
