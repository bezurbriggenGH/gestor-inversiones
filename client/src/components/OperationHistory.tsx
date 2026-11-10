import { useState } from 'react';
import { Link } from 'react-router';
import type { Currency, Operation, OperationType } from '../api';
import { date, money, num, pct, tone } from '../format';

const DOT: Record<OperationType, string> = { COMPRA: 'bg-up', VENTA: 'bg-down', DIVIDENDO: 'bg-link' };
const LABEL: Record<OperationType, string> = { COMPRA: 'Compra', VENTA: 'Venta', DIVIDENDO: 'Dividendo' };
const FILTERS: { key: OperationType | 'TODAS'; label: string }[] = [
  { key: 'TODAS', label: 'Todas' },
  { key: 'COMPRA', label: 'Compras' },
  { key: 'VENTA', label: 'Ventas' },
  { key: 'DIVIDENDO', label: 'Dividendos' },
];

// Mismas columnas para el encabezado y las filas (en celular cada fila se arma en dos renglones)
const COLS = 'sm:grid-cols-[7rem_5.75rem_4.5rem_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]';

/** Lo que ganaste o perdiste con la operación: en ventas, contra lo que habían costado; en dividendos, lo cobrado. */
function Result({ op, currency }: { op: Operation; currency: Currency }) {
  if (op.type === 'VENTA' && op.realized != null) {
    return (
      <span className={tone(op.realized)}>
        {money(op.realized, currency, true)}
        {op.realizedPct != null && <span className="ml-1 text-xs">({pct(op.realizedPct)})</span>}
      </span>
    );
  }
  if (op.type === 'DIVIDENDO') return <span className="text-link">{money(op.totalConv, currency, true)}</span>;
  return <span className="text-muted">—</span>;
}

/** Historial de compras, ventas y dividendos de un activo, agrupado por año. */
export function OperationHistory({ operations, currency }: { operations: Operation[]; currency: Currency }) {
  const [filter, setFilter] = useState<OperationType | 'TODAS'>('TODAS');
  const shown = filter === 'TODAS' ? operations : operations.filter((o) => o.type === filter);
  const count = (key: OperationType | 'TODAS') => (key === 'TODAS' ? operations.length : operations.filter((o) => o.type === key).length);

  // Las operaciones ya vienen de la más nueva a la más vieja
  const years = [...new Set(shown.map((o) => o.date.slice(0, 4)))];

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-panel p-5">
      <h2 className="mb-1 rounded-md bg-card py-1.5 text-center text-sm">Historial</h2>

      {operations.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">Todavía no registraste operaciones.</p>
      ) : (
        <>
          <div className="mb-1 flex flex-wrap gap-1">
            {FILTERS.filter((f) => count(f.key) > 0).map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-3 py-1 text-xs transition ${filter === f.key ? 'bg-card text-text' : 'text-muted hover:text-text'}`}
              >
                {f.label} <span className="text-muted">{count(f.key)}</span>
              </button>
            ))}
          </div>

          <div className={`hidden gap-x-4 px-4 text-xs text-muted sm:grid ${COLS}`}>
            <span>Operación</span>
            <span>Fecha</span>
            <span className="text-right">Cantidad</span>
            <span className="text-right">Precio</span>
            <span className="text-right">Total</span>
            <span className="text-right">Resultado</span>
          </div>

          {years.map((year) => {
            const ops = shown.filter((o) => o.date.startsWith(year));
            // Resultado del año: ventas + dividendos (lo que ya se cobró)
            const yearResult = ops.reduce((s, o) => s + (o.type === 'VENTA' ? (o.realized ?? 0) : o.type === 'DIVIDENDO' ? o.totalConv : 0), 0);
            const hasResult = ops.some((o) => o.type !== 'COMPRA');
            return (
              <div key={year} className="flex flex-col gap-2">
                <div className="mt-2 flex items-baseline justify-between px-1 text-sm">
                  <span className="font-medium">{year}</span>
                  {hasResult && (
                    <span className="text-xs text-muted" title="Resultado de las ventas y dividendos cobrados ese año">
                      ventas y dividendos: <span className={`tabular ${tone(yearResult)}`}>{money(yearResult, currency, true)}</span>
                    </span>
                  )}
                </div>
                {ops.map((op) => (
                  <Link
                    key={op.id}
                    to={`/operacion/${op.id}`}
                    className={`tabular grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg bg-card px-4 py-2.5 text-sm transition hover:bg-card-hover ${COLS}`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[op.type]}`} />
                      <span>{LABEL[op.type]}</span>
                      {(op.note_title || op.note_body) && (
                        <span className="text-xs text-muted" title={op.note_title ?? 'Tiene una justificación'}>
                          ✎
                        </span>
                      )}
                    </span>
                    <span className="hidden text-muted sm:block">{date(op.date)}</span>
                    {/* En celular: arriba el tipo y el resultado; abajo, a todo lo ancho, fecha y cantidad × precio = total */}
                    <span className="order-last col-span-2 text-xs text-muted sm:hidden">
                      {date(op.date)} · {num(op.quantity)} × {money(op.priceConv, currency)} = {money(op.totalConv, currency)}
                    </span>
                    <span className="hidden text-right sm:block">{num(op.quantity)}</span>
                    <span className="hidden truncate text-right sm:block">{money(op.priceConv, currency)}</span>
                    <span className="hidden truncate text-right sm:block">{money(op.totalConv, currency)}</span>
                    <span className="truncate text-right">
                      <Result op={op} currency={currency} />
                    </span>
                  </Link>
                ))}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
