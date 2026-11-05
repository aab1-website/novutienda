// test:rules: levanta el emulador de Firestore (proyecto demo-pruebas) y corre
// las pruebas de pruebas/reglas (o reutiliza el que ya indique
// FIRESTORE_EMULATOR_HOST). Falla si las pruebas fallan o si no llegan a
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
const env = { ...process.env, REGLAS_EXIGIR_EMULADOR: '1' };
const comando = 'npx vitest --run pruebas/reglas';

// Con FIRESTORE_EMULATOR_HOST ya definido (p. ej. dentro de
// `firebase emulators:exec`, como hace el CI) el emulador existe: se corre
// vitest directamente. Levantar otro con correr-emulador.sh chocaría con el
// puerto ocupado.
const r = process.env.FIRESTORE_EMULATOR_HOST
  ? spawnSync('bash', ['-c', comando], { stdio: 'inherit', env })
  : spawnSync('bash', ['scripts/correr-emulador.sh', comando], { stdio: 'inherit', env });
if (r.error) {
  console.error(`test:rules: no se pudo ejecutar: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
