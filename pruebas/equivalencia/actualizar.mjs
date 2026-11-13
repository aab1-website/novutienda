// `pnpm equivalencia:actualizar`: regenera las referencias de la batería de equivalencia de Casa Bermejo.
// Es deliberado y manual: NO corre en CI. Tras regenerar, escribe el sello nuevo y agrega a CAMBIOS.md una entrada
// «PENDIENTE»; la prueba `registro.test.ts` falla hasta que alguien reemplace PENDIENTE por el porqué del cambio.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('equivalencia:actualizar no se ejecuta en CI: las referencias solo cambian en un PR, a mano y con explicación.');
  process.exit(1);
}

const aqui = fileURLToPath(new URL('.', import.meta.url));
const raiz = fileURLToPath(new URL('../../', import.meta.url));
const refs = `${aqui}referencias/`;
const { calcularSello, leerSello, leerCambios, ARCHIVO_SELLO } = await import('./sello.ts');

const antes = leerSello(refs);
const r = spawnSync('pnpm', ['vitest', 'run', 'pruebas/equivalencia'], { cwd: raiz, stdio: 'inherit', env: { ...process.env, EQUIVALENCIA_ACTUALIZAR: '1' } });
if (r.status !== 0) process.exit(r.status ?? 1);

const sello = calcularSello(refs);
if (sello === antes) {
  console.log('Las referencias no cambiaron: nada que registrar.');
  process.exit(0);
}
writeFileSync(`${refs}${ARCHIVO_SELLO}`, `${sello}\n`);
const cambios = `${aqui}CAMBIOS.md`;
if (!leerCambios(readFileSync(cambios, 'utf8')).some((e) => e.sello === sello)) {
  appendFileSync(cambios, `\n## Regeneración ${sello.slice(0, 12)}\n\nSello: ${sello}\nMotivo: PENDIENTE (explique qué comportamiento cambió y por qué es intencional para Casa Bermejo)\n`);
}
console.log(`Referencias regeneradas. Sello ${sello.slice(0, 12)}. Reemplace PENDIENTE en pruebas/equivalencia/CAMBIOS.md.`);
