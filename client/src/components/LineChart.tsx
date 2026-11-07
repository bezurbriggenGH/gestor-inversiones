import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { Currency } from '../api';
import { date as fmtDate, money } from '../format';

export interface ChartLine {
  key: string;
  label: string;
  color: string;
  data: { date: string; value: number }[];
  area?: boolean;
  dashed?: boolean;
}

function timeToIso(t: Time): string {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10);
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

/** Gráfico de varias líneas con leyenda que muestra el valor bajo el cursor. */
export function LineChart({ lines, currency, height = 'h-80' }: { lines: ChartLine[]; currency: Currency; height?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<{ date: string; values: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const fmt = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
    const chart = createChart(container.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#111213' }, textColor: '#8a8a8f', fontFamily: 'Inter, system-ui, sans-serif' },
      grid: { vertLines: { color: '#1c1d1f' }, horzLines: { color: '#1c1d1f' } },
      rightPriceScale: { borderColor: '#2a2b2e' },
      timeScale: { borderColor: '#2a2b2e' },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: 'es-AR', priceFormatter: (p: number) => fmt.format(p) },
    });
    chartRef.current = chart;

    const series = new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Area'>>();
    for (const l of lines) {
      const s = l.area
        ? chart.addSeries(AreaSeries, {
            lineColor: l.color,
            topColor: `${l.color}55`,
            bottomColor: `${l.color}05`,
            lineWidth: 2,
            priceLineVisible: false,
          })
        : chart.addSeries(LineSeries, {
            color: l.color,
            lineWidth: 2,
            lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
            priceLineVisible: false,
            lastValueVisible: false,
          });
      s.setData(l.data.map((p) => ({ time: p.date as Time, value: p.value })));
      series.set(l.key, s);
    }
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setHover(null);
      const values: Record<string, number> = {};
      for (const [k, s] of series) {
        const d = param.seriesData.get(s);
        if (d && 'value' in d) values[k] = Number(d.value);
      }
      setHover({ date: timeToIso(param.time), values });
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [lines, currency]);

  const lastValues: Record<string, number> = {};
  for (const l of lines) if (l.data.length) lastValues[l.key] = l.data[l.data.length - 1].value;
  const shown = hover?.values ?? lastValues;
  const shownDate = hover?.date ?? lines[0]?.data.at(-1)?.date;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        {shownDate && <span className="text-muted">{fmtDate(shownDate)}</span>}
        {lines.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded" style={{ background: l.color }} />
            <span className="text-muted">{l.label}</span>
            <span className="tabular">{shown[l.key] != null ? money(shown[l.key], currency) : '—'}</span>
          </span>
        ))}
      </div>
      <div ref={container} className={`${height} w-full`} />
    </div>
  );
}
