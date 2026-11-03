# TrainViewer

Mapa ferroviario de España en tiempo real: trenes de Alta Velocidad, Larga Distancia y Media Distancia sobre la red, estado de los tramos y paneles de llegadas y salidas por estación.

**Web:** https://paticuaker.github.io/TrainViewer/

## Qué hace

- **Mapa oscuro** con la red de vías dibujada sobre su trazado real (OpenStreetMap), ajustado a las posiciones GPS de los trenes. El fondo es el mapa gris oscuro de Esri y, si falla, el del IGN (oscurecido). Ninguno de los dos necesita clave de API. Si no carga ninguno, se ve un mapa base integrado en la propia página.
- **Trenes en tiempo real** como puntos de color según el tipo, con una flecha que indica su sentido y movimiento continuo sobre la vía. Tienen borde naranja con ≥10 min de retraso y rojo si están detenidos fuera de estación. Al pulsar uno se abre su ficha en la barra lateral: velocidad, retraso, próxima parada y el recorrido completo con horas programadas y estimadas. Desde ahí se puede seguir el tren en el mapa o ver su recorrido entero.
- **Estado de la vía con datos oficiales de Adif**: cada 15 min se leen «Estado de la red» y «Avisos» de Adif y se dibujan sobre el tramo exacto: rojo discontinuo para un corte, amarillo para una incidencia y punteado para un corte programado que hoy no aplica. Cada aviso enlaza a su fuente. En los tramos sin aviso oficial, el estado se deduce de los retrasos de los trenes que los recorren.
- **Modo foco**: al seleccionar un tren, o buscar un viaje como «Madrid Sevilla», solo su trayecto queda en color, siguiendo las vías reales y con sus paradas; el resto del mapa pasa a blanco y negro.
- **Puntualidad de los últimos 7 días**: gráfica con la media de cada día, a partir del histórico que se guarda cada 15 min.
- **Estaciones**: al pulsar una se ven las próximas llegadas y salidas con cuenta atrás, hora programada, hora estimada y retraso. El botón **Más información** abre el panel oficial de Adif (`info.adif.es/?s=<código>`).
- **Versión móvil** pensada para el dedo:
  - Mapa a pantalla completa con buscador flotante y botón «estación más cercana», que usa tu ubicación.
  - Panel inferior que se arrastra o se toca para pasar entre tres alturas.
  - Botones y filas grandes, texto que no provoca zoom en iPhone y márgenes para el notch.
  - El botón «atrás» del móvil cierra la ficha abierta.
  - Al elegir un tren o una estación, el mapa los encuadra en la parte visible.
- **Barra lateral** con buscador, indicadores (puntualidad, retraso medio, incidencias), filtros por tipo de tren, lista de trenes y registro de incidencias.
- **Modo simulación** de respaldo si no hay conexión con los datos de Renfe (incluye trenes de mercancías, que no tienen datos públicos).

## De dónde salen los datos

La app lee los ficheros públicos del visor de Renfe:

| Fichero | Contenido |
|---|---|
| `flotaLD.json` | posición GPS, retraso, próxima estación y material de cada tren |
| `trenesConEstacionesLD.json` | recorrido y hora de paso por cada parada |

Renfe no envía cabeceras CORS, así que el navegador no puede leerlos directamente desde otra web. La app prueba por orden:

1. **Proxy propio** (si lo configuras en «Fuente de datos»).
2. **Supabase** (fuente principal): la Edge Function `renfe-proxy` (`supabase/functions/renfe-proxy`) reenvía solo esos dos ficheros, añade CORS y guarda una caché de 2 s.
3. **Conexión directa.**
4. **Proxies CORS públicos** (allorigins, codetabs). Se pueden desactivar.
5. **Copia publicada por GitHub Actions** junto a la web (`data/*.json`), que se refresca en cada publicación. La app la marca como «Casi en directo» e indica su antigüedad.
6. Si nada responde, **simulación**, con un aviso en pantalla.

Las fuentes se prueban en paralelo. Si ninguna en directo responde en 4 s, se muestra la copia y se sigue intentando el directo. Nunca se sustituyen datos por otros más antiguos.

### Histórico e incidencias (rama `datos`)

El flujo `.github/workflows/datos.yml` se ejecuta cada ~15 min:

- `scripts/datos.mjs` guarda una muestra de puntualidad (últimos 8 días) en `historico.json`.
- También lee Adif con un navegador real y genera `incidencias.json`.
- `scripts/lib/incidencias.mjs` interpreta los textos («entre X y Y», «línea X-Y», «se sigue prestando en…», cortes en fechas concretas) y los sitúa en los tramos del mapa con `scripts/lib/network.mjs`, que usa la misma red que la app.
- Las pruebas con textos reales de Adif están en `scripts/test/incidencias.test.mjs` (`node scripts/test/incidencias.test.mjs`).
- Los ficheros se publican en la rama `datos`, que siempre tiene un único commit. La web los lee desde `raw.githubusercontent.com`.

### Horario oficial

Renfe solo publica en tiempo real los trenes que ya circulan. Para ver también los que van a salir, el flujo `datos` descarga una vez al día el horario oficial de Renfe (GTFS de Alta Velocidad, Larga y Media Distancia) y `scripts/horarios.mjs` lo convierte en `horarios.json`, con los trenes de ayer, hoy y mañana. La web lo cruza con el tiempo real por número de tren:

- **Paneles de estación y búsqueda de viajes** con todos los trenes: *en circulación* (con su retraso), *programado*, *sin datos en directo* (debería circular, pero no tiene posición) o *afectado por corte*.
- **Afectado por corte**: el horario oficial a veces mantiene trenes que no pueden circular. Si el recorrido de un tren atraviesa un tramo cortado según Adif, se muestra en gris.
- **Trenes sin GPS**: si un tren del horario debería estar circulando pero Renfe no publica su posición, se dibuja sobre su vía en la posición que le toca por horario, con un anillo discontinuo y la indicación «sin GPS». Los que atraviesan un tramo cortado no se dibujan. Se pueden ocultar en los filtros.
- **Todas las estaciones** del catálogo se pueden buscar por su nombre (Atocha, Chamartín, Sants, Santa Justa…). Las que tienen servicio aparecen en el mapa al acercarse.
- Cercanías no está incluido: su horario oficial ocupa unos 290 MB.

### Al segundo

Renfe publica una actualización nueva cada **~15 s**; ese es el límite de la fuente. La app:

- **Consulta justo cuando Renfe publica.** Calcula cuándo llega la siguiente actualización y la pide en ese momento, así que los datos llegan con 1–3 s de retraso.
- **Mueve los trenes en cada fotograma.** Cada tren se coloca sobre su vía y, entre dos actualizaciones, avanza en su sentido a la velocidad medida con su GPS, durante un máximo de 40 s. Cuando llega una posición nueva se corrige con una transición suave, sin saltos.
- **Indica la antigüedad de los datos.** La cabecera muestra «En directo · N s».

## Ejecutar en local

No hace falta instalar nada: abre `index.html` en Chrome o Firefox. Para tener datos en vivo de forma fiable, arranca el proxy incluido:

```bash
node tools/proxy-renfe.js
```

Luego, en la barra lateral → **Fuente de datos** → **Proxy CORS propio**, pon `http://localhost:8787/?url={url}`.

## Estructura

```
index.html                 app final, autocontenida (generada)
src/app.html               código fuente de la app (HTML + CSS + JS)
src/geodata.json           vías, mapa base y catálogo de estaciones
scripts/build.mjs          genera index.html a partir de src/
scripts/build-geodata.mjs  regenera src/geodata.json (vías de OpenStreetMap, fronteras de Natural Earth, estaciones de Renfe)
scripts/osm-vias.mjs       descarga las vías de OpenStreetMap y muestras GPS (lo ejecuta el flujo «vias»)
scripts/calibrar.mjs       mide la distancia entre las posiciones GPS de los trenes y las vías dibujadas
tools/proxy-renfe.js       proxy CORS local opcional
supabase/functions/renfe-proxy/index.ts  proxy desplegado en Supabase (fuente principal)
supabase/functions/trigger-datos/index.ts lanza el flujo «datos» (lo llama pg_cron cada 15 min)
.github/workflows/pages.yml  publica en GitHub Pages y refresca la copia de datos
.github/workflows/vias.yml  descarga el trazado de OpenStreetMap a la rama `osm`
.github/workflows/diagnostico.yml  abre la web publicada en Chromium y guarda capturas en la rama `diagnostico`
```

Después de editar `src/app.html`, ejecuta `node scripts/build.mjs` para actualizar `index.html`. Al subir a `main`, GitHub Pages se vuelve a publicar automáticamente.

## Despliegue

**Proxy (Supabase).** La función vive en el proyecto de Supabase *EuskaGo* con el nombre `renfe-proxy` y es pública: solo lee datos públicos y no admite otros destinos. Para redesplegarla tras cambiarla: `supabase functions deploy renfe-proxy --no-verify-jwt --project-ref dyxrgskqftlxetcgoebp`. Si cambias de proyecto, actualiza `SUPABASE_PROXY` en `src/app.html`.

**Web.**

La web se publica con GitHub Pages mediante GitHub Actions: **Settings → Pages → Source: GitHub Actions**. Cada push a `main`, cada ~10 minutos y cada ejecución manual (**Actions → Publicar web → Run workflow**) generan y publican la web.

**Programador de respaldo (Supabase).** El programador de GitHub lanza las ejecuciones con mucho retraso, así que en EuskaGo hay una tarea `pg_cron` llamada `trainviewer-datos`. Se ejecuta a los minutos 02, 17, 32 y 47 de cada hora y llama a la Edge Function `trigger-datos` (`supabase/functions/trigger-datos`), que lanza el flujo `datos` en GitHub si no hay uno en curso o de hace menos de 12 min. Necesita el secreto `GITHUB_TOKEN` en Supabase (Edge Functions → Secrets): un token de grano fino con acceso solo a este repositorio y permiso «Actions: Read and write». Cuando el token caduque, basta con crear otro y sustituir el secreto.

Para quitarlo: `select cron.unschedule('trainviewer-datos');` en el editor SQL de Supabase y borrar la función `trigger-datos`.

> GitHub desactiva los flujos programados de los repositorios públicos tras 60 días sin actividad. Si la copia de datos deja de actualizarse, reactívalo desde la pestaña **Actions**.

## Trazado de las vías

Las vías salen de OpenStreetMap. Las principales se trazan por la vía de su tipo, alta velocidad o ancho ibérico, entre las estaciones reales del catálogo de Renfe/Adif. El resto de líneas, incluida la vía estrecha del Cantábrico y las líneas principales de Portugal y del sur de Francia, se dibujan sin duplicar las vías dobles. Para actualizarlo:

1. **Actions → Trazado de vías (OpenStreetMap) → Run workflow** (deja `osm-rail.json.gz` y `gps.json.gz` en la rama `osm`).
2. `rm -f .cache/osm-rail.json.gz && node scripts/build-geodata.mjs && node scripts/build.mjs`
3. Comprobación: `git show origin/osm:gps.json.gz > .cache/gps.json.gz && node scripts/calibrar.mjs .cache/gps.json.gz`

## Diagnóstico

**Actions → Diagnóstico de la web → Run workflow** abre la web publicada en un navegador real. Registra qué responde cada proveedor de mapas y cada fuente de datos, y guarda capturas de escritorio y móvil en la rama `diagnostico`.

## Créditos

- Datos de trenes: visor público de tiempo real de Renfe. No es un proyecto oficial de Renfe ni de Adif.
- Vías: © [colaboradores de OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
- Fronteras y mapa base integrado: [Natural Earth](https://www.naturalearthdata.com/) (dominio público).
- Mapa de fondo: © Esri (World Dark Gray Base) y © [Instituto Geográfico Nacional](https://www.ign.es) (IGN Base).
- Mapa: [Leaflet](https://leafletjs.com/).
