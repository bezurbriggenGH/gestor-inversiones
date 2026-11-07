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
import type { Currency, Operation, PricePoint } from '../api';
import { date as fmtDate, money, num, pct, tone } from '../format';

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
  { key: 'ma50', days: 50, color: '#f59e0b', label: 'Media 50 días' },
  { key: 'ma200', days: 200, color: '#22d3ee', label: 'Media 200 días' },
] as const;
type MaKey = (typeof MAS)[number]['key'];

const UP = '#22c55e';
const DOWN = '#ef4444';
const ACCENT = '#8b5cf6';

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
      {color && <span className="h-0.5 w-3 rounded" style={{ background: on ? color : '#525252' }} />}
      {children}
    </button>
  );
}

type Hover = { date: string; open: number; high: number; low: number; close: number };

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

  useEffect(() => {
    if (!container.current || series.length === 0) return;
    const priceFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: currency === 'USD' ? 2 : 0 });

    const chart = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#0d0d0d' },
        textColor: '#a3a3a3',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: { vertLines: { color: '#1a1a1a' }, horzLines: { color: '#1a1a1a' } },
      rightPriceScale: { borderColor: '#2a2a2a' },
      timeScale: { borderColor: '#2a2a2a' },
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
        color: '#e5e5e5',
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
        color: i > 0 && p.close < series[i - 1].close ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)',
      })),
    );

    const dates = series.map((p) => p.date);
    const markers: SeriesMarker<Time>[] = operations
      .map((op) => ({
        time: snapToSeries(dates, op.date) as Time,
        position: op.type === 'COMPRA' ? ('belowBar' as const) : ('aboveBar' as const),
        color: op.type === 'COMPRA' ? UP : DOWN,
        shape: candles ? (op.type === 'COMPRA' ? ('arrowUp' as const) : ('arrowDown' as const)) : ('circle' as const),
        size: 1.4,
        text: `${op.type === 'COMPRA' ? 'Compra' : 'Venta'} ${num(op.quantity)}`,
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    createSeriesMarkers(main, markers);

    const byDate = new Map(series.map((p) => [p.date, p]));
    chart.subscribeCrosshairMove((param) => {
      const p = param.time ? byDate.get(timeToIso(param.time)) : undefined;
      setHover(p ? { date: p.date, open: p.open, high: p.high, low: p.low, close: p.close } : null);
    });

    if (savedRange.current) chart.timeScale().setVisibleLogicalRange(savedRange.current);
    else applyRange(chart, series, range);
    return () => {
      savedRange.current = chart.timeScale().getVisibleLogicalRange();
      chart.remove();
      chartRef.current = null;
    };
    // El rango se aplica en el efecto de abajo para no recrear el gráfico
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, operations, currency, candles, mas, showAvg, avgCost]);

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
            <Toggle on={showAvg} color="#e5e5e5" onClick={() => setShowAvg((v) => !v)}>
              Tu precio promedio
            </Toggle>
          )}
        </div>
      </div>

      <div ref={container} className="h-80 w-full md:h-96" />

      {(mas.ma50 || mas.ma200) && (
        <p className="mt-2 text-xs text-muted">
          La media móvil es el precio promedio de los últimos 50 o 200 días: suaviza el ruido y muestra la tendencia. Cuando el precio está
          por encima de la media de 200 días, se suele considerar que la tendencia es alcista.
        </p>
      )}
    </div>
  );
}
