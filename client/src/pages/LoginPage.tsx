import { useState } from 'react';
import { useAuth } from '../auth';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const isRegister = mode === 'register';
  const mutation = isRegister ? register : login;

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent/20 text-xl text-accent">▲</div>
          <h1 className="text-2xl font-semibold">Gestor de inversiones</h1>
          <p className="mt-1 text-sm text-muted">Acciones argentinas y CEDEARs, en pesos y en dólares</p>
        </div>

        <form
          className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (isRegister) register.mutate({ name, email, password });
            else login.mutate({ email, password });
          }}
        >
          {isRegister && (
            <Field label="Nombre">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="name" required />
            </Field>
          )}
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} autoComplete="email" required />
          </Field>
          <Field label="Contraseña" hint={isRegister ? 'Mínimo 8 caracteres' : undefined}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              minLength={isRegister ? 8 : undefined}
              required
            />
          </Field>
          <ErrorBox error={mutation.error} />
          <Button type="submit" variant="primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Un momento…' : isRegister ? 'Crear cuenta' : 'Ingresar'}
          </Button>
        </form>

        {!isRegister && (
          <details className="mt-4 rounded-lg border border-line bg-panel px-4 py-3 text-sm">
            <summary className="cursor-pointer text-muted hover:text-text">¿Te olvidaste la contraseña?</summary>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <p>
                La app corre en tu compu y no manda emails, así que la contraseña se cambia desde la terminal, en la carpeta
                del proyecto:
              </p>
              <code className="rounded bg-bg px-3 py-2 text-text">npm run reset-password</code>
              <p>Te muestra tus cuentas, elegís una contraseña nueva y listo. (En PowerShell, si npm da error, usá npm.cmd.)</p>
            </div>
          </details>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          {isRegister ? '¿Ya tenés cuenta?' : '¿No tenés cuenta?'}{' '}
          <button
            className="text-text underline-offset-4 hover:underline"
            onClick={() => {
              setMode(isRegister ? 'login' : 'register');
              login.reset();
              register.reset();
            }}
          >
            {isRegister ? 'Ingresá' : 'Creá una'}
          </button>
        </p>
      </div>
    </div>
  );
}
