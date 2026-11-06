import { Route, Routes } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { PortfolioPage } from './pages/PortfolioPage';
import { AssetPage } from './pages/AssetPage';
import { OperationPage } from './pages/OperationPage';
import { CompositionPage } from './pages/CompositionPage';
import { BenchmarkPage } from './pages/BenchmarkPage';

export function App() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-6xl">
          <Routes>
            <Route path="/" element={<PortfolioPage />} />
            <Route path="/activo/:ticker" element={<AssetPage />} />
            <Route path="/operacion/:id" element={<OperationPage />} />
            <Route path="/composicion" element={<CompositionPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="*" element={<p className="text-muted">Página no encontrada.</p>} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
