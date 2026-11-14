import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Currency, type ExposureGroup, type Rebalance, type Review, type ReviewItem } from '../api';
import { usePortfolio } from '../hooks';
import { useSettings } from '../settings';
import { money, share } from '../format';
import { Button, ErrorBox, Loading } from '../components/ui';
import { PortfolioTreemap } from '../components/PortfolioTreemap';

// Un color por tipo de activo (no uno por activo: con muchos activos los colores se repetían)
const TYPE_COLOR = { ACCION: '#5a9bb0', CEDEAR: '#7c6bb0' } as const;
const UNCLASSIFIED = 'Sin clasificar';

/** Barras de cuánto pesa cada sector o país, con los activos de cada uno. */
function Exposure({ title, groups, currency }: { title: string; groups: ExposureGroup[]; currency: Currency }) {
  const max = Math.max(...groups.map((g) => g.weight));
  const unknown = groups.find((g) => g.name === UNCLASSIFIED);
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-panel p-5">
      <h2 className="font-medium">{title}</h2>
      {groups.map((g) => (
        <div key={g.name} className="flex flex-col gap-1">
          <div className="tabular flex items-baseline justify-between gap-3 text-sm">
            <span className={g.name === UNCLASSIFIED ? 'text-muted' : ''}>{g.name}</span>
            <span>
              <span className="mr-3 text-muted">{money(g.value, currency, false, true)}</span>
              {share(g.weight)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card">
            <div className={`h-full rounded-full ${g.name === UNCLASSIFIED ? 'bg-muted' : 'bg-accent'}`} style={{ width: `${(g.weight / max) * 100}%` }} />
          </div>
          <p className="text-xs text-muted">{g.tickers.join(' · ')}</p>
        </div>
      ))}
      {unknown && (
        <p className="text-xs text-muted">
          "Sin clasificar": activos que la app todavía no tiene en su lista y de los que la fuente de precios no informa el dato.
        </p>
      )}
    </div>
  );
}

export function CompositionPage() {
  const { currency } = useSettings();
  const { data, isLoading, error } = usePortfolio();

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const rows = data.positions.filter((p) => p.marketValue > 0).sort((a, b) => b.marketValue - a.marketValue);
  if (rows.length === 0) return <p className="text-muted">Cuando tengas tenencias vas a ver acá cómo se reparte tu cartera.</p>;

  const total = data.summary.marketValue;
  const byType = (['ACCION', 'CEDEAR'] as const).map((t) => {
    const value = rows.filter((r) => r.type === t).reduce((a, r) => a + r.marketValue, 0);
    return { type: t, value, weight: total > 0 ? value / total : 0 };
  });
  const target = data.review.target;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Composición</h1>

      <ReviewBox review={data.review} />

      <PortfolioTreemap positions={rows} />

      {/* Cuánto pesa cada activo. El color dice el tipo (el mismo de los recuadros de abajo). */}
      <section className="flex flex-col gap-2 rounded-xl bg-panel p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Cuánto pesa cada activo</h2>
          <p className="tabular text-sm text-muted">
            {rows.length} activos · {money(total, currency, false, true)}
          </p>
        </div>
        {rows.map((r) => (
          <Link
            key={r.ticker}
            to={`/activo/${r.ticker}`}
            className="tabular grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-md px-1 py-0.5 text-sm hover:bg-card sm:grid-cols-[4.5rem_1fr_9rem_3.5rem]"
          >
            <span className="font-medium">{r.ticker}</span>
            <div className="h-2 overflow-hidden rounded-full bg-card">
              <div className="h-full rounded-full" style={{ width: `${(r.weight / rows[0].weight) * 100}%`, background: TYPE_COLOR[r.type] }} />
            </div>
            <span className="hidden text-right text-muted sm:block">{money(r.marketValue, currency, false, true)}</span>
            <span className="text-right">{share(r.weight)}</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {byType.map((t) => (
          <div key={t.type} className="rounded-xl bg-panel p-5">
            <p className="flex items-center gap-2 text-sm text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLOR[t.type] }} />
              {t.type === 'ACCION' ? 'Acciones argentinas' : 'CEDEARs'}
            </p>
            <p className="tabular mt-1 text-xl font-semibold">
              {share(t.weight)}
              {target && (
                <span className="ml-2 text-sm font-normal text-muted">
                  objetivo {share(t.type === 'CEDEAR' ? target.target : 1 - target.target)}
                </span>
              )}
            </p>
            <p className="tabular text-sm text-muted">{money(t.value, currency)}</p>
            <p className="mt-2 text-xs text-muted">
              {t.type === 'ACCION'
                ? 'Riesgo ligado a la economía argentina.'
                : 'Siguen a empresas del exterior y al dólar CCL: protegen frente a una devaluación.'}
            </p>
          </div>
        ))}
      </section>
      <TargetBox target={target} currency={currency} warnings={data.review.items.length} />

      {/* Exposición real: diez activos distintos pueden ser casi todos del mismo sector o país */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Exposure title="Por sector" groups={data.exposure.sectors} currency={currency} />
        <Exposure title="Por país de la empresa" groups={data.exposure.countries} currency={currency} />
      </section>
    </div>
  );
}

const KIND_LABEL = { ACCION: 'acciones argentinas', CEDEAR: 'CEDEARs' } as const;
const list = (tickers: string[]) => (tickers.length === 1 ? tickers[0] : `${tickers.slice(0, -1).join(', ')} y ${tickers[tickers.length - 1]}`);

/** Una línea por aviso; el porqué queda a un clic. */
function reviewText(item: ReviewItem, limits: Review['limits']): { title: string; why: string } {
  const fall = `Si cae 30%, tu cartera entera baja ${share(item.weight * 0.3)}.`;
  if (item.kind === 'activo')
    return {
      title: `${item.tickers[0]} es el ${share(item.weight)} de tu cartera`,
      why: `${fall} La regla habitual es que un solo activo no pase del ${share(limits.asset)}: si a esa empresa le va mal, te afecta mucho al total.`,
    };
  if (item.kind === 'sector')
    return {
      title: `El ${share(item.weight)} de tu cartera está en ${item.name} (${list(item.tickers)})`,
      why: `Son activos distintos, pero las empresas de un mismo sector suelen subir y bajar juntas: si al sector le va mal, te afecta en todos a la vez. ${fall} La regla habitual es que un sector no pase del ${share(limits.sector)}.`,
    };
  return {
    title: `${list(item.tickers)} se mueven casi igual`,
    why: `En el último año, semana a semana y medido en dólares, cuando uno subía o bajaba los demás hacían casi lo mismo. Parecen ${item.tickers.length} activos, pero para el riesgo cuentan casi como uno solo, que pesa el ${share(item.weight)} de tu cartera. Diversificar no es tener muchos activos, sino activos que no caigan todos juntos.`,
  };
}

/** Para revisar: solo lo que salta. Si no salta nada, una línea que lo confirma. */
function ReviewBox({ review }: { review: Review }) {
  if (review.items.length === 0)
    return (
      <p className="flex items-center gap-3 rounded-xl bg-panel px-5 py-3 text-sm text-muted">
        <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-up" />
        Nada para revisar: ningún activo pasa del {share(review.limits.asset)}, ningún sector del {share(review.limits.sector)} y no hay activos
        que se muevan igual y pesen mucho juntos.
      </p>
    );
  return (
    <section className="rounded-xl border border-[#b8964f]/30 bg-panel p-5">
      <h2 className="mb-3 font-medium">Para revisar</h2>
      <ul className="flex flex-col divide-y divide-line">
        {review.items.map((item) => {
          const { title, why } = reviewText(item, review.limits);
          return (
            <li key={`${item.kind}-${item.tickers.join()}`} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[#c9ab6a]" />
              <div className="flex-1 text-sm">
                <p>{title}</p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-link">¿Por qué importa?</summary>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{why}</p>
                </details>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Objetivo de reparto entre acciones y CEDEARs: opcional. Dice qué hacer si te desviaste. */
function TargetBox({ target, currency, warnings }: { target: Rebalance | null; currency: Currency; warnings: number }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(50);
  const save = useMutation({
    mutationFn: api.setTarget,
    onSuccess: () => {
      setEditing(false);
      return qc.invalidateQueries({ queryKey: ['portfolio'] });
    },
  });

  if (editing)
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-panel p-5 text-sm">
        <p className="font-medium">¿Cómo querés repartir tu cartera?</p>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="flex-1 accent-[#7c6bb0]"
            aria-label="Porcentaje en CEDEARs"
          />
          <span className="tabular w-52 text-right">
            CEDEARs {value}% · Acciones {100 - value}%
          </span>
        </div>
        <p className="text-xs text-muted">Se avisa si te alejás más de 5 puntos (con 50%, entre 45% y 55% está bien).</p>
        {save.error && <p className="text-xs text-down">{save.error.message}</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => save.mutate(value)} disabled={save.isPending}>
            Guardar
          </Button>
          <Button onClick={() => setEditing(false)}>Cancelar</Button>
        </div>
      </section>
    );

  const edit = () => {
    setValue(target ? Math.round(target.target * 100) : 50);
    setEditing(true);
  };

  if (!target)
    return (
      <p className="-mt-2 text-sm text-muted">
        ¿Querés fijar cuánto poner en cada tipo? La app te avisa cuando te desvíes.{' '}
        <button onClick={edit} className="text-link hover:underline">
          Elegir objetivo
        </button>
      </p>
    );

  return (
    <section className="-mt-2 flex flex-col gap-1.5 rounded-xl bg-panel p-5 text-sm">
      {target.onTarget ? (
        <p>
          <span className="text-up">Estás dentro de tu objetivo.</span> No hace falta hacer nada.
          {warnings > 0 && <span className="text-muted"> Ojo: cumplirlo no alcanza si hay avisos en Para revisar.</span>}
        </p>
      ) : (
        <>
          <p>
            Te desviaste de tu objetivo: hoy los CEDEARs son el {share(target.current)} y querías {share(target.target)}.
          </p>
          {target.newMoney != null && (
            <p>
              Con plata nueva: poné tus próximos <b className="tabular">{money(target.newMoney, currency, false, true)}</b> solo en{' '}
              {KIND_LABEL[target.under!]}, sin vender nada.
            </p>
          )}
          <p className="text-muted">
            Sin plata nueva: vendé {money(target.move!, currency, false, true)} de {KIND_LABEL[target.over!]} y compralos en{' '}
            {KIND_LABEL[target.under!]} (pagás comisión dos veces).
          </p>
        </>
      )}
      <p className="mt-1 flex gap-4 text-xs">
        <button onClick={edit} className="text-link hover:underline">
          Cambiar objetivo
        </button>
        <button onClick={() => save.mutate(null)} className="text-muted hover:text-down">
          Quitar objetivo
        </button>
      </p>
    </section>
  );
}
