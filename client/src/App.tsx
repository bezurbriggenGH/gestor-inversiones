import { Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { Sidebar } from './components/Sidebar';
import { AlertWatcher } from './components/AlertWatcher';
import { Loading } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { AssetPage } from './pages/AssetPage';
import { OperationPage } from './pages/OperationPage';
import { CompositionPage } from './pages/CompositionPage';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { JournalPage } from './pages/JournalPage';
import { AlertsPage } from './pages/AlertsPage';
import { ImportPage } from './pages/ImportPage';

export function App() {
  const { user, loading } = useAuth();

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
          <Routes>
            <Route path="/" element={<PortfolioPage />} />
            <Route path="/activo/:ticker" element={<AssetPage />} />
            <Route path="/operacion/:id" element={<OperationPage />} />
            <Route path="/composicion" element={<CompositionPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/diario" element={<JournalPage />} />
            <Route path="/alertas" element={<AlertsPage />} />
            <Route path="/importar" element={<ImportPage />} />
            <Route path="*" element={<p className="text-muted">Página no encontrada.</p>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
