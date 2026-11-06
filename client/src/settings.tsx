import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Currency, FxKind } from './api';

interface Settings {
  currency: Currency;
  fxKind: FxKind;
  setCurrency: (c: Currency) => void;
  setFxKind: (k: FxKind) => void;
}

const SettingsContext = createContext<Settings | null>(null);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento: la preferencia dura hasta recargar
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setC] = useState<Currency>(() => read('currency', ['ARS', 'USD'], 'ARS'));
  const [fxKind, setK] = useState<FxKind>(() => read('fxKind', ['bolsa', 'contadoconliqui'], 'bolsa'));

  const value: Settings = {
    currency,
    fxKind,
    setCurrency: (c) => {
      setC(c);
      write('currency', c);
    },
    setFxKind: (k) => {
      setK(k);
      write('fxKind', k);
    },
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Settings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings fuera de SettingsProvider');
  return ctx;
}
