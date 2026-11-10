// Recuperar la contraseña desde la terminal: npm run reset-password
//
// La app corre en tu compu y no manda emails, así que la forma de recuperar una
// cuenta es esta. Es seguro porque quien puede abrir la terminal de esta compu
// ya tiene acceso al archivo de la base de datos.
import { createInterface } from 'node:readline';
import { all } from './db.ts';
import { resetPassword } from './auth.ts';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });

// Para la contraseña: mientras `muted` esté activo, no se muestra lo que se tipea
let muted = false;
const internal = rl as unknown as { _writeToOutput: (s: string) => void };
const write = internal._writeToOutput.bind(rl);
internal._writeToOutput = (s) => {
  if (!muted) write(s);
};

// Las respuestas se guardan en orden: si llegan todas juntas (por ejemplo, desde un
// script) no se pierde ninguna mientras se escribe la pregunta siguiente
const pending: string[] = [];
let waiting: ((line: string) => void) | null = null;
rl.on('line', (line) => {
  if (waiting) {
    const w = waiting;
    waiting = null;
    w(line);
  } else pending.push(line);
});
// Si se cierra la entrada sin responder, la pregunta queda vacía
rl.on('close', () => waiting?.(''));

/** Pregunta algo en la terminal. Con `hidden`, no muestra lo que se escribe. */
function ask(question: string, hidden = false): Promise<string> {
  muted = false;
  rl.setPrompt(question);
  rl.prompt();
  // La pregunta ya se escribió: desde acá se oculta lo que se tipea
  muted = hidden;
  return new Promise((resolve) => {
    const done = (answer: string) => {
      if (hidden) {
        muted = false;
        process.stdout.write('\n');
      }
      resolve(answer);
    };
    const ready = pending.shift();
    if (ready !== undefined) done(ready);
    else waiting = done;
  });
}

async function main() {
  const users = all<{ name: string; email: string }>('SELECT name, email FROM users ORDER BY id');
  if (users.length === 0) {
    console.log('Todavía no hay cuentas. Creá una desde la pantalla de ingreso de la app.');
    return;
  }

  console.log('\nCuentas en esta compu:');
  for (const u of users) console.log(`  - ${u.email} (${u.name})`);
  console.log();

  const single = users.length === 1 ? users[0].email : null;
  const typed = (await ask(single ? `Email [Enter = ${single}]: ` : 'Email de la cuenta: ')).trim();
  const email = typed || single || '';

  const password = await ask('Contraseña nueva (mínimo 8 caracteres, no se muestra): ', true);
  const confirm = await ask('Repetila: ', true);
  if (password !== confirm) {
    console.log('\nLas contraseñas no coinciden. No se cambió nada.');
    process.exitCode = 1;
    return;
  }

  const user = resetPassword(email, password);
  console.log(`\nListo: ya podés entrar con ${user.email} y tu contraseña nueva.`);
  console.log('Por seguridad se cerraron las sesiones que estaban abiertas.');
}

main()
  .catch((err: Error) => {
    console.log(`\nNo se pudo cambiar la contraseña: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
