// reglas:generar y reglas:verificar. Generan firestore.rules y storage.rules desde el
// registro de módulos; verificar falla si algún archivo versionado difiere de lo generado.
import { readFileSync, writeFileSync } from 'node:fs';
import { cargarManifiestos, generarReglas, generarReglasAlmacenamiento } from './generar-reglas.mjs';

const accion = process.argv[2];
if (accion !== 'generar' && accion !== 'verificar') {
  console.error('Uso: node scripts/reglas.mjs <generar|verificar>');
  process.exit(2);
}

const manifiestos = await cargarManifiestos();
const archivos = [
  ['firestore.rules', generarReglas(manifiestos)],
  ['storage.rules', generarReglasAlmacenamiento(manifiestos)],
];

if (accion === 'generar') {
  for (const [archivo, generado] of archivos) {
    writeFileSync(archivo, generado);
    console.log(`reglas:generar: ${archivo} escrito.`);
  }
} else {
  let difieren = 0;
  for (const [archivo, generado] of archivos) {
    let actual = '';
    try {
      actual = readFileSync(archivo, 'utf8');
    } catch {
      // archivo ausente: difiere
    }
    if (actual !== generado) {
      console.error(`reglas:verificar: ${archivo} difiere de lo generado. Ejecute pnpm reglas:generar.`);
      difieren++;
    } else {
      console.log(`reglas:verificar: ${archivo} coincide con lo generado.`);
    }
  }
  if (difieren > 0) process.exit(1);
}
