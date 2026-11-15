// Cada pantalla se baja recién cuando se abre: así la app arranca bajando solo el login y la portada,
// y no un único archivo con todas las pantallas juntas.
import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOADED_KEY = 'pantalla-recargada';

function storage(action: 'get' | 'set' | 'remove'): string | null {
  // En modo incógnito o con el almacenamiento bloqueado, sessionStorage puede fallar
  try {
    if (action === 'get') return sessionStorage.getItem(RELOADED_KEY);
    if (action === 'set') sessionStorage.setItem(RELOADED_KEY, '1');
    else sessionStorage.removeItem(RELOADED_KEY);
  } catch {
    // sin almacenamiento: no se recarga sola, se muestra el aviso de abajo
  }
  return null;
}

/**
 * `lazyPage(() => import('./pages/JournalPage'), 'JournalPage')`.
 * Si la app se recompiló mientras estaba abierta, el archivo viejo de esa pantalla ya no existe:
 * se recarga la página una vez para traer la versión nueva. Si vuelve a fallar (sin conexión),
 * se muestra el aviso de PageErrorBoundary en vez de una pantalla en blanco.
 */
export function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try {
      const module = await load();
      storage('remove');
      return { default: module[name] };
    } catch (err) {
      if (storage('get') == null) {
        storage('set');
        window.location.reload();
        return new Promise<never>(() => {}); // la página se está recargando
      }
      throw err;
    }
  });
}

/** Si una pantalla no se pudo bajar, lo dice en vez de dejar todo en blanco. */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Al ir a otra pantalla se vuelve a intentar
  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl bg-panel p-5 text-sm">
        <p>No se pudo abrir esta pantalla. Revisá la conexión con la computadora donde corre la app.</p>
        <button onClick={() => window.location.reload()} className="rounded-sm bg-card px-3 py-1.5 text-xs hover:bg-card-hover">
          Volver a intentar
        </button>
      </div>
    );
  }
}
