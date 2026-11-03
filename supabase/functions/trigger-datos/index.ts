// trigger-datos — lo llama pg_cron cada 15 min. Pide a GitHub que ejecute el flujo «datos»
// (histórico, incidencias de Adif y horario) del repositorio TrainViewer, porque el programador
// de GitHub lanza las ejecuciones programadas con mucho retraso.
// Necesita el secreto GITHUB_TOKEN: token de grano fino con acceso sólo a Paticuaker/TrainViewer
// y permiso «Actions: Read and write».
const REPO = "Paticuaker/TrainViewer";
const WORKFLOW = "datos.yml";
const MIN_GAP_MS = 12 * 60 * 1000;   // si GitHub ya lo ejecutó hace poco, no se duplica

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) return json({ ok: false, error: "Falta el secreto GITHUB_TOKEN" }, 500);
  const gh = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TrainViewer-cron",
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

  // ¿Hay una ejecución en curso o muy reciente?
  const runs = await gh("/runs?per_page=1");
  if (!runs.ok) return json({ ok: false, step: "consultar ejecuciones", status: runs.status, error: await runs.text() }, 502);
  const last = (await runs.json()).workflow_runs?.[0];
  if (last) {
    const age = Date.now() - Date.parse(last.created_at);
    if (last.status !== "completed" || age < MIN_GAP_MS) {
      return json({ ok: true, skipped: true, reason: last.status !== "completed" ? "ejecución en curso" : "ejecución reciente", last: last.created_at });
    }
  }
  const r = await gh("/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }), headers: { "Content-Type": "application/json" } });
  if (r.status !== 204) return json({ ok: false, step: "lanzar flujo", status: r.status, error: await r.text() }, 502);
  return json({ ok: true, dispatched: true, at: new Date().toISOString() });
});
