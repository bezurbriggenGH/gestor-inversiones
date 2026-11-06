# Gestor de inversiones

App web para seguir una cartera de **acciones argentinas y CEDEARs** (BYMA), con precios
reales actualizados día a día y vista en **pesos o dólares** (MEP o CCL).

## Cómo correrla

Requisitos: Node.js 22.18 o superior.

```bash
npm run setup   # instala dependencias (solo la primera vez)
npm run dev     # levanta backend (puerto 3001) y frontend (puerto 5173)
```

Abrí http://localhost:5173

## Tecnologías

| Parte | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Estilos | Tailwind CSS 4 |
| Datos en el frontend | TanStack Query (cache y recarga automática) |
| Gráfico de precios | TradingView Lightweight Charts |
| Gráfico de composición | Recharts |
| Backend | Node.js + Express 5 + TypeScript |
| Base de datos | SQLite (módulo `node:sqlite`, archivo en `server/data/`) |

## Fuentes de datos

| Dato | Fuente |
|---|---|
| Precios diarios de BYMA (`GGAL.BA`, `MELI.BA`…) | Yahoo Finance |
| Historial del dólar MEP y CCL | ArgentinaDatos (api.argentinadatos.com) |
| Dólar del momento | DolarApi (dolarapi.com) |

La app guarda todo en su base de datos. Cada actualización pide **solo los días que faltan**
desde la última fecha guardada, así que aunque no se abra por semanas no se pierde nada.

## Estructura

```
server/src/
  providers/   → consultas a Yahoo y a las APIs del dólar
  services/
    sync.ts      → mantiene precios y dólar al día
    portfolio.ts → cálculos contables (PPP, resultados, conversión)
  routes.ts    → endpoints de la API REST
client/src/
  pages/       → pantallas (cartera, activo, operación, composición)
  components/  → gráfico, formularios, sidebar
```

## Criterios de cálculo

- **Costo por Precio Promedio Ponderado (PPP)**, comisiones incluidas.
- **Resultado realizado**: ventas ya hechas (cobrado neto − costo promedio de lo vendido).
- **Resultado no realizado**: valor de mercado de la tenencia − su costo.
- **En dólares**, cada operación y cada precio se convierten con el dólar **del día en que ocurrieron**.
