import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type LogicalRange,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { useNavigate } from 'react-router';
import { imageUrl, type Currency, type Operation, type PricePoint } from '../api';
import { date as fmtDate, money, num, pct, tone } from '../format';
import { soldWithinText } from './Balance';

const RANGES = [
  { label: '1M', days: 30 },
  { label: '3M', days: 91 },
  { label: '6M', days: 182 },
  { label: '1A', days: 365 },
  { label: '5A', days: 1826 },
  { label: 'Todo', days: 0 },
] as const;
type RangeLabel = (typeof RANGES)[number]['label'];

const MAS = [
  { key: 'ma50', days: 50, color: '#c49a4a', label: 'Media 50 días' },
  { key: 'ma200', days: 200, color: '#5a9bb0', label: 'Media 200 días' },
] as const;
type MaKey = (typeof MAS)[number]['key'];

const UP = '#4f9d69';
const DOWN = '#c25450';
const ACCENT = '#7c6bb0';
const GREY = '#8a8a8f';

/** Color de la marca: cómo salió la decisión según el Diario (no si fue compra o venta: eso lo dice la flecha). */
function verdictColor(op: Operation): string {
  const v = op.decision?.verdict;
  return v === 'ACIERTO' ? UP : v === 'ERROR' ? DOWN : GREY;
}

const CARD_WIDTH = 300;

function timeToIso(t: Time): string {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function minusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Si la operación cayó en un día sin rueda, la ubica en el último día con precio. */
function snapToSeries(dates: string[], target: string): string {
  let lo = 0;
  let hi = dates.length - 1;
  if (target <= dates[0]) return dates[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dates[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return dates[lo];
}

/** Media móvil simple: promedio de los últimos `n` cierres. */
function movingAverage(series: PricePoint[], n: number) {
  const out: { time: Time; value: number }[] = [];
  let sum = 0;
  series.forEach((p, i) => {
    sum += p.close;
    if (i >= n) sum -= series[i - n].close;
    if (i >= n - 1) out.push({ time: p.date as Time, value: sum / n });
  });
  return out;
}

function applyRange(chart: IChartApi, series: PricePoint[], range: RangeLabel) {
  const days = RANGES.find((r) => r.label === range)!.days;
  const last = series[series.length - 1].date;
  const from = minusDays(last, days);
  if (days === 0 || from <= series[0].date) chart.timeScale().fitContent();
  else chart.timeScale().setVisibleRange({ from: from as Time, to: last as Time });
}

function Toggle({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${on ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
    >
      {color && <span className="h-0.5 w-3 rounded" style={{ background: on ? color : '#45464a' }} />}
      {children}
    </button>
  );
}

type Hover = { date: string; open: number; high: number; low: number; close: number };
/** Operaciones del día sobre el que está el cursor, y dónde dibujar su tarjeta. */
type Card = { x: number; y: number; ops: Operation[] };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** Qué pasó después de la operación, en una frase. */
function outcome(op: Operation): { label: string; cls: string; text: string } {
  const d = op.decision;
  const buy = op.type === 'COMPRA';
  if (!d) return { label: 'Sin veredicto', cls: 'bg-card text-muted', text: '' };
  if (d.verdict && d.change != null) {
    const moved = `${d.change > 0 ? 'subió' : 'bajó'} ${pct(Math.abs(d.change)).replace('+', '')} en dólares a los ${d.days} días`;
    if (d.verdict === 'NEUTRAL') return { label: 'Neutral', cls: 'bg-card text-muted', text: `El precio casi no se movió (${pct(d.change)} en dólares a los ${d.days} días).` };
    const hit = d.verdict === 'ACIERTO';
    return {
      label: hit ? 'Acierto' : 'Error',
      cls: hit ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
      text: buy ? `Después de comprar, el precio ${moved}.` : `Después de vender, el precio ${moved}.`,
    };
  }
  if (d.noData) return { label: 'Sin datos', cls: 'bg-card text-muted', text: 'No hay precios guardados de esa época para evaluarla.' };
  return {
    label: 'Esperando',
    cls: 'bg-card text-muted',
    text: `Todavía no pasaron 30 días.${d.sinceChange != null ? ` Hasta hoy: ${pct(d.sinceChange)} en dólares.` : ''}`,
  };
}

/** La tarjeta que aparece al pasar el cursor por una marca: qué hiciste, por qué y cómo salió. */
function OperationCard({ op, currency }: { op: Operation; currency: Currency }) {
  const o = outcome(op);
  const missed = op.decision?.missed;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {op.type === 'COMPRA' ? 'Compra' : 'Venta'} · {fmtDate(op.date)}
        </span>
        <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${o.cls}`}>{o.label}</span>
      </div>
      <p className="tabular text-xs text-muted">
        {num(op.quantity)} a {money(op.priceConv, currency)} = {money(op.totalConv, currency)}
      </p>
      {op.note_title || op.note_body ? (
        <div className="rounded-md bg-card px-2.5 py-2">
          <p className="text-[11px] text-muted">Por qué lo hiciste</p>
          {op.note_title && <p className="text-sm">“{op.note_title}”</p>}
          {op.note_body && <p className="mt-0.5 text-xs leading-relaxed text-muted">{clip(op.note_body, 220)}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted">No anotaste por qué. Podés agregarlo abriendo la operación.</p>
      )}
      {op.firstImageId != null && <img src={imageUrl(op.firstImageId)} alt="" className="max-h-28 w-full rounded-md object-cover" loading="lazy" />}
      {o.text && <p className="text-xs leading-relaxed">{o.text}</p>}
      {op.decision && soldWithinText({ type: op.type, verdict: op.decision.verdict, soldWithin: op.decision.soldWithin }, currency) && (
        <p className="tabular text-xs">{soldWithinText({ type: op.type, verdict: op.decision.verdict, soldWithin: op.decision.soldWithin }, currency)}</p>
      )}
      {op.type === 'VENTA' && op.realized != null && (
        <p className="tabular text-xs">
          Con esta venta {op.realized >= 0 ? 'ganaste' : 'perdiste'} <span className={tone(op.realized)}>{money(Math.abs(op.realized), currency)}</span>
          {op.realizedPct != null && <span className="text-muted"> ({pct(op.realizedPct)})</span>}.
        </p>
      )}
      {missed != null && Math.abs(missed) >= 0.005 && (
        <p className="tabular text-xs">
          Al precio de hoy, {missed > 0 ? 'dejaste de ganar' : 'te ahorraste de perder'}{' '}
          <span className={missed > 0 ? 'text-down' : 'text-up'}>{money(Math.abs(missed), currency)}</span>.
        </p>
      )}
    </div>
  );
}

export function PriceChart({
  series,
  operations,
  currency,
  avgCost,
}: {
  series: PricePoint[];
  operations: Operation[];
  currency: Currency;
  /** Precio promedio de compra de lo que tenés hoy (0 si no tenés). */
  avgCost: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // Al cambiar de vista se recrea el gráfico: guardamos el zoom para no perderlo
  const savedRange = useRef<LogicalRange | null>(null);
  const [range, setRange] = useState<RangeLabel>('1A');
  const [candles, setCandles] = useState(false);
  const [mas, setMas] = useState<Record<MaKey, boolean>>({ ma50: false, ma200: false });
  const [showAvg, setShowAvg] = useState(true);
  const [hover, setHover] = useState<Hover | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!container.current || series.length === 0) return;
    const priceFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: currency === 'USD' ? 2 : 0 });

    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#111213' },
        textColor: '#8a8a8f',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: { vertLines: { color: '#1c1d1f' }, horzLines: { color: '#1c1d1f' } },
      rightPriceScale: { borderColor: '#2a2b2e' },
      timeScale: { borderColor: '#2a2b2e' },
      crosshair: { mode: candles ? CrosshairMode.Normal : CrosshairMode.Magnet },
      localization: { locale: 'es-AR', priceFormatter: (p: number) => priceFmt.format(p) },
    });
    chartRef.current = chart;

    const main = candles
      ? chart.addSeries(CandlestickSeries, {
          upColor: UP,
          downColor: DOWN,
          borderVisible: false,
          wickUpColor: UP,
          wickDownColor: DOWN,
          priceLineVisible: false,
        })
      : chart.addSeries(LineSeries, { color: ACCENT, lineWidth: 2, priceLineVisible: false });
    main.setData(
      candles
        ? series.map((p) => ({ time: p.date as Time, open: p.open, high: p.high, low: p.low, close: p.close }))
        : series.map((p) => ({ time: p.date as Time, value: p.close })),
    );

    for (const ma of MAS) {
      if (!mas[ma.key] || series.length < ma.days) continue;
      const line = chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      line.setData(movingAverage(series, ma.days));
    }

    if (showAvg && avgCost > 0) {
      main.createPriceLine({
        price: avgCost,
        color: '#c8c8cc',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Tu promedio',
      });
    }

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      series.map((p, i) => ({
        time: p.date as Time,
        value: p.volume ?? 0,
        color: i > 0 && p.close < series[i - 1].close ? 'rgba(194,84,80,0.45)' : 'rgba(79,157,105,0.45)',
      })),
    );

    const dates = series.map((p) => p.date);
    // El gráfico como diario: la flecha dice si compraste (▲, abajo) o vendiste (▼, arriba);
    // el color, cómo salió: verde acierto, rojo error, gris si todavía no hay veredicto.
    const opsByDate = new Map<string, Operation[]>();
    for (const op of operations) {
      const day = snapToSeries(dates, op.date);
      opsByDate.set(day, [...(opsByDate.get(day) ?? []), op]);
    }
    const markers: SeriesMarker<Time>[] = operations
      .map((op) => ({
        time: snapToSeries(dates, op.date) as Time,
        position: op.type === 'COMPRA' ? ('belowBar' as const) : ('aboveBar' as const),
        color: verdictColor(op),
        shape: op.type === 'COMPRA' ? ('arrowUp' as const) : ('arrowDown' as const),
        size: 1.4,
        text: op.type === 'COMPRA' ? 'C' : 'V',
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    createSeriesMarkers(main, markers);

    const byDate = new Map(series.map((p) => [p.date, p]));
    chart.subscribeCrosshairMove((param) => {
      const day = param.time ? timeToIso(param.time) : '';
      const p = byDate.get(day);
      setHover(p ? { date: p.date, open: p.open, high: p.high, low: p.low, close: p.close } : null);
      // Si ese día hubo operaciones, se muestra su tarjeta al lado del cursor
      const ops = opsByDate.get(day);
      setCard(ops && param.point ? { x: param.point.x, y: param.point.y, ops } : null);
    });
    // Un clic sobre un día con operaciones abre la operación (la primera, si hubo varias)
    chart.subscribeClick((param) => {
      const ops = param.time ? opsByDate.get(timeToIso(param.time)) : undefined;
      if (ops?.length) navigate(`/operacion/${ops[0].id}`);
    });

    if (savedRange.current) chart.timeScale().setVisibleLogicalRange(savedRange.current);
    else {
      applyRange(chart, series, range);
      // El gráfico toma su ancho real un instante después de crearse. Si el rango se ajusta solo
      // antes, los primeros días (y la marca de la primera compra) quedan fuera, a la izquierda.
      requestAnimationFrame(() => {
        if (chartRef.current === chart) applyRange(chart, series, range);
      });
    }
    return () => {
      savedRange.current = chart.timeScale().getVisibleLogicalRange();
      chart.remove();
      chartRef.current = null;
    };
    // El rango se aplica en el efecto de abajo para no recrear el gráfico
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, operations, currency, candles, mas, showAvg, avgCost, navigate]);

  useEffect(() => {
    if (chartRef.current && series.length) applyRange(chartRef.current, series, range);
  }, [range, series]);

  if (series.length === 0) return <div className="grid h-96 place-items-center rounded-xl bg-panel text-muted">Sin precios</div>;

  const last = series[series.length - 1];
  const shown = hover ?? last;
  // Variación del período visible elegido
  const days = RANGES.find((r) => r.label === range)!.days;
  const start = days ? series.find((p) => p.date >= minusDays(last.date, days)) ?? series[0] : series[0];
  const periodChange = last.close / start.close - 1;
  const vsAvg = avgCost > 0 ? shown.close / avgCost - 1 : null;

  return (
    <div className="rounded-xl bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tabular text-2xl font-semibold">{money(shown.close, currency)}</p>
          <p className="tabular text-xs text-muted">
            {fmtDate(shown.date)} ·{' '}
            <span className={tone(periodChange)}>
              {pct(periodChange)} en {range === 'Todo' ? 'todo el período' : range}
            </span>
            {vsAvg != null && (
              <>
                {' · '}
                <span className={tone(vsAvg)}>{pct(vsAvg)} vs. tu promedio</span>
              </>
            )}
          </p>
          {candles && hover && (
            <p className="tabular mt-0.5 text-xs text-muted">
              Apertura {money(hover.open, currency)} · Máx {money(hover.high, currency)} · Mín {money(hover.low, currency)}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-lg bg-bg p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => {
                savedRange.current = null;
                setRange(r.label);
              }}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                range === r.label ? 'bg-card text-text' : 'text-muted hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="flex gap-1 rounded-lg bg-bg p-1">
          <Toggle on={!candles} onClick={() => setCandles(false)}>
            Línea
          </Toggle>
          <Toggle on={candles} onClick={() => setCandles(true)}>
            Velas
          </Toggle>
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-bg p-1">
          {MAS.map((ma) => (
            <Toggle key={ma.key} on={mas[ma.key]} color={ma.color} onClick={() => setMas((m) => ({ ...m, [ma.key]: !m[ma.key] }))}>
              {ma.label}
            </Toggle>
          ))}
          {avgCost > 0 && (
            <Toggle on={showAvg} color="#c8c8cc" onClick={() => setShowAvg((v) => !v)}>
              Tu precio promedio
            </Toggle>
          )}
        </div>
      </div>

      <div className="relative">
        <div ref={container} className="h-80 w-full md:h-96" />
        {card && (
          <div
            className="pointer-events-none absolute z-10 flex flex-col gap-3 rounded-lg border border-line bg-panel p-3 shadow-xl shadow-black/50"
            style={{
              width: CARD_WIDTH,
              // A la derecha del cursor; si no entra, a la izquierda
              left: Math.max(0, card.x + CARD_WIDTH + 24 > (container.current?.clientWidth ?? 0) ? card.x - CARD_WIDTH - 16 : card.x + 16),
              top: 8,
            }}
          >
            {card.ops.slice(0, 2).map((op) => (
              <OperationCard key={op.id} op={op} currency={currency} />
            ))}
            {card.ops.length > 2 && <p className="text-xs text-muted">y {card.ops.length - 2} operaciones más ese día</p>}
            <p className="text-[11px] text-muted">Clic para abrir la operación</p>
          </div>
        )}
      </div>

      {operations.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>▲ compra · ▼ venta</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-up" /> acierto
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-down" /> error
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-muted" /> neutral o sin veredicto todavía
          </span>
          <span>Pasá el cursor por una marca para ver por qué la hiciste y cómo salió.</span>
        </p>
      )}

      {(mas.ma50 || mas.ma200) && (
        <p className="mt-2 text-xs text-muted">
          La media móvil es el precio promedio de los últimos 50 o 200 días: suaviza el ruido y muestra la tendencia. Cuando el precio está
          por encima de la media de 200 días, se suele considerar que la tendencia es alcista.
        </p>
      )}
    </div>
  );
}
