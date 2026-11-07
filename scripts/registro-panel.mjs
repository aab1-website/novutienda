// registro:generar y registro:verificar. Derivan del registro de módulos (acciones y pantallas de los manifiestos)
// las dos tablas que el panel necesita en tiempo de ejecución, para que el panel no importe manifiestos de módulos:
//   paquetes/panel/src/api/acciones.generado.ts   (ROLES_ACCION)
//   paquetes/panel/src/util/pantallas.generado.ts (PANTALLAS)
// La salida es determinista (sin fechas). Nunca se edita a mano.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cargarManifiestos } from './generar-reglas.mjs';

const CABECERA = [
  '// GENERADO por scripts/registro-panel.mjs desde el registro de módulos (pnpm registro:generar).',
  '// No se edita a mano: `pnpm registro:verificar` falla si difiere de lo generado.',
  '',
].join('\n');

const lista = (xs) => `[${xs.map((x) => `'${x}'`).join(', ')}]`;
const texto = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function generarAcciones(acciones) {
  const filas = acciones.map((a) => `  ${texto(`${a.callable}.${a.nombre}`)}: ${lista(a.roles)},`);
  return `${CABECERA}import type { Rol } from './tipos.js';

/** Roles de cada acción real del servidor, por clave \`callable.nombre\`. */
export const ROLES_ACCION: Readonly<Record<string, readonly Rol[]>> = {
${filas.join('\n')}
};
`;
}

export function generarPantallas(pantallas) {
  const ordenadas = [...pantallas].sort((a, b) => a.orden - b.orden);
  const filas = ordenadas.map((p) => {
    const porRol = p.tituloPorRol === undefined
      ? ''
      : `, tituloPorRol: { ${Object.entries(p.tituloPorRol).map(([r, t]) => `${r}: ${texto(t)}`).join(', ')} }`;
    return `  { id: ${texto(p.id)}, titulo: ${texto(p.titulo)}, roles: ${lista(p.roles)}, orden: ${p.orden}, modulo: ${texto(p.modulo)}${porRol} },`;
  });
  return `${CABECERA}import type { Rol } from '@novutienda/nucleo';

export interface PantallaGenerada {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  readonly orden: number;
  /** Módulo dueño de la pantalla (\`panel\` para las de Central). */
  readonly modulo: string;
  readonly tituloPorRol?: Partial<Record<Rol, string>>;
}

/** Pantallas del panel según el registro, por \`orden\`. */
export const PANTALLAS: readonly PantallaGenerada[] = [
${filas.join('\n')}
];
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const accion = process.argv[2];
  if (accion !== 'generar' && accion !== 'verificar') {
    console.error('Uso: node scripts/registro-panel.mjs <generar|verificar>');
    process.exit(2);
  }
  await cargarManifiestos();
  const { registroPlataforma } = await import(new URL('../plataforma/registro.ts', import.meta.url).href);
  const archivos = [
    ['paquetes/panel/src/api/acciones.generado.ts', generarAcciones(registroPlataforma.acciones())],
    ['paquetes/panel/src/util/pantallas.generado.ts', generarPantallas(registroPlataforma.pantallas())],
  ];
  if (accion === 'generar') {
    for (const [archivo, generado] of archivos) {
      writeFileSync(archivo, generado);
      console.log(`registro:generar: ${archivo} escrito.`);
    }
  } else {
    let difieren = 0;
    for (const [archivo, generado] of archivos) {
      let actual = '';
      try { actual = readFileSync(archivo, 'utf8'); } catch { /* ausente: difiere */ }
      if (actual !== generado) {
        console.error(`registro:verificar: ${archivo} difiere de lo generado. Ejecute pnpm registro:generar.`);
        difieren++;
      } else {
        console.log(`registro:verificar: ${archivo} coincide con lo generado.`);
      }
    }
    if (difieren > 0) process.exit(1);
  }
}
