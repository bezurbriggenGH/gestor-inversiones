# Gestor de inversiones

App web para seguir una cartera de **acciones argentinas y CEDEARs** (BYMA), con precios
reales actualizados día a día y vista en **pesos o dólares** (MEP o CCL).

## Funciones

- **Cartera**: cuánto vale, cuánto ganaste en total (en lo que tenés, en ventas y en dividendos) y el rendimiento por año. Viendo en pesos, el número grande es el rendimiento descontada la inflación (el de pesos sin descontar va abajo): con inflación alta, ganar 38% por año en pesos puede ser quedarse igual. Al lado de la ganancia total en pesos va también la ganancia descontada la inflación. Si a un activo le falta el precio del día (Yahoo todavía no lo publicó o no operó), dice "sin dato" en vez de un 0% inventado, y la app vuelve a consultar cada hora hasta dos días después del cierre. Si Yahoo tarda, la portada no lo espera más de 2 segundos: muestra los últimos precios guardados y se completa sola.
- **Resumen en palabras**: qué movió tu cartera hoy, cómo va el mes, si le ganás al dólar, tu mejor y peor inversión, y avisos de concentración.
- **Datos de cada acción**: rango del último año, cuánto subió o bajó (1 mes a 5 años), cuánto se mueve en un día normal, peor caída y cuánto tiene que subir para volver a tu precio promedio.
- **Simulador**: un monto en una fecha pasada contra dólar, plazo fijo y pesos guardados (la inflación va aparte, como referencia: no se puede comprar), con dividendos (netos de la retención habitual; en dólares, cada uno con el dólar del día en que se cobró) y el peor momento del camino.
- **Evolución**: gráfico del valor de la cartera contra la plata puesta.
- **Rendimiento mes a mes**: calendario con el rendimiento de cada mes y de cada año.
- **Gráfico de cada activo**: línea o velas, medias móviles de 50 y 200 días, tus compras y ventas, y la línea de tu precio promedio.
- **CCL implícito de los CEDEARs**: a qué dólar estás comprando y si el CEDEAR está caro o barato contra el CCL.
- **Mapa de la cartera**: cada activo es un rectángulo del tamaño de tu tenencia, en verde o rojo según cómo le fue.
- **Exposición por sector y por país**: cuánto de la cartera está en cada sector y en empresas de cada país. El dato sale del catálogo de la app;
  de un activo que no está en el catálogo se le pregunta el sector a Yahoo una vez, y lo que no se sabe figura como "Sin clasificar".
- **Para revisar** (en Composición): solo los avisos que saltan, cada uno con su porqué. Un activo que pasa del 20% de la cartera,
  un sector que pasa del 35% (los ETF no cuentan: ya vienen repartidos) y activos que se mueven casi igual y juntos pesan más del 20%.
  "Se mueven casi igual" = correlación de 0,8 o más entre sus rendimientos semanales del último año, en dólares (en pesos la
  devaluación hace que todo parezca moverse junto), con al menos 26 semanas en común. Si son todos de un sector ya avisado, no se repite.
- **Objetivo de reparto**: qué porcentaje querés en CEDEARs y cuánto en acciones. Si te alejás más de 5 puntos, la app dice cuánto
  poner de plata nueva solo en lo que falta (sin vender) o cuánto pasar de un tipo al otro.
- **Comparativa**: compara tu cartera contra inflación, dólar MEP, plazo fijo, Merval y S&P 500,
  simulando que la misma plata entró y salió en las mismas fechas.
- **Rendimiento real**: cuánto ganaste descontando la inflación (IPC del INDEC), en total, por año y mes a mes.
- **Dividendos**: detecta los dividendos que pagaron tus activos y te sugiere registrarlos con la retención habitual.
- **Diario de decisiones**: para cada compra y venta, qué hizo el precio (en dólares) 30, 90 y 180 días después. Lo principal es si cada decisión le ganó al mercado (S&P 500 o Merval) en el mismo plazo (a menos de 2% es empate); después, el porcentaje de aciertos.
  También dónde acertás más (comprando o vendiendo, en acciones o en CEDEARs, con o sin justificación), afirmando una diferencia solo si es demasiado grande para ser casualidad y no depende de un solo activo. Comprar y vender lo mismo el mismo día se compensa y no cuenta como decisión. Contra el mercado se informa aparte para compras y para ventas, y, plegado, lo que pasó con tus ventas en plata (en dólares).
- **¿Y si no hubieras tocado nada?**: compara lo que tenías un día, a precios de hoy, contra lo que hiciste de verdad. Dice en plata si operar te sumó o te restó. En pesos, la plata de cada compra y venta se lleva a pesos de hoy con la inflación (IPC), la misma vara que la portada.
- **Comisiones**: cuánto pagaste por comprar y vender, por año, y qué parte de tu ganancia se llevaron. En pesos, también descontada la inflación: cada comisión en pesos de hoy, contra lo que le ganaste a la inflación.
- **Sueldo y gastos** (opcional): cada mes cargás a mano tu sueldo y tus gastos fijos (alquiler, seguro, servicios…). Un gráfico
  muestra quién subió más (todo arranca en 100) contra la inflación oficial, y una línea dice si tu sueldo le ganó o perdió contra la
  inflación y qué gasto subió más. "Repetir anterior" completa un mes con los montos del mes previo.
- **Informe**: todo lo importante en una hoja para guardar como PDF o imprimir.
- **El gráfico como diario**: cada compra y venta marcada sobre el precio y pintada según cómo salió (verde acierto, rojo error, gris sin veredicto). Al pasar el cursor se ve por qué la hiciste, la foto que guardaste, cuánto ganaste o dejaste de ganar y si le ganó al mercado.
- **Corregir una operación**: fecha, cantidad, precio y comisiones, con los mismos controles que al cargarla. No deja que el cambio deje ventas sin respaldo ni dividendos por más acciones de las que tenías. La justificación y las fotos no se tocan.
- **Justificación de cada operación**: por qué la hiciste, un link y hasta 10 fotos (capturas del gráfico, de una noticia o del broker; también se pueden pegar con Ctrl+V). Se puede agregar después, también en las operaciones importadas.
- **Alertas de precio**: aviso en la app y notificación del navegador.
- **Importar operaciones** desde el Excel (.xlsx) o CSV de tu broker. Reconoce la "Cuenta Corriente" de Bull Market tal como se descarga e ignora depósitos y transferencias. Aplica los mismos controles que el formulario (ventas sin respaldo, dividendos imposibles, fechas). Una fila es duplicada si ya hay una igual cargada, contando cuántas: si hay 2 compras idénticas y el archivo trae 3, entra 1. Además, y si una fila de un activo falla no importa ninguna de ese activo: sola, una parte dejaría una tenencia distinta a la del broker.
- **Cambios de ratio y splits**: las operaciones anteriores se ajustan solas (por ejemplo, SPY 3:1), igual que los precios históricos.
- **Buscador** con más de 170 acciones argentinas y CEDEARs.
- **Cuentas de usuario** con email y contraseña.
- **Instalable** en el celular o la compu (PWA).

## Instalación y ejecución

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
creá tu cuenta. El backend solo acepta conexiones de tu propia compu (no de otros equipos del mismo wifi); para usarlo desde otro equipo de la red, arrancalo con `HOST=0.0.0.0`. Para apagarla, en la terminal apretá `Ctrl + C`.

En Windows, si PowerShell bloquea `npm`, usá `npm.cmd run setup` y `npm.cmd run dev`.

### Cuándo se actualizan los precios

Mientras la app está prendida, se consultan las fuentes de datos solo cuando el precio puede haber
cambiado: con BYMA abierto (lunes a viernes de 11 a 17, hora argentina) como mucho cada 15
minutos, y una vez después del cierre para guardar el precio final. De noche y los fines de semana
no se consulta nada. Si la app estuvo apagada varios días, al prenderla se completan los días que
falten.

## Tests

Los cálculos de la app se comprueban con tests automáticos: casos con un resultado conocido que se
puede sacar a mano (por ejemplo, el acertijo de la vaca: comprar a 2.000, vender a 2.200,
recomprar a 2.300 y vender a 2.500 tiene que dar una ganancia de 400). Para correrlos:

```bash
npm test
```

Cada archivo de tests usa una base de datos vacía y temporal, así que nunca tocan tus datos.

| Archivo | Qué comprueba |
|---|---|
| `server/test/cartera.test.ts` | Precio promedio, ganancias, comisiones, dividendos, dólares, ventas de más, variación del día con feriados largos |
| `server/test/historia.test.ts` | TIR (y que no se anualice con menos de un año), rendimiento mes a mes, plazo fijo, splits, que las pantallas den lo mismo |
| `server/test/comparativa.test.ts` | Ventas por más de lo que se puso (la comparación contra la inflación se da en plata) y dividendos del simulador netos de retención y, en dólares, con el dólar de su día |
| `server/test/inflacion.test.ts` | Índice de inflación armado con el IPC: meses encadenados, reparto por día y meses sin publicar |
| `server/test/datos.test.ts` | Corrección de los datos de Yahoo (cambios de ratio, dividendos imposibles) |
| `server/test/diario.test.ts` | Resultado de cada venta, que el Diario de decisiones juzgue en dólares, la comparación contra el mercado, órdenes partidas y cuándo una diferencia puede ser casualidad |
| `server/test/balance.test.ts` | ¿Y si no hubieras tocado nada? (con la inflación), comisiones (también descontada la inflación), qué pasó con lo que vendiste y patrones del Diario |
| `server/test/sincronizar.test.ts` | Pedidos a Yahoo: de a pocos, sin insistir después de un error, reintentar si faltó el precio de la última rueda, y que la portada no los espere más de la cuenta |
| `server/test/editar.test.ts` | Corregir una operación: mismos controles que al cargarla, ventas y dividendos que quedarían sin respaldo, splits, operaciones ajenas, y precio y dividendo sugeridos en la escala de su fecha |
| `server/test/importador.test.ts` | Números ("1.234,56", "0.125") y fechas de los archivos de los brokers |
| `server/test/fotos.test.ts` | Fotos de las operaciones: solo imágenes, cada una de su dueño, y que se borren bien |
| `server/test/validaciones.test.ts` | Casos límite cargados desde la app o importados: cantidades negativas o con decimales, ventas de más, fechas imposibles o anteriores a los datos, dividendos imposibles, borrar activos |
| `server/test/cuentas.test.ts` | Registro e ingreso con email y contraseña, y que el límite de intentos no se esquive |
| `server/test/diversificacion.test.ts` | Para revisar (concentración, sectores, activos que se mueven juntos) y objetivo de reparto |
| `server/test/sueldo-y-gastos.test.ts` | Sueldo y gastos contra la inflación del INDEC |

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
| Inflación mensual oficial (IPC del INDEC): rendimiento real, Comparativa, Simulador y Sueldo y gastos | ArgentinaDatos |
| Tasa de plazo fijo | ArgentinaDatos |

Todas son públicas y no requieren clave. La app guarda todo en su base de datos y cada
actualización pide **solo los días que faltan**, así que aunque no se abra por semanas no se pierde nada.

## Estructura

```
server/src/
  providers/     → consultas a Yahoo, dólar e índices
  services/
    sync.ts            → mantiene precios, dólar e índices al día
    clean.ts           → corrige datos de Yahoo (cambios de ratio no informados, dividendos imposibles)
    portfolio.ts       → cálculos contables (PPP, resultados, dividendos, splits, conversión)
    history.ts         → evolución, benchmarks y TIR
    journal.ts         → diario de decisiones
    review.ts          → ¿y si no hubieras tocado nada? y comisiones
    exposure.ts        → sector y país de cada activo
    diversification.ts → Para revisar y objetivo de reparto
    budget.ts          → sueldo y gastos contra la inflación
    importer.ts        → lectura de los archivos del broker (CSV, Excel, IOL)
    simulator.ts       → simulador de inversiones pasadas
    alerts.ts          → alertas de precio
    cedear.ts          → CCL implícito y brecha de los CEDEARs
    images.ts          → fotos de las operaciones
  cedears.ts     → tabla de ratios de los CEDEARs
  auth.ts        → registro, login y sesiones
  db.ts          → base de datos y migraciones
  routes.ts      → endpoints de la API REST
client/src/
  pages/         → pantallas (la portada viene con la app; las demás se bajan al abrirlas)
  components/    → gráficos, formularios, sidebar
  lazyPage.tsx   → carga de pantallas a pedido (si la app se recompiló estando abierta, recarga una vez)
```

## Criterios de cálculo

- **Costo por Precio Promedio Ponderado (PPP)**, comisiones incluidas.
- **Resultado realizado**: ventas ya hechas (cobrado neto − costo promedio de lo vendido).
- **Resultado no realizado**: valor de mercado de la tenencia − su costo.
- **Dividendos**: no pueden ser por acciones que no tenías ni por más de la mitad de lo que valían (un cero de más). Ingreso aparte, neto de retenciones (30% sugerido para CEDEARs, 7% para acciones locales). Los sugeridos de un CEDEAR se calculan como los paga el broker: dividendo en dólares de la acción en EE.UU. ÷ ratio × dólar MEP de ese día. Si los precios muestran que el ratio cambió y la tabla todavía no, no se sugieren (saldrían multiplicados por el cambio).
- **En dólares**, cada operación y cada precio se convierten con el dólar **del día en que ocurrieron**.
- **Benchmarks**: cada compra "compra" unidades de la alternativa y cada venta o dividendo "vende" unidades. Si sacaste más de lo que habría valido la alternativa, queda negativa (no te alcanzaba para esas ventas): la diferencia se informa en plata, sin porcentaje. Merval y S&P 500 son solo precio, sin dividendos (tu cartera sí los cuenta); y a cada alternativa le llega toda la plata, comisiones incluidas, sin pagar comisiones.
- **TIR**: tasa anual que iguala a cero el valor presente de todos los flujos (incluido el valor actual). Con menos de un año de operaciones no se calcula: anualizar un período corto exagera (20% en dos meses se leería como casi +200% por año), y las normas internacionales de rendimiento (GIPS) piden no hacerlo.
- **Plazo fijo**: tasa de depósitos a 30 días, renovado cada mes (capitalización mensual).
- **Diario**: acierto si a los 90 días el precio fue a favor de la decisión por más de 2%. Mide el momento de cada decisión, no si se ganó plata: eso se ve aparte en "Ventas con ganancia" (resultado de cada venta contra el precio promedio). Además se compara con el mercado en el mismo plazo, en dólares: S&P 500 (CEDEAR SPY) para CEDEARs y Merval para acciones. Diferencia = (1 + cambio del activo) ÷ (1 + cambio del índice) − 1; una compra le gana al mercado si es positiva, una venta si es negativa. Si el índice no tiene datos en esas fechas, no se compara. Los porcentajes cuentan decisiones: una orden que el broker partió en varias el mismo día es una sola. Los porcentajes solo cuentan decisiones que ya cumplieron 90 días, y contra el mercado una diferencia de menos de 2% es empate. Una diferencia entre dos grupos se afirma solo si pasa la prueba de dos proporciones con al menos 10 decisiones de cada lado, con z ≥ 2,39 (95% repartido entre las 3 comparaciones: corrección de Bonferroni), y si sigue pasando al sacar cualquier activo de a uno (la prueba supone decisiones independientes, y 31 compras de la misma acción no lo son). "Ventas con ganancia" se cuenta en dólares.
- **Rendimiento mensual**: ponderado por tiempo (se encadena el rendimiento de cada día descontando lo que entró o salió), así las compras no se confunden con ganancias. Un activo sin precios guardados se valúa a su último precio de operación hasta que aparece uno, y el calendario marca con * el mes en que cae ese salto. En pesos se descuenta la inflación del mes: real = (1 + rendimiento) ÷ (1 + inflación) − 1. No coincide con la TIR y no tiene por qué: la TIR pesa más los meses con más plata puesta; el ponderado por tiempo pesa todos igual.
- **Inflación**: IPC mensual del INDEC, repartido parejo entre los días de cada mes (10% en un mes de 31 días → 1,1^(1/31) por día); el mes todavía sin publicar se estima con el último dato. Antes se usaba el índice UVA, que sigue al IPC con unos dos meses de atraso: de febrero a diciembre de 2024 subió 134% contra 80,5% del IPC, y a quien empezó a invertir en febrero de 2024 le cobraba la inflación de diciembre y enero.
- **Splits**: una operación anterior a un split se multiplica en cantidad y se divide en precio por el factor del split; el monto total no cambia. Por eso el precio que sugiere el formulario (y los dividendos sugeridos) para una fecha anterior a un split está en la escala de esa fecha, como lo informó el broker: el cierre guardado × el factor. Si el split deja una fracción de acción, se toma como cobrada en efectivo al precio de ese día (el broker solo acredita acciones enteras).
- **Variación del día**: valor de hoy − valor de ayer − plata puesta hoy; lo comprado hoy se mide contra lo que pagaste. Si falta el precio de la última rueda o el de la anterior, el activo no suma al día ni a la base del %, y se muestra "sin dato". La rueda anterior es el último día anterior con precio de algún activo, así los feriados largos (Semana Santa) no se confunden con un activo que no operó.
- **CCL implícito**: precio del CEDEAR × ratio ÷ precio en EE.UU. Si el ratio observado se aleja más de 10% del de la tabla (por ejemplo, tras un split), no se muestra.
- **Sueldo y gastos**: cuánto subió un concepto = último monto ÷ primero − 1. La inflación del mismo período se acumula mes a mes con el IPC (2% y 3% → 1,02 × 1,03 − 1 = 5,06%), solo hasta el último mes publicado. Poder de compra = (1 + suba) ÷ (1 + inflación) − 1. Los ingresos se suman entre sí. "Te queda" = ingresos − gastos del mes (solo meses con los dos cargados).
