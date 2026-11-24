/**
 * «Categorías» del sitio: nombre, ícono, orden y visibilidad de cada categoría (`categorias` de `sitio/negocio`). La CLAVE de una
 * categoría (la que escribe el producto, por ejemplo «linea-blanca») no se cambia nunca: de ella dependen la dirección de las
 * páginas y el área del catálogo de NovuChat. Todo es puro y conserva el resto del documento del negocio.
 */
import { RE_SLUG_SITIO } from '@novutienda/nucleo';

/**
 * Topes y forma de las categorías: COPIA de `LIMITES_NEGOCIO.categorias` de `@novutienda/consola/negocio` (el panel no importa la
 * consola); `pruebas/consola/categorias.test.ts` compara cada uno con el original.
 */
export const TOPES_CATEGORIAS = { nombre: { min: 1, max: 80 }, max: 40, orden: { min: 0, max: 39 } } as const;

/** Íconos admitidos (COPIA de `IDS_ICONO_NEGOCIO`, con su nombre en palabras de usuaria); la prueba de paridad compara los identificadores. */
export const ICONOS_CATEGORIA: readonly { readonly id: string; readonly nombre: string }[] = [
  { id: 'parlante', nombre: 'Parlante' }, { id: 'microondas', nombre: 'Microondas' }, { id: 'televisor', nombre: 'Televisor' },
  { id: 'lavadora', nombre: 'Lavadora' }, { id: 'aire', nombre: 'Aire acondicionado' }, { id: 'congelador', nombre: 'Congelador' },
  { id: 'heladera', nombre: 'Heladera' }, { id: 'cuadricula', nombre: 'Cuadrícula (general)' }, { id: 'escudo', nombre: 'Escudo' },
  { id: 'camion', nombre: 'Camión' }, { id: 'mensaje', nombre: 'Mensaje' }, { id: 'tendencia', nombre: 'Tendencia' },
  { id: 'usuario', nombre: 'Persona' }, { id: 'check', nombre: 'Visto bueno' }, { id: 'pin', nombre: 'Ubicación' },
  { id: 'telefono', nombre: 'Teléfono' }, { id: 'actualizar', nombre: 'Actualizar' },
];

/** Los datos del negocio tal como los guarda el servidor; solo se escribe `categorias`. */
export type NegocioCrudo = Readonly<Record<string, unknown>>;

export interface CategoriaGuardada { readonly nombre: string; readonly icono: string; readonly oculta?: true; readonly orden?: number }

export interface CategoriaVista {
  readonly clave: string;
  /** Nombre que ven los clientes; sin definir en el negocio, la clave tal cual. */
  readonly nombre: string;
  readonly icono: string;
  readonly oculta: boolean;
  readonly orden: number | undefined;
  readonly productos: number;
  /** `false`: algún producto la usa pero todavía no tiene nombre ni ícono propios. */
  readonly definida: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Las categorías guardadas, solo las de forma válida (una malformada no tumba la pantalla; el servidor las revalida al guardar). */
export function leerCategorias(negocio: NegocioCrudo | null): Readonly<Record<string, CategoriaGuardada>> {
  const r: Record<string, CategoriaGuardada> = {};
  for (const [k, v] of Object.entries(obj(negocio?.['categorias']))) {
    const c = obj(v);
    if (typeof c['nombre'] !== 'string' || typeof c['icono'] !== 'string') continue;
    r[k] = {
      nombre: c['nombre'], icono: c['icono'],
      ...(c['oculta'] === true ? { oculta: true as const } : {}),
      ...(typeof c['orden'] === 'number' ? { orden: c['orden'] } : {}),
    };
  }
  return r;
}

/** Une las categorías del negocio con las claves que usan los productos. Primero las que tienen orden, luego las demás por nombre. */
export function unirCategorias(negocio: NegocioCrudo | null, clavesDeProductos: readonly string[]): readonly CategoriaVista[] {
  const guardadas = leerCategorias(negocio);
  const cuenta = new Map<string, number>();
  for (const k of clavesDeProductos) if (k !== '') cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  const claves = new Set([...Object.keys(guardadas), ...cuenta.keys()]);
  const lista = [...claves].map((clave): CategoriaVista => {
    const g = guardadas[clave];
    return {
      clave, nombre: g?.nombre ?? clave, icono: g?.icono ?? 'cuadricula', oculta: g?.oculta === true, orden: g?.orden,
      productos: cuenta.get(clave) ?? 0, definida: g !== undefined,
    };
  });
  return lista.sort((a, b) => (a.orden ?? Infinity) - (b.orden ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es') || (a.clave < b.clave ? -1 : 1));
}

/** «Línea blanca» → «linea-blanca». Vacío si no queda ningún carácter válido. */
export function claveDesdeNombre(nombre: string): string {
  const c = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');
  return RE_SLUG_SITIO.test(c) ? c : '';
}

export interface CambiosCategoria { readonly nombre: string; readonly icono: string; readonly oculta: boolean }

/** El negocio con `categorias[clave]` escrita; conserva su `orden` y todos los demás campos del documento. */
export function aplicarCategoria(negocio: NegocioCrudo, clave: string, c: CambiosCategoria): Record<string, unknown> {
  const previa = leerCategorias(negocio)[clave];
  const nueva: CategoriaGuardada = {
    nombre: c.nombre.trim(), icono: c.icono,
    ...(c.oculta ? { oculta: true as const } : {}),
    ...(previa?.orden === undefined ? {} : { orden: previa.orden }),
  };
  return { ...negocio, categorias: { ...obj(negocio['categorias']), [clave]: nueva } };
}

/** Sube o baja una categoría: numera de 0 en adelante TODAS las definidas, en el orden visible, con la movida en su lugar nuevo. */
export function moverCategoria(negocio: NegocioCrudo, vista: readonly CategoriaVista[], clave: string, delta: -1 | 1): Record<string, unknown> {
  const claves = vista.filter((v) => v.definida).map((v) => v.clave);
  const i = claves.indexOf(clave);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= claves.length) return { ...negocio };
  [claves[i], claves[j]] = [claves[j]!, claves[i]!];
  const guardadas = obj(negocio['categorias']);
  const nuevas = Object.fromEntries(Object.entries(guardadas).map(([k, v]) => {
    const orden = claves.indexOf(k);
    return [k, orden < 0 ? v : { ...obj(v), orden }];
  }));
  return { ...negocio, categorias: nuevas };
}

export interface ErroresCategoria { nombre?: string; clave?: string; categorias?: string }

/** Revisa el nombre (y, si es nueva, su clave y el tope de categorías) antes de guardar. El servidor vuelve a validar todo. */
export function revisarCategoria(
  e: { readonly nombre: string; readonly icono: string }, nueva: { readonly negocio: NegocioCrudo; readonly claves: readonly string[] } | null,
  /** Negocio al editar una categoría «sin nombre propio» (la usa un producto pero no está guardada): al guardarla suma una, así que también cuenta contra el tope. */
  negocioDeSinNombre?: NegocioCrudo,
): ErroresCategoria {
  const r: ErroresCategoria = {};
  const nombre = e.nombre.trim();
  const T = TOPES_CATEGORIAS.nombre;
  if (nombre.length < T.min) r.nombre = 'Escriba el nombre de la categoría. Por ejemplo: Línea blanca.';
  else if (nombre.length > T.max) r.nombre = `Máximo ${String(T.max)} caracteres.`;
  else if (/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(nombre)) r.nombre = 'Use solo letras, números y signos comunes, sin saltos de línea.';
  else if (/<\/?[a-zA-Z!][^>]*>/.test(nombre)) r.nombre = 'No se admiten etiquetas ni código; escriba solo el texto.';
  if (nueva !== null && r.nombre === undefined) {
    const clave = claveDesdeNombre(nombre);
    if (clave === '') r.nombre = 'Use al menos una letra o un número.';
    else if (nueva.claves.includes(clave)) r.nombre = 'Ya existe una categoría con ese nombre.';
    else if (Object.keys(obj(nueva.negocio['categorias'])).length >= TOPES_CATEGORIAS.max) r.categorias = topeLleno();
  } else if (negocioDeSinNombre !== undefined && Object.keys(obj(negocioDeSinNombre['categorias'])).length >= TOPES_CATEGORIAS.max) {
    r.categorias = topeLleno();
  }
  return r;
}

const topeLleno = (): string => `Llegó al máximo de ${String(TOPES_CATEGORIAS.max)} categorías.`;

/**
 * Mensaje en palabras de usuaria cuando el servidor rechaza el guardado con rutas `categorias.<clave>.<campo>` (nunca valores).
 * Nombra la categoría (por el nombre que se envió) y dice qué arreglar. `null` si ningún detalle es de una categoría.
 */
export function mensajeDeCategorias(detalles: readonly string[], enviado: NegocioCrudo): string | null {
  const guardadas = leerCategorias(enviado);
  const partes: string[] = [];
  for (const d of detalles) {
    const ruta = d.slice(0, Math.max(0, d.indexOf(':')));
    if (ruta === 'categorias') { partes.push(`Hay demasiadas categorías: el máximo es ${String(TOPES_CATEGORIAS.max)}.`); continue; }
    const m = /^categorias\.([a-z0-9-]+)\.(nombre|icono|orden|oculta)$/.exec(ruta);
    if (m === null) { if (/^categorias\[\d+\]/.test(ruta)) partes.push('Una categoría tiene una dirección de página no válida. Quite esa categoría o vuelva a crearla con otro nombre.'); continue; }
    const nombre = `«${guardadas[m[1] ?? '']?.nombre ?? m[1] ?? ''}»`;
    const T = TOPES_CATEGORIAS.nombre;
    partes.push(
      m[2] === 'nombre' ? `La categoría ${nombre} no se pudo guardar: escriba un nombre de ${String(T.min)} a ${String(T.max)} caracteres, sin etiquetas ni saltos de línea.`
        : m[2] === 'icono' ? `La categoría ${nombre} no se pudo guardar: elija un ícono de la lista.`
        : m[2] === 'orden' ? `La categoría ${nombre} no se pudo guardar: su posición no es válida. Use Subir o Bajar para reordenar.`
        : `La categoría ${nombre} no se pudo guardar: vuelva a marcar si está oculta o visible.`,
    );
  }
  return partes.length === 0 ? null : [...new Set(partes)].join(' ');
}
