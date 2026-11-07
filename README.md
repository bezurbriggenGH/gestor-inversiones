# Gestor de inversiones

App web para seguir una cartera de **acciones argentinas y CEDEARs** (BYMA), con precios
reales actualizados día a día y vista en **pesos o dólares** (MEP o CCL).

## Funciones

- **Cartera**: cuánto vale, cuánto ganaste en total (en lo que tenés, en ventas y en dividendos), rendimiento por año y contra la inflación.
- **Resumen en palabras**: qué movió tu cartera hoy, cómo va el mes, si le ganás al dólar, tu mejor y peor inversión, y avisos de concentración.
- **Datos de cada acción**: rango del último año, cuánto subió o bajó (1 mes a 5 años), cuánto se mueve en un día normal, peor caída y cuánto tiene que subir para volver a tu precio promedio.
- **Simulador**: un monto en una fecha pasada contra dólar, plazo fijo, inflación y pesos guardados, con dividendos y el peor momento del camino.
- **Evolución**: gráfico del valor de la cartera contra la plata puesta, y TIR anual.
- **Rendimiento mes a mes**: calendario con el rendimiento de cada mes y de cada año.
- **Gráfico de cada activo**: línea o velas, medias móviles de 50 y 200 días, tus compras y ventas, y la línea de tu precio promedio.
- **CCL implícito de los CEDEARs**: a qué dólar estás comprando y si el CEDEAR está caro o barato contra el CCL.
- **Mapa de la cartera**: cada activo es un rectángulo del tamaño de tu tenencia, en verde o rojo según cómo le fue.
- **Comparativa**: compara tu cartera contra inflación, dólar MEP, plazo fijo, Merval y S&P 500,
  simulando que la misma plata entró y salió en las mismas fechas.
- **Rendimiento real**: cuánto ganaste descontando la inflación.
- **Dividendos**: detecta los dividendos que pagaron tus activos y te sugiere registrarlos con la retención habitual.
- **Diario de decisiones**: para cada compra y venta, qué hizo el precio 30, 90 y 180 días después, y tu porcentaje de aciertos.
- **Alertas de precio**: aviso en la app y notificación del navegador.
- **Importar operaciones** desde el Excel (.xlsx) o CSV de tu broker. Reconoce la "Cuenta Corriente" de Bull Market tal como se descarga e ignora depósitos y transferencias.
- **Cambios de ratio y splits**: las operaciones anteriores se ajustan solas (por ejemplo, SPY 3:1), igual que los precios históricos.
- **Buscador** con más de 140 acciones argentinas y CEDEARs.
- **Cuentas de usuario** con email y contraseña.
- **Instalable** en el celular o la compu (PWA).

## Cómo correrla en tu compu

### 1. Instalar lo necesario (solo la primera vez)

- **Node.js 22.18 o superior**: bajalo de https://nodejs.org (la versión LTS) e instalalo con las
  opciones por defecto. Para comprobarlo, abrí una terminal y escribí `node -v`.
- **Git** (opcional, para clonar el proyecto): https://git-scm.com. Sin Git, podés bajar el
  proyecto desde GitHub con el botón **Code → Download ZIP** y descomprimirlo.

### 2. Bajar el proyecto

```bash
git clone https://github.com/bezurbriggenGH/gestor-inversiones.git
cd gestor-inversiones
```

### 3. Instalar dependencias (solo la primera vez)

```bash
npm run setup
```

### 4. Levantar la app

```bash
npm run dev
```

Esto prende el backend (puerto 3001) y el frontend (puerto 5173). Abrí http://localhost:5173 y
creá tu cuenta. Para apagarla, en la terminal apretá `Ctrl + C`.

En Windows, si PowerShell bloquea `npm`, usá `npm.cmd run setup` y `npm.cmd run dev`.

### Llevar tus datos a otra compu

La base de datos **no se sube a GitHub** (la carpeta `server/data/` está en `.gitignore`), así que
en una compu nueva la app arranca vacía. Los precios se descargan solos, pero tus operaciones,
notas y alertas no. Para llevarlas:

1. En la compu original, apagá la app (`Ctrl + C`).
2. Copiá el archivo `server/data/finanzas.db` (por ejemplo, a un pendrive o a la nube).
3. En la compu nueva, ponelo en la misma carpeta `server/data/` (creala si no existe) **antes** de
   correr `npm run dev`.
4. Entrá con el mismo email y contraseña de siempre: los usuarios también están en ese archivo.

Si no tenés el archivo, otra opción es crear una cuenta nueva y volver a importar el Excel de tu
broker desde **Importar**.

Conviene hacer esta copia de `finanzas.db` de vez en cuando como respaldo.

### Cuándo se actualizan los precios

Mientras la app está prendida, se consultan las fuentes de datos solo cuando el precio puede haber
cambiado: con BYMA abierto (lunes a viernes de 11 a 17, hora argentina) como mucho cada 15
minutos, y una vez después del cierre para guardar el precio final. De noche y los fines de semana
no se consulta nada. Si la app estuvo apagada varios días, al prenderla se completan los días que
falten.

## Publicarla en internet

El proyecto incluye un `Dockerfile` que compila el frontend y lo sirve desde el mismo servidor.
Sirve para cualquier servicio que acepte Docker (Railway, Render, Fly.io):

1. Conectá el repositorio de GitHub al servicio.
2. Montá un **volumen persistente en `/data`** (ahí vive la base SQLite; sin volumen se borra en cada deploy).
3. El servicio expone el puerto `3001`.

Para probar la versión de producción localmente:

```bash
npm run build
npm start
```

## Tecnologías

| Parte | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Estilos | Tailwind CSS 4 |
| Datos en el frontend | TanStack Query (cache y recarga automática) |
| Gráficos | TradingView Lightweight Charts y Recharts |
| Backend | Node.js + Express 5 + TypeScript |
| Base de datos | SQLite (`node:sqlite`) con migraciones versionadas |
| Autenticación | Contraseñas con scrypt, sesiones en cookie httpOnly |
| Deploy | Docker, PWA con service worker |

## Fuentes de datos

| Dato | Fuente |
|---|---|
| Precios diarios y dividendos de BYMA (`GGAL.BA`, `MELI.BA`…) | Yahoo Finance |
| Merval (`^MERV`) y S&P 500 (CEDEAR `SPY.BA`) | Yahoo Finance |
| Precio en EE.UU. de las acciones de cada CEDEAR (`AAPL`, `MELI`…) | Yahoo Finance |
| Dólar MEP y CCL (historial) | ArgentinaDatos |
| Dólar del momento | DolarApi |
| Inflación (índice UVA) y tasa de plazo fijo | ArgentinaDatos |

Todas son públicas y no requieren clave. La app guarda todo en su base de datos y cada
actualización pide **solo los días que faltan**, así que aunque no se abra por semanas no se pierde nada.

## Estructura

```
server/src/
  providers/     → consultas a Yahoo, dólar e índices
  services/
    sync.ts        → mantiene precios, dólar e índices al día
    portfolio.ts   → cálculos contables (PPP, resultados, dividendos, conversión)
    history.ts     → evolución, benchmarks y TIR
    journal.ts     → diario de decisiones
    importer.ts    → lectura de CSV
    simulator.ts   → simulador de inversiones pasadas
    alerts.ts      → alertas de precio
    cedear.ts      → CCL implícito y brecha de los CEDEARs
  cedears.ts     → tabla de ratios de los CEDEARs
  auth.ts        → registro, login y sesiones
  db.ts          → base de datos y migraciones
  routes.ts      → endpoints de la API REST
client/src/
  pages/         → pantallas
  components/    → gráficos, formularios, sidebar
```

## Criterios de cálculo

- **Costo por Precio Promedio Ponderado (PPP)**, comisiones incluidas.
- **Resultado realizado**: ventas ya hechas (cobrado neto − costo promedio de lo vendido).
- **Resultado no realizado**: valor de mercado de la tenencia − su costo.
- **Dividendos**: ingreso aparte, neto de retenciones (30% sugerido para CEDEARs, 7% para acciones locales).
- **En dólares**, cada operación y cada precio se convierten con el dólar **del día en que ocurrieron**.
- **Benchmarks**: cada compra "compra" unidades de la alternativa y cada venta o dividendo "vende" unidades.
- **TIR**: tasa anual que iguala a cero el valor presente de todos los flujos (incluido el valor actual).
- **Plazo fijo**: tasa de depósitos a 30 días, renovado cada mes (capitalización mensual).
- **Diario**: acierto si a los 90 días el precio fue a favor de la decisión por más de 2%.
- **Rendimiento mensual**: ponderado por tiempo (se encadena el rendimiento de cada día descontando lo que entró o salió), así las compras no se confunden con ganancias.
- **Splits**: una operación anterior a un split se multiplica en cantidad y se divide en precio por el factor del split; el monto total no cambia.
- **CCL implícito**: precio del CEDEAR × ratio ÷ precio en EE.UU. Si el ratio observado se aleja más de 10% del de la tabla (por ejemplo, tras un split), no se muestra.
