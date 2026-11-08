// renfe-proxy — reenvía (con CORS) los dos ficheros públicos del visor de tiempo real de Renfe.
// Sólo admite esos dos destinos, así que no es un proxy abierto. Caché corta en memoria para no
// multiplicar las peticiones a Renfe cuando hay varios visitantes a la vez.
//   GET /functions/v1/renfe-proxy?f=flota   -> flotaLD.json (posiciones, retrasos)
//   GET /functions/v1/renfe-proxy?f=rutas   -> trenesConEstacionesLD.json (recorridos y horarios)

const BASE = "https://tiempo-real.largorecorrido.renfe.com/renfe-visor/";
const SOURCES: Record<string, { file: string; ttl: number }> = {
  flota: { file: "flotaLD.json", ttl: 2_000 },
  rutas: { file: "trenesConEstacionesLD.json", ttl: 60_000 },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Expose-Headers": "x-cache, x-upstream-age",
  "Access-Control-Max-Age": "86400",
};

type Entry = { at: number; body: string };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry>>();

function reply(e: Entry, tag: string): Response {
  return new Response(e.body, {
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "x-cache": tag,
      "x-upstream-age": String(Date.now() - e.at),
    },
  });
}

function refresh(key: string): Promise<Entry> {
  let p = inflight.get(key);
  if (!p) {
    p = fetch(BASE + SOURCES[key].file, {
      headers: { "User-Agent": "TrainViewer (+https://github.com/OtazuaMiguel/TrainViewer)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Renfe HTTP " + r.status);
        const body = await r.text();
        JSON.parse(body); // sólo se guarda si es JSON válido
        const e = { at: Date.now(), body };
        cache.set(key, e);
        return e;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return new Response("Método no permitido", { status: 405, headers: CORS });

  const key = new URL(req.url).searchParams.get("f") ?? "flota";
  if (!SOURCES[key]) {
    return new Response(JSON.stringify({ error: "Parámetro f no válido (flota | rutas)" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < SOURCES[key].ttl) return reply(cached, "HIT");
  try {
    return reply(await refresh(key), "MISS");
  } catch (err) {
    if (cached) return reply(cached, "STALE");
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
