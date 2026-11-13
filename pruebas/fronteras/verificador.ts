// Verificador de fronteras entre zonas del monorepo. Opera sobre un árbol
// virtual (ruta -> contenido) para poder probarse con árboles inventados.
import { posix } from 'node:path';

export type Arbol = Readonly<Record<string, string>>;

export interface Violacion {
  readonly archivo: string;
  readonly importacion: string;
  readonly motivo: string;
}

/** dependeDe de cada módulo, tomado de su manifiesto. */
export type Dependencias = Readonly<Record<string, readonly string[]>>;

const EXT_CODIGO = /\.(ts|tsx|js|mjs|cjs)$/;
const IMPORTACION =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])((?:(?!\1)[^\n])+)\1/g;

export function extraerImportaciones(codigo: string): string[] {
  return [...codigo.matchAll(IMPORTACION)].map((m) => m[2] as string);
}

function zonaDe(archivo: string): { zona: 'paquete' | 'tenant'; nombre: string } | undefined {
  const m = /^(paquetes|tenants)\/([^/]+)\//.exec(archivo);
  if (m === null) return undefined;
  return { zona: m[1] === 'paquetes' ? 'paquete' : 'tenant', nombre: m[2] as string };
}

export function verificarFronteras(arbol: Arbol, dependencias: Dependencias = {}): Violacion[] {
  const violaciones: Violacion[] = [];
  for (const [archivo, codigo] of Object.entries(arbol)) {
    const z = zonaDe(archivo);
    if (z === undefined || !EXT_CODIGO.test(archivo) || archivo.includes('/node_modules/')) continue;
    const raizPropia = `${z.zona === 'paquete' ? 'paquetes' : 'tenants'}/${z.nombre}`;
    const declaradas = dependencias[z.nombre] ?? [];

    for (const imp of extraerImportaciones(codigo)) {
      const falla = (motivo: string): void => {
        violaciones.push({ archivo, importacion: imp, motivo });
      };

      if (imp.includes('${')) {
        // El destino se calcula en ejecución: no se puede verificar la frontera.
        falla('importación dinámica con plantilla de texto: destino no verificable');
        continue;
      }
      if (imp.startsWith('.')) {
        const destino = posix.normalize(posix.join(posix.dirname(archivo), imp));
        if (destino !== raizPropia && !destino.startsWith(`${raizPropia}/`)) {
          falla('importación relativa fuera de la zona propia');
        }
        continue;
      }
      if (/(^|\/)src(\/|$)/.test(imp)) {
        falla('importación profunda a /src/');
        continue;
      }
      if (imp.startsWith('@tenant/')) {
        falla('ningún código importa a un tenant');
        continue;
      }
      if (!imp.startsWith('@novutienda/')) continue; // dependencias externas: fuera de este control

      if (z.zona === 'tenant') {
        if (imp !== '@novutienda/nucleo/extension') {
          falla('un tenant solo importa @novutienda/nucleo/extension');
        }
      } else if (z.nombre === 'nucleo') {
        falla('nucleo no importa ningún paquete interno');
      } else if (imp === '@novutienda/nucleo/servidor') {
        // Entrada de Node del núcleo: no la usa el código que llega al navegador (panel).
        if (z.nombre === 'panel') falla('el panel (navegador) importa solo @novutienda/nucleo, no /servidor');
      } else if (imp !== '@novutienda/nucleo' && !declaradas.some((d) => imp === `@novutienda/${d}`)) {
        falla('solo @novutienda/nucleo (entrada pública) y lo que declare el manifiesto');
      }
    }
  }
  return violaciones;
}

/** Archivos de texto del árbol que contienen el término (sin distinguir mayúsculas). */
export function buscarTermino(arbol: Arbol, prefijo: string, termino: string): string[] {
  const t = termino.toLowerCase();
  return Object.entries(arbol)
    .filter(([ruta]) => ruta.startsWith(prefijo) && !ruta.includes('/node_modules/'))
    .filter(([ruta, contenido]) => ruta.toLowerCase().includes(t) || contenido.toLowerCase().includes(t))
    .map(([ruta]) => ruta);
}

/** Quita comentarios de línea y de bloque (aproximado: no entiende cadenas con «//» dentro; basta para importaciones). */
function sinComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const NUCLEO = String.raw`['"]@novutienda\/nucleo(?:\/[^'"\n]*)?['"]`;
const IMPORTACION_NOMBRADA = new RegExp(
  String.raw`\b(?:import|export)\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:(\{[^}]*\})|\*\s+as\s+(\w+))\s*from\s*${NUCLEO}`, 'g');
const EXPORTAR_TODO = new RegExp(String.raw`\bexport\s+(?:type\s+)?\*\s*(?:as\s+\w+\s*)?from\s*${NUCLEO}`);
const DINAMICA = new RegExp(String.raw`\bimport\s*\(\s*${NUCLEO}\s*\)`, 'g');

function nombresEnLlaves(llaves: string): string[] {
  return llaves.slice(1, -1).split(',').map((p) => p.trim().replace(/^type\s+/, '').split(/\s*(?:\sas\s|:|=)\s*/)[0]?.trim() ?? '').filter((n) => n !== '');
}

/** Miembros del espacio de nombres `alias` que el código toca; `null` si el acceso no se puede resolver (falla cerrado). */
function miembrosDeEspacio(limpio: string, alias: string): { nombres: string[]; cerrado: boolean } {
  const a = alias.replace(/\$/g, '\\$');
  const nombres: string[] = [];
  let cerrado = false;
  for (const m of limpio.matchAll(new RegExp(String.raw`(?<![\w$.])${a}\s*\??\.\s*([\w$]+)`, 'g'))) nombres.push(m[1] as string);
  for (const m of limpio.matchAll(new RegExp(String.raw`(?<![\w$.])${a}\s*(?:\?\.)?\s*\[\s*([^\]]*?)\s*\]`, 'g'))) {
    const lit = /^(['"`])([\w$]+)\1$/.exec(m[1] as string);
    if (lit === null) cerrado = true;
    else nombres.push(lit[2] as string);
  }
  for (const m of limpio.matchAll(new RegExp(String.raw`(\{[^}]*\})\s*=\s*(?:await\s+)?${a}(?![\w$])`, 'g'))) nombres.push(...nombresEnLlaves(m[1] as string));
  return { nombres, cerrado };
}

/**
 * Símbolos de `simbolos` que el código toma de `@novutienda/nucleo` (o un subpath), por análisis de importaciones:
 * nombres en llaves (con `as` y `type`), `export { X } from`, `import * as ns` y `import()` dinámico con acceso por punto,
 * corchetes con literal o desestructuración. Falla cerrado (cuenta TODOS los símbolos) con `export * from` el núcleo, con
 * acceso por corchetes con expresión no literal y con un `import()` cuyo resultado no se puede seguir. Un nombre local igual
 * que no viene del núcleo no cuenta.
 */
export function simbolosDeNucleoUsados(codigo: string, simbolos: readonly string[]): string[] {
  const limpio = sinComentarios(codigo);
  if (EXPORTAR_TODO.test(limpio)) return [...simbolos].sort();
  const usados = new Set<string>();
  let todos = false;
  const sumar = (nombres: readonly string[]): void => { for (const n of nombres) if (simbolos.includes(n)) usados.add(n); };
  const espacio = (alias: string): void => {
    const r = miembrosDeEspacio(limpio, alias);
    sumar(r.nombres);
    if (r.cerrado) todos = true;
  };
  for (const m of limpio.matchAll(IMPORTACION_NOMBRADA)) {
    if (m[2] !== undefined) sumar(nombresEnLlaves(m[2]));
    if (m[3] !== undefined) espacio(m[3]);
  }
  for (const m of limpio.matchAll(DINAMICA)) {
    const antes = limpio.slice(0, m.index);
    const llaves = /(\{[^}]*\})\s*=\s*(?:await\s+)?$/.exec(antes);
    const alias = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?$/.exec(antes);
    const despues = limpio.slice((m.index ?? 0) + m[0].length);
    const directo = /^\s*\)\s*\.\s*([\w$]+)/.exec(despues);
    if (llaves !== null) sumar(nombresEnLlaves(llaves[1] as string));
    else if (alias !== null) espacio(alias[1] as string);
    else if (/\(\s*await\s+$/.test(antes) && directo !== null) sumar([directo[1] as string]);
    else todos = true;
  }
  return (todos ? [...simbolos] : [...usados]).sort();
}
