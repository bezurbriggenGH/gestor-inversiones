import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAlerts, usePortfolio } from '../hooks';
import { money, pct, tone } from '../format';
import { Button, ErrorBox, Field, Loading, inputCls } from '../components/ui';
import { AlertForm } from '../components/AlertForm';

export function AlertsPage() {
  const { data, isLoading, error } = useAlerts();
  const portfolio = usePortfolio();
  const qc = useQueryClient();
  const [ticker, setTicker] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [permission, setPermission] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const remove = useMutation({
    mutationFn: api.deleteAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  // Al entrar, las alertas disparadas pasan a "vistas"
  const unseen = data?.some((a) => a.triggered_at && !a.seen);
  useEffect(() => {
    if (unseen) api.markAlertsSeen().then(() => qc.invalidateQueries({ queryKey: ['alerts'] }));
  }, [unseen, qc]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const triggered = data.filter((a) => a.triggered_at);
  const active = data.filter((a) => !a.triggered_at);
  const tickers = portfolio.data?.positions.map((p) => p.ticker) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Alertas de precio</h1>
        <p className="mt-1 text-sm text-muted">Te avisamos cuando un activo cruza el precio que elegiste. Los precios se revisan mientras la app está prendida: con el mercado abierto
          (lunes a viernes de 11 a 17), como mucho cada 15 minutos.</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3 rounded-xl bg-panel p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ticker) setCreating(ticker);
        }}
      >
        <Field label="Activo">
          <select value={ticker} onChange={(e) => setTicker(e.target.value)} className={`${inputCls} min-w-40`} required>
            <option value="">Elegí uno…</option>
            {tickers.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={!ticker}>
          Nueva alerta
        </Button>
        {permission === 'default' && (
          <button
            type="button"
            className="ml-auto text-xs text-link hover:underline"
            onClick={() => Notification.requestPermission().then(setPermission)}
          >
            Activar notificaciones del navegador
          </button>
        )}
        {permission === 'denied' && <span className="ml-auto text-xs text-muted">Notificaciones del navegador bloqueadas</span>}
      </form>

      <ErrorBox error={remove.error} />

      {[
        { title: 'Disparadas', list: triggered },
        { title: 'Activas', list: active },
      ].map(({ title, list }) => (
        <section key={title} className="flex flex-col gap-2">
          <h2 className="text-sm text-muted">
            {title} ({list.length})
          </h2>
          {list.length === 0 && <p className="text-sm text-muted">Ninguna.</p>}
          {list.map((a) => {
            const distance = a.current ? a.price / a.current - 1 : null;
            return (
              <div
                key={a.id}
                className={`tabular flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-4 py-3 text-sm ${
                  a.triggered_at && !a.seen ? 'bg-[#b8964f]/10 ring-1 ring-[#b8964f]/40' : 'bg-panel'
                }`}
              >
                <Link to={`/activo/${a.ticker}`} className="w-16 font-semibold hover:underline">
                  {a.ticker}
                </Link>
                <span>
                  {a.direction === 'ARRIBA' ? '▲ sube de' : '▼ baja de'} {money(a.price, 'ARS')}
                </span>
                {a.triggered_at ? (
                  <span className="text-muted">
                    se disparó el {a.triggered_at.slice(0, 10).split('-').reverse().join('/')} a {money(a.trigger_price ?? 0, 'ARS')}
                  </span>
                ) : (
                  a.current != null && (
                    <span className="text-muted">
                      hoy {money(a.current, 'ARS')} · falta <span className={tone(distance ?? 0)}>{distance != null ? pct(distance) : ''}</span>
                    </span>
                  )
                )}
                <button onClick={() => remove.mutate(a.id)} className="ml-auto text-xs text-muted hover:text-down">
                  Borrar
                </button>
              </div>
            );
          })}
        </section>
      ))}

      {creating && <AlertForm ticker={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}
