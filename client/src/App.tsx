import { Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { Sidebar } from './components/Sidebar';
import { AlertWatcher } from './components/AlertWatcher';
import { Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { PageErrorBoundary, lazyPage } from './lazyPage';

// La portada viene en el archivo principal; las demás pantallas se bajan al abrirlas
const AssetPage = lazyPage(() => import('./pages/AssetPage'), 'AssetPage');
const OperationPage = lazyPage(() => import('./pages/OperationPage'), 'OperationPage');
const CompositionPage = lazyPage(() => import('./pages/CompositionPage'), 'CompositionPage');
const BenchmarkPage = lazyPage(() => import('./pages/BenchmarkPage'), 'BenchmarkPage');
const JournalPage = lazyPage(() => import('./pages/JournalPage'), 'JournalPage');
const AlertsPage = lazyPage(() => import('./pages/AlertsPage'), 'AlertsPage');
const ImportPage = lazyPage(() => import('./pages/ImportPage'), 'ImportPage');
const SimulatorPage = lazyPage(() => import('./pages/SimulatorPage'), 'SimulatorPage');
const ReportPage = lazyPage(() => import('./pages/ReportPage'), 'ReportPage');
const BudgetPage = lazyPage(() => import('./pages/BudgetPage'), 'BudgetPage');

export function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loading />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <AlertWatcher />
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <PageErrorBoundary resetKey={pathname}>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<PortfolioPage />} />
                <Route path="/activo/:ticker" element={<AssetPage />} />
                <Route path="/operacion/:id" element={<OperationPage />} />
                <Route path="/composicion" element={<CompositionPage />} />
                <Route path="/benchmark" element={<BenchmarkPage />} />
                <Route path="/diario" element={<JournalPage />} />
                <Route path="/alertas" element={<AlertsPage />} />
                <Route path="/importar" element={<ImportPage />} />
                <Route path="/simulador" element={<SimulatorPage />} />
                <Route path="/informe" element={<ReportPage />} />
                <Route path="/sueldo-y-gastos" element={<BudgetPage />} />
                <Route path="*" element={<p className="text-muted">Página no encontrada.</p>} />
              </Routes>
            </Suspense>
          </PageErrorBoundary>
        </div>
      </main>
    </div>
  );
}
