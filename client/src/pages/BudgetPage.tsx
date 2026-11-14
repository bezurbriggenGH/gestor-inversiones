// Sueldo y gastos: apartado opcional. Cada mes se cargan unos pocos montos fijos y se ve si el sueldo
// sigue a la inflación y qué gasto sube más rápido. Un solo gráfico y una línea de resumen.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Budget, type BudgetComparison, type BudgetKind } from '../api';
import { money, pct } from '../format';
import { Button, ErrorBox, Loading, inputCls } from '../components/ui';

const MONTHS_SHOWN = 6;
const INCOME_COLOR = '#4f9d69';
const INFLATION_COLOR = '#8a8a8f';
const EXPENSE_COLORS = ['#c25450', '#7c6bb0', '#5a9bb0', '#b8964f', '#d08770', '#9a7fb8', '#6fa3a0'];
const SUGGESTIONS: [string, BudgetKind][] = [
  ['Sueldo', 'INGRESO'],
  ['Alquiler', 'GASTO'],
  ['Seguro del auto', 'GASTO'],
  ['Servicios', 'GASTO'],
  ['Prepaga', 'GASTO'],
];

const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const monthFmt = new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const longMonthFmt = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthLabel = (m: string) => monthFmt.format(new Date(`${m}-01T00:00:00Z`)).replace('.', '');
const longMonth = (m: string) => longMonthFmt.format(new Date(`${m}-01T00:00:00Z`));

/** "1.500.000" o "1500000,50" → número. Vacío → null. NaN si no se entiende. */
function parseAmount(text: string): number | null {
  const t = text.trim().replace(/\$/g, '').replace(/\s/g, '');
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(',', '.'));
}

const plain = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

export function BudgetPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['budget'], queryFn: api.budget });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Sueldo y gastos</h1>
        <p className="mt-1 text-sm text-muted">
          Opcional. Cargá cada mes tu sueldo y tus gastos fijos (alquiler, seguro, servicios…) para ver si tu sueldo sigue a la inflación
          y qué gasto sube más rápido. Todo en pesos.
        </p>
      </div>
      {data.items.length > 0 && <Summary data={data} />}
      <Chart data={data} />
      <Grid data={data} />
    </div>
  );
}

/** La línea de resumen: el sueldo contra la inflación y el gasto que más subió. */
function Summary({ data }: { data: Budget }) {
  const { income, expenses } = data.analysis;
  const incomeItems = data.items.filter((i) => i.kind === 'INGRESO');
  const incomeName = incomeItems.length === 1 ? `tu ${incomeItems[0].name.toLowerCase()}` : 'tus ingresos';
  const c = income.comparison;
  const top = expenses.filter((e) => e.comparison).sort((a, b) => b.comparison!.change - a.comparison!.change)[0];

  if (!c && !top)
    return (
      <p className="rounded-xl bg-panel px-5 py-3 text-sm text-muted">
        Con dos meses cargados (y la inflación de esos meses publicada) vas a ver acá si {incomeName} sigue a la inflación.
      </p>
    );

  return (
    <section className="flex flex-col gap-1.5 rounded-xl bg-panel p-5 text-sm leading-relaxed">
      {c && (
        <p>
          De {longMonth(c.from)} a {longMonth(c.to)}, {incomeName} subió <b className="tabular">{pct(c.change, 1)}</b> y la inflación{' '}
          <b className="tabular">{pct(c.inflation, 1)}</b>:{' '}
          {Math.abs(c.real) < 0.005 ? (
            'mantuviste tu poder de compra.'
          ) : c.real > 0 ? (
            <span className="text-up">ganaste {pct(c.real, 1).replace('+', '')} de poder de compra.</span>
          ) : (
            <span className="text-down">perdiste {pct(c.real, 1).replace('-', '')} de poder de compra.</span>
          )}
        </p>
      )}
      {top && (
        <p className="text-muted">
          Lo que más subió fue {top.name}: {pct(top.comparison!.change, 1)}, con una inflación de {pct(top.comparison!.inflation, 1)} en el mismo
          período.
        </p>
      )}
    </section>
  );
}

const compText = (c: BudgetComparison | null) =>
  c ? `${pct(c.change, 1)} (inflación ${pct(c.inflation, 1)})` : 'falta otro mes para comparar';

/** Un solo gráfico: todo arranca en 100 para ver quién subió más. */
function Chart({ data }: { data: Budget }) {
  const { income, expenses, inflation, lastInflationMonth } = data.analysis;
  const lines = [
    { key: 'ingresos', label: 'Ingresos', color: INCOME_COLOR, points: income.index, comparison: income.comparison, dashed: false },
    ...expenses.map((e, i) => ({
      key: `g${e.id}`,
      label: e.name,
      color: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
      points: e.index,
      comparison: e.comparison,
      dashed: false,
    })),
  ].filter((l) => l.points.length > 0);
  const months = [...new Set([...lines.flatMap((l) => l.points), ...inflation].map((p) => p.month))].sort();
  if (months.length < 2) return null;

  const rows = months.map((month) => {
    const row: Record<string, number | string> = { month };
    for (const l of lines) {
      const p = l.points.find((x) => x.month === month);
      if (p) row[l.key] = p.value;
    }
    const inf = inflation.find((x) => x.month === month);
    if (inf) row.inflacion = inf.value;
    return row;
  });

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-panel p-5">
      <div>
        <h2 className="font-medium">¿Quién subió más?</h2>
        <p className="text-xs text-muted">
          Cada línea arranca en 100 en su primer mes cargado: 150 quiere decir que subió 50%. La inflación es la oficial del INDEC
          {lastInflationMonth ? `, publicada hasta ${longMonth(lastInflationMonth)}` : ''}.
        </p>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#2a2b2e" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} stroke="#8a8a8f" fontSize={12} tickLine={false} />
            <YAxis stroke="#8a8a8f" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: '#1b1c1e', border: '1px solid #2a2b2e', borderRadius: 4, fontSize: 12 }}
              labelFormatter={(m) => longMonth(String(m))}
              formatter={(v, name) => [plain.format(Number(v)), name]}
            />
            <Line
              dataKey="inflacion"
              name="Inflación"
              stroke={INFLATION_COLOR}
              strokeDasharray="5 4"
              dot={false}
              strokeWidth={2}
              connectNulls
              isAnimationActive={false}
            />
            {lines.map((l) => (
              <Line
                key={l.key}
                dataKey={l.key}
                name={l.label}
                stroke={l.color}
                dot={{ r: 2 }}
                strokeWidth={2}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {lines.map((l) => (
          <li key={l.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: l.color }} />
            <span className="flex-1">{l.label}</span>
            <span className="tabular text-muted">{compText(l.comparison)}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="h-0.5 w-2 shrink-0" style={{ background: INFLATION_COLOR }} />
          <span className="flex-1 text-muted">Inflación</span>
        </li>
      </ul>
    </section>
  );
}

/** La carga: una fila por concepto, una columna por mes. */
function Grid({ data }: { data: Budget }) {
  const qc = useQueryClient();
  const current = thisMonth();
  const [end, setEnd] = useState(current);
  const months = Array.from({ length: MONTHS_SHOWN }, (_, i) => shiftMonth(end, i - MONTHS_SHOWN + 1));
  const amountOf = new Map(data.amounts.map((a) => [`${a.item_id}|${a.month}`, a.amount]));
  const hasAny = (m: string) => data.amounts.some((a) => a.month === m);
  const leftover = new Map(data.analysis.leftover.map((l) => [l.month, l.amount]));
  const refresh = () => qc.invalidateQueries({ queryKey: ['budget'] });

  const copy = useMutation({ mutationFn: api.copyBudgetMonth, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteBudgetItem, onSuccess: refresh });

  const groups: [BudgetKind, string][] = [
    ['INGRESO', 'Ingresos'],
    ['GASTO', 'Gastos fijos'],
  ];

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Cargar montos</h2>
        <div className="flex gap-3 text-xs">
          <button onClick={() => setEnd(shiftMonth(end, -MONTHS_SHOWN))} className="text-link hover:underline">
            ← Meses anteriores
          </button>
          {end < current && (
            <button onClick={() => setEnd(shiftMonth(end, MONTHS_SHOWN))} className="text-link hover:underline">
              Siguientes →
            </button>
          )}
        </div>
      </div>

      {data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="w-40 py-1 text-left font-normal">Concepto</th>
                {months.map((m) => (
                  <th key={m} className="px-1 py-1 text-right font-normal">
                    <div>{monthLabel(m)}</div>
                    {m <= current && !hasAny(m) && hasAny(shiftMonth(m, -1)) && (
                      <button
                        onClick={() => copy.mutate(m)}
                        disabled={copy.isPending}
                        className="text-[11px] text-link hover:underline"
                        title="Completa este mes con los montos del mes anterior (después podés cambiar los que subieron)"
                      >
                        repetir anterior
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([kind, label]) => {
                const items = data.items.filter((i) => i.kind === kind);
                if (items.length === 0) return null;
                return [
                  <tr key={kind}>
                    <td colSpan={months.length + 1} className="pt-3 pb-1 text-xs text-muted">
                      {label}
                    </td>
                  </tr>,
                  ...items.map((item) => (
                    <tr key={item.id} className="group">
                      <td className="py-0.5 pr-2">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{item.name}</span>
                          <button
                            onClick={() => confirm(`¿Borrar "${item.name}" y todos sus montos?`) && remove.mutate(item.id)}
                            className="text-xs text-muted opacity-0 transition group-hover:opacity-100 hover:text-down"
                            aria-label={`Borrar ${item.name}`}
                          >
                            ×
                          </button>
                        </span>
                      </td>
                      {months.map((m) => (
                        <td key={m} className="px-1 py-0.5">
                          <AmountCell itemId={item.id} month={m} value={amountOf.get(`${item.id}|${m}`)} disabled={m > current} onSaved={refresh} />
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
              {data.analysis.leftover.length > 0 && (
                <tr className="border-t border-line">
                  <td className="pt-2 text-xs text-muted">Te queda</td>
                  {months.map((m) => {
                    const v = leftover.get(m);
                    return (
                      <td key={m} className={`px-2 pt-2 text-right text-xs ${v == null ? 'text-muted' : v >= 0 ? 'text-up' : 'text-down'}`}>
                        {v == null ? '—' : money(v, 'ARS', false, true)}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ErrorBox error={copy.error ?? remove.error} />
      <AddItem existing={data.items.map((i) => i.name.toLowerCase())} onAdded={refresh} />
      <p className="text-xs text-muted">
        Cargá solo lo que se repite todos los meses. El aguinaldo o un bono distorsionan la comparación: mejor dejarlos afuera.
      </p>
    </section>
  );
}

/** Una celda: se guarda al salir del campo. Vaciarla borra el monto de ese mes. */
function AmountCell({ itemId, month, value, disabled, onSaved }: { itemId: number; month: string; value?: number; disabled: boolean; onSaved: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (amount: number | null) => api.setBudgetAmount(itemId, month, amount),
    onSuccess: async () => {
      await onSaved();
      setText(null);
    },
  });
  const shown = text ?? (value != null ? plain.format(value) : '');

  const commit = () => {
    if (text === null) return;
    const amount = parseAmount(text);
    if (amount === (value ?? null)) return setText(null);
    if (amount !== null && !(amount > 0)) return; // queda marcado en rojo hasta que se corrija
    save.mutate(amount);
  };
  const invalid = text !== null && parseAmount(text) !== null && !(parseAmount(text)! > 0);

  return (
    <input
      value={shown}
      disabled={disabled || save.isPending}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      inputMode="decimal"
      placeholder={disabled ? '' : '—'}
      title={save.error ? save.error.message : invalid ? 'Escribí un monto mayor a cero' : undefined}
      className={`w-full rounded-md border bg-bg px-2 py-1 text-right text-sm outline-none transition focus:border-muted disabled:opacity-40 ${
        invalid || save.error ? 'border-down' : 'border-line'
      }`}
    />
  );
}

function AddItem({ existing, onAdded }: { existing: string[]; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BudgetKind>('GASTO');
  const add = useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: BudgetKind }) => api.addBudgetItem(name, kind),
    onSuccess: () => {
      setName('');
      onAdded();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate({ name, kind });
  };
  const suggestions = SUGGESTIONS.filter(([n]) => !existing.includes(n.toLowerCase()));

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo concepto, por ejemplo Expensas" maxLength={40} className={`${inputCls} max-w-64`} />
        <select value={kind} onChange={(e) => setKind(e.target.value as BudgetKind)} className={`${inputCls} w-auto`}>
          <option value="GASTO">Gasto</option>
          <option value="INGRESO">Ingreso</option>
        </select>
        <Button type="submit" disabled={add.isPending || !name.trim()}>
          Agregar
        </Button>
      </form>
      {suggestions.length > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Rápido:
          {suggestions.map(([n, k]) => (
            <button key={n} onClick={() => add.mutate({ name: n, kind: k })} className="rounded-md bg-card px-2 py-1 text-text hover:bg-card-hover">
              + {n}
            </button>
          ))}
        </p>
      )}
      <ErrorBox error={add.error} />
    </div>
  );
}
