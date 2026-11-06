import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, ErrorBox, Modal, inputCls } from './ui';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AddAssetDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), 150);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () => api.search(query),
    enabled: query.length > 0,
    placeholderData: (prev) => prev,
  });
  const items = query ? (results.data ?? []) : [];

  const add = useMutation({
    mutationFn: api.addAsset,
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['portfolio'] });
      onClose();
      navigate(`/activo/${a.ticker}`);
    },
  });

  const choose = (ticker: string) => {
    if (!add.isPending) add.mutate(ticker);
  };

  // Si lo escrito no aparece en el catálogo, se puede agregar igual como ticker
  const typed = text.trim().toUpperCase();
  const canAddTyped = /^[A-Z0-9.]{1,10}$/.test(typed) && !items.some((i) => i.ticker === typed);

  return (
    <Modal title="Agregar activo" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const item = items[active];
          if (item && !item.owned) choose(item.ticker);
          else if (canAddTyped) choose(typed);
        }}
      >
        <input
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
          }}
          placeholder="Buscá por ticker o nombre: GGAL, Mercado, Apple…"
          className={inputCls}
          role="combobox"
          aria-expanded={items.length > 0}
        />

        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" role="listbox">
          {items.map((item, i) => (
            <li key={item.ticker}>
              <button
                type="button"
                disabled={item.owned || add.isPending}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item.ticker)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                  i === active ? 'bg-card' : 'hover:bg-card'
                }`}
              >
                <span className="w-16 font-semibold">{item.ticker}</span>
                <span className="flex-1 truncate">{item.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {item.owned ? 'Ya la tenés' : `${item.type === 'ACCION' ? 'Acción' : 'CEDEAR'}${item.sector ? ` · ${item.sector}` : ''}`}
                </span>
              </button>
            </li>
          ))}
          {canAddTyped && (
            <li>
              <button
                type="button"
                onClick={() => choose(typed)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-card hover:text-text"
              >
                Buscar <span className="font-semibold text-text">{typed}</span> directamente en BYMA
              </button>
            </li>
          )}
          {!query && <li className="px-3 py-2 text-xs text-muted">Más de 140 acciones argentinas y CEDEARs. Se traen hasta 10 años de precios.</li>}
        </ul>

        <ErrorBox error={add.error} />
        {add.isPending && <Button disabled>Buscando en BYMA…</Button>}
      </form>
    </Modal>
  );
}
