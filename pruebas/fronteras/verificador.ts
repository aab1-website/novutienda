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
      if (!imp.startsWith('@plataforma/')) continue; // dependencias externas: fuera de este control

      if (z.zona === 'tenant') {
        if (imp !== '@plataforma/nucleo/extension') {
          falla('un tenant solo importa @plataforma/nucleo/extension');
        }
      } else if (z.nombre === 'nucleo') {
        falla('nucleo no importa ningún paquete interno');
      } else if (imp !== '@plataforma/nucleo' && !declaradas.some((d) => imp === `@plataforma/${d}`)) {
        falla('solo @plataforma/nucleo (entrada pública) y lo que declare el manifiesto');
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
