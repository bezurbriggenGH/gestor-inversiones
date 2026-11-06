import { NavLink } from 'react-router';
import { useSettings } from '../settings';
import type { Currency, FxKind } from '../api';

const links = [
  { to: '/', label: 'Mis inversiones', end: true },
  { to: '/composicion', label: 'Composición', end: false },
  { to: '/benchmark', label: 'Benchmark', end: false },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-flow-col gap-1 rounded-lg bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === o.value ? 'bg-card text-text' : 'text-muted hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Sidebar() {
  const { currency, setCurrency, fxKind, setFxKind } = useSettings();

  return (
    <aside className="flex shrink-0 flex-col gap-6 bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-60">
      <div className="flex items-center gap-3 rounded-lg bg-bg px-3 py-2.5">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-card text-xs font-semibold">BZ</div>
        <span className="text-sm font-medium">Benjamin Zurbriggen</span>
      </div>

      <nav className="flex flex-col gap-2">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-sm transition hover:bg-card ${
                isActive ? 'ring-1 ring-line' : 'text-muted'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={isActive ? 'text-text' : ''}>{l.label}</span>
                {isActive && <span className="h-2.5 w-2.5 rounded-full bg-muted" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-3 md:mt-auto">
        <div>
          <p className="mb-1.5 text-xs text-muted">Moneda</p>
          <Segmented<Currency>
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'ARS', label: 'Pesos' },
              { value: 'USD', label: 'Dólares' },
            ]}
          />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted">Dólar para convertir</p>
          <Segmented<FxKind>
            value={fxKind}
            onChange={setFxKind}
            options={[
              { value: 'bolsa', label: 'MEP' },
              { value: 'contadoconliqui', label: 'CCL' },
            ]}
          />
        </div>
      </div>
    </aside>
  );
}
