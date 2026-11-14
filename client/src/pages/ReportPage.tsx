// Informe: todo lo importante en una sola hoja, para guardar como PDF o imprimir.
// No usa ninguna librería: el navegador ya sabe guardar una página como PDF (Imprimir → Guardar como PDF).
// Al imprimir, la página pasa a fondo blanco y se ocultan el menú y los botones (ver index.css).
import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { useCosts, useHistory, useHold, useJournal, usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { FX_LABEL, date, money, num, pct, share, todayIso, tone } from '../format';
import { Button, ErrorBox, Loading } from '../components/ui';
import { CostsResult, HoldResult, journalPatterns } from '../components/Balance';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex break-inside-avoid flex-col gap-3 rounded-xl bg-panel p-5">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-card px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`tabular mt-1 text-lg font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

const rate = (v: number | null | undefined) => (v == null ? '—' : pct(v));

export function ReportPage() {
  const { user } = useAuth();
  const { currency, fxKind } = useSettings();
  const portfolio = usePortfolio();
  const history = useHistory();
  const journal = useJournal();
  const costs = useCosts();
  const since = `${todayIso().slice(0, 4)}-01-01`;
  const hold = useHold(since);

  const error = portfolio.error ?? history.error ?? journal.error ?? costs.error ?? hold.error;
  if (error) return <ErrorBox error={error} />;
  if (!portfolio.data || !history.data || !journal.data || !costs.data || !hold.data) return <Loading label="Armando el informe…" />;

  const p = portfolio.data;
  const h = history.data;
  const j = journal.data;
  const s = p.summary;
  const held = p.positions.filter((x) => x.quantity > 0).sort((a, b) => b.marketValue - a.marketValue);

  // Rendimiento de cada año: se encadenan los meses (10% y después 10% es 21%, no 20%)
  const years = new Map<string, { factor: number; gain: number }>();
  for (const m of h.monthly) {
    const y = years.get(m.month.slice(0, 4)) ?? { factor: 1, gain: 0 };
    y.factor *= 1 + m.return;
    y.gain += m.gain;
    years.set(m.month.slice(0, 4), y);
  }
  const patterns = journalPatterns(j.stats);

  if (p.positions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Informe</h1>
        <p className="text-muted">Cuando cargues operaciones, acá vas a poder armar un informe para guardar como PDF.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Informe de inversiones</h1>
          <p className="mt-1 text-sm text-muted">
            {user?.name} · al {date(todayIso())} · en {currency === 'ARS' ? 'pesos' : `dólares ${FX_LABEL[fxKind]}`}
            {p.fx && ` · dólar ${FX_LABEL[p.fxKind]} ${money(p.fx.rate, 'ARS')}`}
          </p>
        </div>
        <Button variant="primary" className="print:hidden" onClick={() => window.print()}>
          Guardar como PDF
        </Button>
      </div>
      <p className="text-xs text-muted print:hidden">
        Se abre la ventana de imprimir: elegí "Guardar como PDF" como destino. El informe sale en la moneda que tengas elegida en el menú.
      </p>

      <Block title="Resumen">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="La cartera vale" value={money(s.marketValue, currency)} />
          <Fact label="Ganancia total" value={money(s.totalGain, currency, true)} cls={tone(s.totalGain)} />
          <Fact label="Rendimiento por año (TIR)" value={rate(h.portfolio?.irr)} cls={tone(h.portfolio?.irr ?? 0)} />
          <Fact label="Por año contra la inflación" value={rate(p.realReturn?.irr)} cls={tone(p.realReturn?.irr ?? 0)} />
        </div>
        <p className="tabular text-sm text-muted">
          De la ganancia total: {money(s.unrealized, currency, true)} en lo que tenés hoy, {money(s.realized, currency, true)} en ventas ya hechas y{' '}
          {money(s.dividends, currency, true)} en dividendos. Es un {pct(s.totalGainPct)} sobre los {money(s.peakCapital, currency)} que llegaste a
          tener puestos.
        </p>
      </Block>

      <Block title="Lo que tenés hoy">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Activo</th>
              <th className="py-2 text-right font-normal">Cantidad</th>
              <th className="py-2 text-right font-normal">Precio</th>
              <th className="py-2 text-right font-normal">Valor</th>
              <th className="py-2 text-right font-normal">Peso</th>
              <th className="py-2 text-right font-normal">Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {held.map((x) => (
              <tr key={x.ticker} className="border-b border-line/50 last:border-0">
                <td className="py-1.5">
                  {x.ticker} <span className="text-xs text-muted">{x.type === 'CEDEAR' ? 'CEDEAR' : 'Acción'}</span>
                </td>
                <td className="py-1.5 text-right">{num(x.quantity)}</td>
                <td className="py-1.5 text-right">{money(x.price, currency)}</td>
                <td className="py-1.5 text-right">{money(x.marketValue, currency, false, true)}</td>
                <td className="py-1.5 text-right">{share(x.weight)}</td>
                <td className={`py-1.5 text-right ${tone(x.unrealized)}`}>
                  {money(x.unrealized, currency, true, true)} ({pct(x.unrealizedPct, 1)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>

      <Block title="Rendimiento por año">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Año</th>
              <th className="py-2 text-right font-normal">Rendimiento</th>
              <th className="py-2 text-right font-normal">Ganancia</th>
            </tr>
          </thead>
          <tbody>
            {[...years].map(([year, y]) => (
              <tr key={year} className="border-b border-line/50 last:border-0">
                <td className="py-1.5">{year}</td>
                <td className={`py-1.5 text-right ${tone(y.factor - 1)}`}>{pct(y.factor - 1)}</td>
                <td className={`py-1.5 text-right ${tone(y.gain)}`}>{money(y.gain, currency, true, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted">Rendimiento de la cartera sin contar la plata que agregaste o sacaste. El año en curso va hasta hoy.</p>
      </Block>

      <Block title="Contra otras alternativas">
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">Con la misma plata, en las mismas fechas</th>
              <th className="py-2 text-right font-normal">Hoy tendrías</th>
              <th className="py-2 text-right font-normal">Tu cartera vs. esto</th>
              <th className="py-2 text-right font-normal">Por año</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line/50 font-medium">
              <td className="py-1.5">Tu cartera</td>
              <td className="py-1.5 text-right">{money(h.portfolio?.value ?? 0, currency, false, true)}</td>
              <td className="py-1.5 text-right text-muted">—</td>
              <td className="py-1.5 text-right">{rate(h.portfolio?.irr)}</td>
            </tr>
            {h.benchmarks
              .filter((b) => b.available)
              .map((b) => (
                <tr key={b.key} className="border-b border-line/50 last:border-0">
                  <td className="py-1.5">{b.label}</td>
                  <td className="py-1.5 text-right">{money(b.value!, currency, false, true)}</td>
                  <td className={`py-1.5 text-right ${tone(b.diff!)}`}>{money(b.diff!, currency, true, true)}</td>
                  <td className="py-1.5 text-right">{rate(b.irr)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Block>

      <Block title={`¿Y si no hubieras tocado nada en ${since.slice(0, 4)}?`}>
        <HoldResult data={hold.data} />
      </Block>

      <Block title="Cuánto te costó operar">
        <CostsResult data={costs.data} />
      </Block>

      <Block title="Tus decisiones">
        <div className="grid gap-3 sm:grid-cols-3">
          <Fact label="Aciertos" value={j.stats.all.hitRate == null ? '—' : share(j.stats.all.hitRate)} />
          <Fact label="En compras" value={j.stats.buys.hitRate == null ? '—' : share(j.stats.buys.hitRate)} />
          <Fact label="En ventas" value={j.stats.sells.hitRate == null ? '—' : share(j.stats.sells.hitRate)} />
        </div>
        <p className="text-sm text-muted">
          {j.stats.all.hits} aciertos de {j.stats.all.judged} operaciones evaluadas ({j.stats.all.total} en total). Una compra es acierto si a
          los 90 días el precio subió en dólares; una venta, si bajó. Mide el momento de cada decisión, no si se ganó plata.
        </p>
        {j.closed.count > 0 && (
          <p className="tabular text-sm">
            Ganaste plata en {j.closed.wins} de {j.closed.wins + j.closed.losses} ventas
            {j.closed.winRate != null && ` (${share(j.closed.winRate)})`}: {money(j.closed.gained, currency, true, true)} en las buenas y{' '}
            {money(-j.closed.lost, currency, true, true)} en las malas, contra tu precio promedio.
          </p>
        )}
        {j.sold.count > 0 && (
          <p className="tabular text-sm">
            De tus {j.sold.count} ventas: después de {j.sold.savedCount} el precio bajó (te ahorraste {money(j.sold.saved, currency, false, true)}) y
            después de {j.sold.missedCount} subió (dejaste de ganar {money(j.sold.missed, currency, false, true)}). En conjunto, vender{' '}
            {j.sold.net >= 0 ? 'te convino' : 'no te convino'} por{' '}
            <span className={tone(j.sold.net)}>{money(Math.abs(j.sold.net), currency, false, true)}</span>.
          </p>
        )}
        {patterns.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {patterns.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </Block>

      <p className="text-xs text-muted">
        Precios: Yahoo Finance. Dólar, inflación (UVA) y plazo fijo: ArgentinaDatos. Costo por precio promedio ponderado, comisiones incluidas.
        {currency === 'USD' && ' En dólares, cada operación se convierte con el dólar del día en que se hizo.'}
      </p>
    </div>
  );
}
