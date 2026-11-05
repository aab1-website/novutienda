// reglas:generar y reglas:verificar. Generan firestore.rules desde el registro
// de módulos; verificar falla si el archivo versionado difiere de lo generado.
import { readFileSync, writeFileSync } from 'node:fs';
import { cargarManifiestos, generarReglas } from './generar-reglas.mjs';

const ARCHIVO = 'firestore.rules';
const accion = process.argv[2];
if (accion !== 'generar' && accion !== 'verificar') {
  console.error('Uso: node scripts/reglas.mjs <generar|verificar>');
  process.exit(2);
}

const generado = generarReglas(await cargarManifiestos());

if (accion === 'generar') {
  writeFileSync(ARCHIVO, generado);
  console.log(`reglas:generar: ${ARCHIVO} escrito.`);
} else {
  let actual = '';
  try {
    actual = readFileSync(ARCHIVO, 'utf8');
  } catch {
    // archivo ausente: difiere
  }
  if (actual !== generado) {
    console.error(`reglas:verificar: ${ARCHIVO} difiere de lo generado. Ejecute pnpm reglas:generar.`);
    process.exit(1);
  }
  console.log(`reglas:verificar: ${ARCHIVO} coincide con lo generado.`);
}
