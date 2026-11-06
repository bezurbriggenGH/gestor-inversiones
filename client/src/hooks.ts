import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSettings } from './settings';

export function usePortfolio() {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['portfolio', currency, fxKind],
    queryFn: () => api.portfolio(currency, fxKind),
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

export function useAsset(ticker: string) {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['asset', ticker, currency, fxKind],
    queryFn: () => api.asset(ticker, currency, fxKind),
    placeholderData: (prev) => (prev?.asset.ticker === ticker ? prev : undefined),
  });
}

export function useOperation(id: number) {
  const { currency, fxKind } = useSettings();
  return useQuery({
    queryKey: ['operation', id, currency, fxKind],
    queryFn: () => api.operation(id, currency, fxKind),
  });
}
