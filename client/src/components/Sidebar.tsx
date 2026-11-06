import { useState } from 'react';
import { NavLink } from 'react-router';
import { useSettings } from '../settings';
import { useAuth } from '../auth';
import { useAlerts } from '../hooks';
import type { Currency, FxKind } from '../api';

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

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Sidebar() {
  const { currency, setCurrency, fxKind, setFxKind } = useSettings();
  const { user, logout } = useAuth();
  const alerts = useAlerts();
  const [open, setOpen] = useState(false);
  const unseen = alerts.data?.filter((a) => a.triggered_at && !a.seen).length ?? 0;

  const links = [
    { to: '/', label: 'Mis inversiones', end: true },
    { to: '/composicion', label: 'Composición' },
    { to: '/benchmark', label: 'Benchmark' },
    { to: '/diario', label: 'Diario de decisiones' },
    { to: '/alertas', label: 'Alertas', badge: unseen },
    { to: '/importar', label: 'Importar operaciones' },
  ];

  return (
    <aside className="flex shrink-0 flex-col gap-6 bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-60 md:overflow-y-auto">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-bg px-3 py-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card text-xs font-semibold">{initials(user?.name ?? '')}</div>
          <span className="truncate text-sm font-medium">{user?.name}</span>
        </div>
        <button
          className="rounded-lg bg-bg px-3 py-2.5 text-sm text-muted md:hidden"
          onClick={() => setOpen((o) => !o)}
          aria-label="Menú"
        >
          ☰
        </button>
      </div>

      <div className={`${open ? 'flex' : 'hidden'} flex-col gap-6 md:flex md:flex-1`}>
        <nav className="flex flex-col gap-2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-lg bg-bg px-4 py-2.5 text-sm transition hover:bg-card ${
                  isActive ? 'ring-1 ring-line' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? 'text-text' : ''}>{l.label}</span>
                  {l.badge ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-down px-1.5 text-[10px] font-bold text-white">{l.badge}</span>
                  ) : (
                    isActive && <span className="h-2.5 w-2.5 rounded-full bg-muted" />
                  )}
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
          <button onClick={logout} className="mt-2 text-left text-xs text-muted hover:text-text">
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  );
}
