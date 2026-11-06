import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthError } from './api';
import { AuthProvider } from './auth';
import { SettingsProvider } from './settings';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (count, err) => !(err instanceof AuthError) && count < 1,
    },
  },
});

// Si la sesión vence mientras se usa la app, se vuelve a la pantalla de login
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.query.state.error instanceof AuthError && event.query.queryKey[0] !== 'me') {
    queryClient.setQueryData(['me'], null);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// App instalable (PWA): solo en producción, para no interferir con la recarga de Vite
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
