import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
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

function applyRange(chart: IChartApi, series: PricePoint[], range: RangeLabel) {
  const days = RANGES.find((r) => r.label === range)!.days;
  const last = series[series.length - 1].date;
  const from = minusDays(last, days);
  if (days === 0 || from <= series[0].date) chart.timeScale().fitContent();
  else chart.timeScale().setVisibleRange({ from: from as Time, to: last as Time });
}

export function PriceChart({
  series,
  operations,
  currency,
}: {
  series: PricePoint[];
  operations: Operation[];
  currency: Currency;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<RangeLabel>('1A');
  const [hover, setHover] = useState<{ date: string; value: number } | null>(null);

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
      crosshair: { mode: CrosshairMode.Magnet },
      localization: { locale: 'es-AR', priceFormatter: (p: number) => priceFmt.format(p) },
    });
    chartRef.current = chart;

    const line = chart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 2, priceLineVisible: false });
    line.setData(series.map((p) => ({ time: p.date as Time, value: p.close })));

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
        color: op.type === 'COMPRA' ? '#22c55e' : '#ef4444',
        shape: 'circle' as const,
        size: 1.4,
        text: `${op.type === 'COMPRA' ? 'Compra' : 'Venta'} ${num(op.quantity)}`,
      }))
      .sort((a, b) => String(a.time).localeCompare(String(b.time)));
    createSeriesMarkers(line, markers);

    chart.subscribeCrosshairMove((param) => {
      const d = param.time ? param.seriesData.get(line) : undefined;
      if (param.time && d && 'value' in d) setHover({ date: timeToIso(param.time), value: Number(d.value) });
      else setHover(null);
    });

    applyRange(chart, series, range);
    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // El rango se aplica en el efecto de abajo para no recrear el gráfico
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, operations, currency]);

  useEffect(() => {
    if (chartRef.current && series.length) applyRange(chartRef.current, series, range);
  }, [range, series]);

  if (series.length === 0) return <div className="grid h-96 place-items-center rounded-xl bg-panel text-muted">Sin precios</div>;

  const last = series[series.length - 1];
  const shown = hover ?? { date: last.date, value: last.close };
  // Variación del período visible elegido
  const days = RANGES.find((r) => r.label === range)!.days;
  const start = days ? series.find((p) => p.date >= minusDays(last.date, days)) ?? series[0] : series[0];
  const periodChange = last.close / start.close - 1;

  return (
    <div className="rounded-xl bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="tabular text-2xl font-semibold">{money(shown.value, currency)}</p>
          <p className="tabular text-xs text-muted">
            {fmtDate(shown.date)} ·{' '}
            <span className={tone(periodChange)}>
              {pct(periodChange)} en {range === 'Todo' ? 'todo el período' : range}
            </span>
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-bg p-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                range === r.label ? 'bg-card text-text' : 'text-muted hover:text-text'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={container} className="h-80 w-full md:h-96" />
    </div>
  );
}
