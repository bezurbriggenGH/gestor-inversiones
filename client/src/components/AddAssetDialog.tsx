import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, ErrorBox, Field, Modal, inputCls } from './ui';

const SUGGESTIONS = ['GGAL', 'YPFD', 'PAMP', 'BMA', 'MELI', 'AAPL', 'KO', 'SPY'];

export function AddAssetDialog({ onClose }: { onClose: () => void }) {
  const [ticker, setTicker] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const add = useMutation({
    mutationFn: api.addAsset,
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      onClose();
      navigate(`/activo/${a.ticker}`);
    },
  });

  return (
    <Modal title="Agregar activo" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ticker.trim()) add.mutate(ticker.trim());
        }}
      >
        <Field label="Ticker en BYMA" hint="Acciones argentinas o CEDEARs. Se traen hasta 10 años de precios.">
          <input
            autoFocus
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            placeholder="Ej: GGAL, MELI"
            className={`${inputCls} uppercase`}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => setTicker(s)}
              className="rounded-md bg-card px-2.5 py-1 text-xs text-muted hover:text-text"
            >
              {s}
            </button>
          ))}
        </div>
        <ErrorBox error={add.error} />
        <Button type="submit" variant="primary" disabled={add.isPending || !ticker.trim()}>
          {add.isPending ? 'Buscando en BYMA…' : 'Agregar'}
        </Button>
      </form>
    </Modal>
  );
}
