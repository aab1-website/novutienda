// test:rules: levanta el emulador de Firestore (proyecto demo-pruebas) y corre
// las pruebas de pruebas/reglas. Falla si las pruebas fallan o si no llegan a
// ejecutarse contra el emulador. Es no-op solo si no hay pruebas.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const carpeta = 'pruebas/reglas';
const pruebas = existsSync(carpeta)
  ? readdirSync(carpeta).filter((f) => f.endsWith('.test.ts'))
  : [];

if (pruebas.length === 0) {
  console.log('test:rules: sin pruebas en pruebas/reglas; no hay nada que ejecutar.');
  process.exit(0);
}

// REGLAS_EXIGIR_EMULADOR hace que las pruebas fallen, en vez de omitirse, si
// el emulador no está disponible.
const r = spawnSync(
  'bash',
  ['scripts/correr-emulador.sh', 'npx vitest --run pruebas/reglas'],
  { stdio: 'inherit', env: { ...process.env, REGLAS_EXIGIR_EMULADOR: '1' } },
);
if (r.error) {
  console.error(`test:rules: no se pudo ejecutar: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
