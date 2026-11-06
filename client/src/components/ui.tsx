import { useEffect, type ReactNode } from 'react';

export function Triangle({ value, className = '' }: { value: number; className?: string }) {
  if (value === 0) return null;
  return (
    <span className={`inline-block text-[0.7em] ${value > 0 ? 'text-up' : 'text-down'} ${className}`} aria-hidden>
      {value > 0 ? '▲' : '▼'}
    </span>
  );
}

export function Button({
  children,
  variant = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const styles = {
    default: 'bg-card hover:bg-card-hover text-text',
    primary: 'bg-text text-bg hover:bg-white',
    danger: 'bg-down/15 text-down hover:bg-down/25',
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label="Cerrar">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none transition focus:border-muted';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return <p className="animate-pulse text-sm text-muted">{label}</p>;
}
