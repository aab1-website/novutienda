#!/usr/bin/env node
// Medición de zonas: imprime pieza → zona (archivos y líneas), archivos sin zona y cruces de importación,
// a partir de `pruebas/fronteras/zonas.ts` (la única fuente del mapa) y de `pruebas/fronteras/deuda.json`.
// Solo lectura. Es el «estado generado» del plano (docs/arquitectura/01-arquitectura-por-zonas.md §9):
// las cifras viven aquí, no en los documentos.
//
//   pnpm zonas            tabla legible
//   pnpm zonas -- --json  el mismo inventario en JSON (para la revisora o para un informe)
//
// Requiere Node 22.18+ (carga `zonas.ts` con el stripping de tipos nativo). La compuerta real es
// `pnpm vitest run pruebas/fronteras`; este script solo informa.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const JSON_SALIDA = process.argv.includes('--json');

let zonas;
try {
  zonas = await import(pathToFileURL(join(RAIZ, 'pruebas/fronteras/zonas.ts')).href);
} catch (e) {
  console.error('No se pudo cargar pruebas/fronteras/zonas.ts: hace falta Node 22.18+ (stripping de tipos).');
  console.error(String(e?.message ?? e));
  process.exit(2);
}
const { CARPETAS_CON_ZONA, archivosSinZona, claveDeCruce, crucesDeZona, esCodigo, zonaDe } = zonas;

function leerArbol(carpeta) {
  const arbol = {};
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const nombre = entrada.name;
      if (nombre === 'node_modules' || nombre === 'dist' || nombre === 'coverage' || nombre === '.astro') continue;
      const ruta = join(dir, nombre);
      if (entrada.isDirectory()) recorrer(ruta);
      else arbol[relative(RAIZ, ruta).split(sep).join('/')] = readFileSync(ruta, 'utf8');
    }
  };
  recorrer(join(RAIZ, carpeta));
  return arbol;
}

/** `dependeDe` de cada manifiesto, leído del texto (sin cargar los paquetes, que no corren con stripping de tipos). */
function dependenciasDeManifiestos(arbol) {
  const deps = {};
  for (const [ruta, codigo] of Object.entries(arbol)) {
    const m = /^paquetes\/([^/]+)\/src\/manifiesto\.ts$/.exec(ruta);
    const lista = /dependeDe:\s*\[([^\]]*)\]/.exec(codigo);
    if (m === null || lista === null) continue;
    deps[m[1]] = [...lista[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((d) => d !== 'nucleo');
  }
  return deps;
}

const arbol = Object.assign({}, ...CARPETAS_CON_ZONA.map(leerArbol));
const codigo = Object.keys(arbol).filter(esCodigo).sort();
const lineas = (texto) => (texto.length === 0 ? 0 : texto.split('\n').length - (texto.endsWith('\n') ? 1 : 0));

const porZona = new Map();
for (const ruta of codigo) {
  const zona = zonaDe(ruta) ?? '(sin zona)';
  const acumulado = porZona.get(zona) ?? { zona, archivos: 0, lineas: 0, rutas: [] };
  acumulado.archivos += 1;
  acumulado.lineas += lineas(arbol[ruta]);
  acumulado.rutas.push(ruta);
  porZona.set(zona, acumulado);
}
const ordenZona = (z) => {
  const orden = ['nucleo', 'central', 'plataforma', 'modulo:', 'coordinador', 'conector:', 'tenant', 'pruebas:', 'metodo', '(sin zona)'];
  const i = orden.findIndex((p) => z === p || z.startsWith(p));
  return `${String(i === -1 ? 99 : i).padStart(2, '0')} ${z}`;
};
const filas = [...porZona.values()].sort((a, b) => ordenZona(a.zona).localeCompare(ordenZona(b.zona)));

const sinZona = archivosSinZona(Object.keys(arbol));
const cruces = crucesDeZona(arbol, dependenciasDeManifiestos(arbol));
const deuda = JSON.parse(readFileSync(join(RAIZ, 'pruebas/fronteras/deuda.json'), 'utf8'));
const enDeuda = new Set(deuda.cruces.map(claveDeCruce));
const vigentes = new Set(cruces.map(claveDeCruce));
const crucesConEstado = cruces.map((c) => ({ ...c, estado: enDeuda.has(claveDeCruce(c)) ? 'en deuda' : 'NUEVO' }));
const deudaResuelta = deuda.cruces.filter((d) => !vigentes.has(claveDeCruce(d))).map(claveDeCruce);

if (JSON_SALIDA) {
  console.log(JSON.stringify({ zonas: filas, sinZona, cruces: crucesConEstado, deudaResuelta }, null, 2));
  process.exit(0);
}

const ancho = Math.max(...filas.map((f) => f.zona.length), 4);
console.log(`Zonas de NovuTienda (${codigo.length} archivos de código en ${CARPETAS_CON_ZONA.join(', ')})\n`);
console.log(`${'zona'.padEnd(ancho)}  archivos  líneas`);
for (const f of filas) console.log(`${f.zona.padEnd(ancho)}  ${String(f.archivos).padStart(8)}  ${String(f.lineas).padStart(6)}`);
console.log(`${'total'.padEnd(ancho)}  ${String(codigo.length).padStart(8)}  ${String(filas.reduce((s, f) => s + f.lineas, 0)).padStart(6)}`);

console.log(`\nArchivos sin zona: ${sinZona.length}`);
for (const r of sinZona) console.log(`  ${r}`);

console.log(`\nCruces de importación entre zonas: ${cruces.length} (en deuda: ${cruces.length - crucesConEstado.filter((c) => c.estado === 'NUEVO').length}, nuevos: ${crucesConEstado.filter((c) => c.estado === 'NUEVO').length})`);
for (const c of crucesConEstado) console.log(`  [${c.estado}] ${c.archivo} → ${c.importacion}  (${c.zona} → ${c.destino})`);
if (deudaResuelta.length > 0) {
  console.log(`\nEntradas de deuda.json ya resueltas (quitar): ${deudaResuelta.length}`);
  for (const k of deudaResuelta) console.log(`  ${k}`);
}
console.log('\nLa compuerta es `pnpm vitest run pruebas/fronteras`; este listado solo informa.');
