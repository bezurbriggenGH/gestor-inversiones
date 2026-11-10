import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../api';
import { Button, ErrorBox, Field, Modal, inputCls } from './ui';

/** Cambiar la contraseña: pide la actual (para confirmar que sos vos) y la nueva dos veces. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const change = useMutation({ mutationFn: () => api.changePassword(current, next) });

  if (change.isSuccess) {
    return (
      <Modal title="Contraseña cambiada" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Listo, la próxima vez entrá con tu contraseña nueva. Por seguridad se cerraron las sesiones abiertas en otras
            compus o celulares.
          </p>
          <Button variant="primary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Cambiar contraseña" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMismatch(next !== repeat);
          if (next === repeat) change.mutate();
        }}
      >
        <Field label="Contraseña actual">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputCls}
            autoComplete="current-password"
            autoFocus
            required
          />
        </Field>
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres">
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputCls}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field label="Repetí la contraseña nueva">
          <input
            type="password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className={inputCls}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <ErrorBox error={mismatch ? new Error('Las contraseñas nuevas no coinciden') : change.error} />
        <Button type="submit" variant="primary" disabled={change.isPending}>
          {change.isPending ? 'Un momento…' : 'Cambiar contraseña'}
        </Button>
      </form>
    </Modal>
  );
}
