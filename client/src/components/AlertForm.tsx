import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { money, todayIso } from '../format';
import { Button, ErrorBox, Field, Modal, inputCls } from './ui';

export function AlertForm({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const [direction, setDirection] = useState<'ARRIBA' | 'ABAJO'>('ABAJO');
  const [price, setPrice] = useState('');
  const qc = useQueryClient();
  const last = useQuery({ queryKey: ['price', ticker, todayIso()], queryFn: () => api.priceAt(ticker, todayIso()) });
  const current = last.data?.close ?? 0;

  const save = useMutation({
    mutationFn: () => api.addAlert(ticker, direction, Number(price)),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      // Pide permiso para avisar con una notificación del navegador
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => {});
      }
      onClose();
    },
  });

  const p = Number(price) || 0;
  const diff = current > 0 && p > 0 ? p / current - 1 : null;

  return (
    <Modal title={`Alerta de precio · ${ticker}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">Precio actual: {current ? money(current, 'ARS') : '…'}</p>
        <div className="grid grid-cols-2 gap-2">
          {(['ABAJO', 'ARRIBA'] as const).map((d) => (
            <button
              type="button"
              key={d}
              onClick={() => setDirection(d)}
              className={`rounded-lg border px-3 py-2 text-sm transition ${direction === d ? 'border-text bg-card' : 'border-line text-muted'}`}
            >
              {d === 'ABAJO' ? '▼ Si baja de…' : '▲ Si sube de…'}
            </button>
          ))}
        </div>
        <Field label="Precio (ARS)" hint={diff != null ? `${(diff * 100).toFixed(1).replace('.', ',')}% respecto del precio actual` : undefined}>
          <input type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} autoFocus required />
        </Field>
        <ErrorBox error={save.error} />
        <Button type="submit" variant="primary" disabled={save.isPending || p <= 0}>
          Crear alerta
        </Button>
        <p className="text-xs text-muted">Te avisamos en la app y con una notificación del navegador mientras la tengas abierta.</p>
      </form>
    </Modal>
  );
}
