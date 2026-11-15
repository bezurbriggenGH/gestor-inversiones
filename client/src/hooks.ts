import { useQuery } from '@tanstack/react-query';
import { api, type Currency } from './api';
import { useSettings } from './settings';

/**
 * Mientras llega la respuesta nueva, se siguen mostrando los datos anteriores (así la pantalla no parpadea),
 * pero solo si están en la misma moneda y con el mismo dólar. Al pasar de pesos a dólares, mostrar los
 * datos viejos con el formato nuevo decía "US$ 8.957.022" por un instante: los pesos con el signo del dólar.
 */
export function sameView(currency: Currency, fxKind: string) {
  return <T,>(prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }) =>
    prevQuery && prevQuery.queryKey.includes(currency) && prevQuery.queryKey.includes(fxKind) ? prev : undefined;
}

export function usePortfolio() {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['portfolio', currency, fxKind],
    queryFn: () => api.portfolio(currency, fxKind),
    // Si el servidor no llegó a traer los precios nuevos, se vuelve a preguntar a los pocos segundos
    refetchInterval: (query) => (query.state.data?.updating ? 3_000 : 5 * 60_000),
    placeholderData: sameView(currency, fxKind),
  });
}

export function useHistory() {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['history', currency, fxKind],
    queryFn: () => api.history(currency, fxKind),
    placeholderData: sameView(currency, fxKind),
  });
}

export function useJournal() {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['journal', currency, fxKind],
    queryFn: () => api.journal(currency, fxKind),
    placeholderData: sameView(currency, fxKind),
  });
}

export function useHold(since: string) {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['hold', since, currency, fxKind],
    queryFn: () => api.hold(since, currency, fxKind),
    placeholderData: sameView(currency, fxKind),
  });
}

export function useCosts() {
  const { currency, fxKind } = useSettings();
  return useQuery({ queryKey: ['costs', currency, fxKind], queryFn: () => api.costs(currency, fxKind), placeholderData: sameView(currency, fxKind) });
}

export function useAsset(ticker: string) {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['asset', ticker, currency, fxKind],
    queryFn: () => api.asset(ticker, currency, fxKind),
    placeholderData: (prev, prevQuery) => (prev?.asset.ticker === ticker ? sameView(currency, fxKind)(prev, prevQuery) : undefined),
  });
}

export function useOperation(id: number) {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['operation', id, currency, fxKind],
    queryFn: () => api.operation(id, currency, fxKind),
  });
}

export function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 5 * 60_000 });
}

/** Claves que dependen de las operaciones: se recargan después de cualquier cambio. */
export const DATA_KEYS = [['portfolio'], ['asset'], ['history'], ['journal'], ['operation'], ['alerts'], ['hold'], ['costs']];
