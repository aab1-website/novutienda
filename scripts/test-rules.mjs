// Pruebas de reglas de Firestore. Por ahora es un no-op documentado: sale 0 si
// no hay pruebas en pruebas/reglas/. La matriz negativa llega con la ola 1b;
// desde entonces este script ejecutará vitest sobre esa carpeta.
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const carpeta = 'pruebas/reglas';
const pruebas = existsSync(carpeta)
  ? readdirSync(carpeta).filter((f) => f.endsWith('.test.ts'))
  : [];

if (pruebas.length === 0) {
  console.log('test:rules: sin pruebas en pruebas/reglas; no hay nada que ejecutar (ola 1b).');
  process.exit(0);
}

const r = spawnSync('pnpm', ['exec', 'vitest', '--run', carpeta], { stdio: 'inherit' });
process.exit(r.status ?? 1);
