# TrainViewer

Mapa ferroviario de España en tiempo real: trenes de Alta Velocidad, Larga Distancia y Media Distancia sobre la red, estado de los tramos y paneles de llegadas y salidas por estación.

**Web:** https://paticuaker.github.io/TrainViewer/

## Qué hace

- **Mapa oscuro** con la red de vías principales (trazado de Natural Earth). El fondo es el mapa gris oscuro de Esri y, si falla, el del IGN (oscurecido). Ninguno de los dos necesita clave de API. Si no carga ninguno, se ve un mapa base integrado en la propia página.
- **Trenes en tiempo real** como puntos de color según el tipo, con una flecha que indica su sentido y movimiento continuo sobre la vía. Tienen borde naranja con ≥10 min de retraso y rojo si están detenidos fuera de estación. Al pulsar uno se abre su ficha en la barra lateral: velocidad, retraso, próxima parada y el recorrido completo con horas programadas y estimadas. Desde ahí se puede seguir el tren en el mapa o ver su recorrido entero.
- **Estado de la vía con datos oficiales de Adif**: cada 15 min se leen «Estado de la red» y «Avisos» de Adif y se dibujan sobre el tramo exacto: rojo discontinuo para un corte, amarillo para una incidencia y punteado para un corte programado que hoy no aplica. Cada aviso enlaza a su fuente. En los tramos sin aviso oficial, el estado se deduce de los retrasos de los trenes que los recorren.
- **Modo foco**: al seleccionar un tren, o buscar un viaje como «Madrid Sevilla», solo su trayecto queda en color, siguiendo las vías reales y con sus paradas; el resto del mapa pasa a blanco y negro.
- **Puntualidad de los últimos 7 días**: gráfica con la media de cada día, a partir del histórico que se guarda cada 15 min.
- **Estaciones**: al pulsar una se ven las próximas llegadas y salidas con cuenta atrás, hora programada, hora estimada y retraso. El botón **Más información** abre el panel oficial de Adif (`info.adif.es/?s=<código>`).
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
scripts/build-geodata.mjs  regenera src/geodata.json desde Natural Earth y Renfe
tools/proxy-renfe.js       proxy CORS local opcional
supabase/functions/renfe-proxy/index.ts  proxy desplegado en Supabase (fuente principal)
.github/workflows/pages.yml  publica en GitHub Pages y refresca la copia de datos
.github/workflows/diagnostico.yml  abre la web publicada en Chromium y guarda capturas en la rama `diagnostico`
```

Después de editar `src/app.html`, ejecuta `node scripts/build.mjs` para actualizar `index.html`. Al subir a `main`, GitHub Pages se vuelve a publicar automáticamente.

## Despliegue

**Proxy (Supabase).** La función vive en el proyecto de Supabase *EuskaGo* con el nombre `renfe-proxy` y es pública: solo lee datos públicos y no admite otros destinos. Para redesplegarla tras cambiarla: `supabase functions deploy renfe-proxy --no-verify-jwt --project-ref dyxrgskqftlxetcgoebp`. Si cambias de proyecto, actualiza `SUPABASE_PROXY` en `src/app.html`.

**Web.**

La web se publica con GitHub Pages mediante GitHub Actions: **Settings → Pages → Source: GitHub Actions**. Cada push a `main`, cada ~10 minutos y cada ejecución manual (**Actions → Publicar web → Run workflow**) generan y publican la web.

> GitHub desactiva los flujos programados de los repositorios públicos tras 60 días sin actividad. Si la copia de datos deja de actualizarse, reactívalo desde la pestaña **Actions**.

## Diagnóstico

**Actions → Diagnóstico de la web → Run workflow** abre la web publicada en un navegador real. Registra qué responde cada proveedor de mapas y cada fuente de datos, y guarda capturas de escritorio y móvil en la rama `diagnostico`.

## Créditos

- Datos de trenes: visor público de tiempo real de Renfe. No es un proyecto oficial de Renfe ni de Adif.
- Vías y fronteras: [Natural Earth](https://www.naturalearthdata.com/) (dominio público).
- Mapa de fondo: © Esri (World Dark Gray Base) y © [Instituto Geográfico Nacional](https://www.ign.es) (IGN Base).
- Mapa: [Leaflet](https://leafletjs.com/).
