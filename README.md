# TrainViewer

Mapa ferroviario de España en tiempo real: trenes de Alta Velocidad, Larga Distancia y Media Distancia sobre la red, estado de los tramos y paneles de llegadas y salidas por estación.

**Web:** https://paticuaker.github.io/TrainViewer/

## Qué hace

- **Mapa oscuro** con la red de vías principales (trazado de Natural Earth). Si las teselas de CARTO no cargan, se ve igualmente un mapa base integrado en la propia página.
- **Trenes en tiempo real** como puntos de color según el tipo. Tienen borde naranja con ≥10 min de retraso y rojo si están detenidos fuera de estación. Al pulsar uno se ve número, origen, destino, velocidad estimada, retraso, próxima estación y próximas paradas.
- **Estado de la vía**: verde (normal), amarillo (retrasos) y rojo discontinuo (tren detenido). En tiempo real se deduce de los trenes que circulan por cada tramo, porque Adif no publica ese dato.
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
2. **Conexión directa.**
3. **Proxies CORS públicos** (allorigins, codetabs). Se pueden desactivar.
4. **Copia publicada por GitHub Actions** junto a la web (`data/*.json`). El flujo `.github/workflows/pages.yml` la refresca cada ~10 min. La app la marca como «Casi en directo» e indica su antigüedad.
5. Si nada responde, **simulación**, con un aviso en pantalla.

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
.github/workflows/pages.yml  publica en GitHub Pages y refresca la copia de datos
```

Después de editar `src/app.html`, ejecuta `node scripts/build.mjs` para actualizar `index.html`. Al subir a `main`, GitHub Pages se vuelve a publicar automáticamente.

## Despliegue

La web se publica con GitHub Pages mediante GitHub Actions: **Settings → Pages → Source: GitHub Actions**. Cada push a `main`, cada ~10 minutos y cada ejecución manual (**Actions → Publicar web → Run workflow**) generan y publican la web.

> GitHub desactiva los flujos programados de los repositorios públicos tras 60 días sin actividad. Si la copia de datos deja de actualizarse, reactívalo desde la pestaña **Actions**.

## Créditos

- Datos de trenes: visor público de tiempo real de Renfe. No es un proyecto oficial de Renfe ni de Adif.
- Vías y fronteras: [Natural Earth](https://www.naturalearthdata.com/) (dominio público).
- Teselas: © [OpenStreetMap](https://www.openstreetmap.org/copyright), © [CARTO](https://carto.com/attributions).
- Mapa: [Leaflet](https://leafletjs.com/).
