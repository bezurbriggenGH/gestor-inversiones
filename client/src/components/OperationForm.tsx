import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type OperationType } from '../api';
import { money, num, todayIso } from '../format';
import { Button, ErrorBox, Field, Modal, inputCls } from './ui';

export function OperationForm({
  ticker,
  type,
  holding,
  onClose,
}: {
  ticker: string;
  type: OperationType;
  holding: number;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [priceTouched, setPriceTouched] = useState(false);
  const [fees, setFees] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const qc = useQueryClient();

  // Sugiere el precio de cierre de la fecha elegida (se puede cambiar)
  const closeAt = useQuery({
    queryKey: ['price', ticker, date],
    queryFn: () => api.priceAt(ticker, date),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(date),
    retry: false,
  });
  useEffect(() => {
    if (closeAt.data && !priceTouched) setPrice(String(closeAt.data.close));
  }, [closeAt.data, priceTouched]);

  const save = useMutation({
    mutationFn: () =>
      api.addOperation(ticker, {
        type,
        date,
        quantity: Number(quantity),
        price: Number(price),
        fees: Number(fees || 0),
        note_title: title,
        note_body: body,
        note_link: link,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset', ticker] });
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      onClose();
    },
  });

  const q = Number(quantity) || 0;
  const p = Number(price) || 0;
  const f = Number(fees) || 0;
  const total = type === 'COMPRA' ? q * p + f : q * p - f;
  const isSell = type === 'VENTA';
  const tooMany = isSell && q > holding;

  return (
    <Modal title={`Registrar ${isSell ? 'venta' : 'compra'} de ${ticker}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fecha">
            <input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} required />
          </Field>
          <Field label="Cantidad" hint={isSell ? `Tenés ${num(holding)}` : undefined}>
            <input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={inputCls}
              required
              autoFocus
            />
          </Field>
          <Field
            label="Precio unitario (ARS)"
            hint={closeAt.data ? `Cierre del ${closeAt.data.date.split('-').reverse().join('/')}: ${money(closeAt.data.close, 'ARS')}` : undefined}
          >
            <input
              type="number"
              min="0"
              step="any"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceTouched(true);
              }}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Comisiones (ARS)" hint="Opcional. Suman al costo o restan a lo cobrado.">
            <input type="number" min="0" step="any" value={fees} onChange={(e) => setFees(e.target.value)} className={inputCls} placeholder="0" />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-bg px-4 py-3 text-sm">
          <span className="text-muted">{isSell ? 'Total a cobrar' : 'Total a pagar'}</span>
          <span className="tabular font-semibold">{money(total, 'ARS')}</span>
        </div>
        {tooMany && <p className="text-xs text-down">No podés vender más de lo que tenés.</p>}

        <details className="rounded-lg border border-line p-3" open>
          <summary className="cursor-pointer text-sm text-muted">Justificación (opcional)</summary>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Título">
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Ej: Despidos masivos" />
            </Field>
            <Field label="¿Por qué tomaste esta decisión?">
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={inputCls} />
            </Field>
            <Field label="Link de referencia">
              <input type="url" value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} placeholder="https://…" />
            </Field>
          </div>
        </details>

        <ErrorBox error={save.error} />
        <Button type="submit" variant="primary" disabled={save.isPending || tooMany || q <= 0 || p <= 0}>
          {save.isPending ? 'Guardando…' : `Registrar ${isSell ? 'venta' : 'compra'}`}
        </Button>
      </form>
    </Modal>
  );
}
