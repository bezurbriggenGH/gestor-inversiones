import { useMemo } from 'react';
import type { CedearInfo } from '../api';
import { date, money, pct, tone } from '../format';
import { LineChart, type ChartLine } from './LineChart';

const FAIR_BAND = 0.02; // ±2% se considera "en línea"

function verdict(gap: number) {
  if (gap > FAIR_BAND) return { label: 'Caro', cls: 'bg-down/15 text-down', text: 'estás pagando un dólar más alto que el CCL del mercado' };
  if (gap < -FAIR_BAND) return { label: 'Barato', cls: 'bg-up/15 text-up', text: 'estás comprando dólares más baratos que el CCL del mercado' };
  return { label: 'En línea', cls: 'bg-card text-muted', text: 'el precio refleja bien el CCL del mercado' };
}

function Box({ label, value, sub, cls = '' }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-card px-4 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular whitespace-nowrap font-semibold ${cls}`}>{value}</span>
      {sub && <span className="tabular text-xs text-muted">{sub}</span>}
    </div>
  );
}

/** Dólar implícito del CEDEAR comparado con el CCL: ¿está caro o barato? */
export function CedearPanel({ ticker, info }: { ticker: string; info: CedearInfo }) {
  const lines = useMemo<ChartLine[]>(
    () =>
      info.status === 'OK'
        ? [
            { key: 'implied', label: `CCL implícito de ${ticker}`, color: '#8b5cf6', data: info.history.map((p) => ({ date: p.date, value: p.impliedCcl })) },
            { key: 'ccl', label: 'CCL del mercado', color: '#a3a3a3', dashed: true, data: info.history.map((p) => ({ date: p.date, value: p.ccl })) },
          ]
        : [],
    [info, ticker],
  );

  if (info.status === 'SIN_DATOS') {
    return (
      <section className="rounded-xl bg-panel p-5 text-sm text-muted">
        Todavía no hay precios de {info.usSymbol} en EE.UU. para calcular el dólar implícito. Se completan en la próxima actualización.
      </section>
    );
  }
  if (info.status === 'RATIO_DUDOSO') {
    return (
      <section className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-5 text-sm text-yellow-300">
        El ratio de {ticker} parece haber cambiado (los precios indican ~{info.observedRatio.toFixed(1)}, la tabla dice {info.ratio}). Puede
        haber habido un split. No mostramos el dólar implícito hasta confirmar el ratio nuevo.
      </section>
    );
  }

  const v = verdict(info.gap);
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-medium">¿Está caro o barato el CEDEAR?</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>
      </div>
      <p className="text-sm text-muted">
        Comprando {ticker} hoy, {v.text}: el dólar implícito es {money(info.impliedCcl, 'ARS')} contra un CCL de {money(info.ccl, 'ARS')}{' '}
        (<span className={tone(-info.gap)}>{pct(info.gap)}</span>).
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Box label="CCL implícito" value={money(info.impliedCcl, 'ARS')} sub={`al ${date(info.date)}`} />
        <Box label="Brecha contra el CCL" value={pct(info.gap)} sub={`promedio del mes: ${pct(info.gapAvg)}`} cls={tone(-info.gap)} />
        <Box label={`${info.usSymbol} en EE.UU.`} value={money(info.usPrice, 'USD')} sub="por acción" />
        <Box label="Ratio" value={`${info.ratio} : 1`} sub={`${info.ratio} CEDEARs = 1 acción`} />
      </div>

      {lines.length > 0 && lines[0].data.length > 1 && <LineChart lines={lines} currency="ARS" height="h-56" />}

      <p className="text-xs text-muted">
        CCL implícito = precio del CEDEAR en pesos × ratio ÷ precio de la acción en dólares. Se calcula con los precios de cierre de ambos
        mercados. Una brecha de ±2% es normal por diferencias de horario y liquidez.
      </p>
    </section>
  );
}
