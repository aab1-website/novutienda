import { ErrorApi } from '../../api/errores.js';
import type { CambiosProducto, EntradaProducto, PrecioUSDCentavos, ProductoPanel } from '../../api/tipos.js';
import { centavosATexto, textoACentavos } from '../../util/dinero.js';
import { MERCADOS_PRECIO } from './nombres.js';

/**
 * Revisión del alta y la edición de un producto antes de enviarla: el error de cada campo, con las mismas reglas que el
 * servidor (`validarEntradaProducto` de `@novutienda/inventarios`). Es una comodidad para marcar el error junto al
 * campo: el servidor vuelve a validar todo.
 */

export const TOPES_PRODUCTO = { nombre: 120, categoria: 60, marca: 60, sku: 40, id: 60 } as const;
const MAX_CENTAVOS = 10_000_000_000;
const ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const MONTO = 'Escriba un monto en dólares, por ejemplo 12,50.';

export interface FormProducto {
  id: string;
  /** La persona tocó el identificador: deja de seguir al nombre. */
  idEditado: boolean;
  nombre: string;
  categoria: string;
  marca: string;
  sku: string;
  garantia: string;
  minimo: string;
  costo: string;
  activo: boolean;
  conSerie: boolean;
  /** Texto del precio por clave de mercado (`bo`, `ar`…): se recorren los mercados del núcleo. */
  precios: Readonly<Record<string, string>>;
}

/** Claves de error: `nombre`, `id`, `categoria`, `marca`, `sku`, `garantia`, `minimo`, `costo`, `precio.<clave>`. */
export type ErroresProducto = Readonly<Record<string, string>>;

export const clavePrecio = (clave: string): string => `precio.${clave}`;

export function formInicial(p: ProductoPanel | null): FormProducto {
  const precios: Record<string, string> = {};
  for (const m of MERCADOS_PRECIO) precios[m.clave] = p === null ? '' : centavosATexto(p.precioUSD[m.clave]);
  return {
    id: p?.id ?? '', idEditado: false, nombre: p?.nombre ?? '', categoria: p?.categoria ?? '', marca: p?.marca ?? '', sku: p?.sku ?? '',
    garantia: p?.garantiaMeses === undefined ? '' : String(p.garantiaMeses), minimo: p?.minimo === undefined ? '' : String(p.minimo),
    costo: p?.costoUSD === undefined ? '' : centavosATexto(p.costoUSD), activo: p?.activo ?? true, conSerie: p?.conSerie ?? false, precios,
  };
}

export const mismoForm = (a: FormProducto, b: FormProducto): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Identificador técnico a partir del nombre: «Cable HDMI 2 m» → «cable-hdmi-2-m». Si ya existe, agrega -2, -3… */
export function identificadorSugerido(nombre: string, existentes: ReadonlySet<string> = new Set()): string {
  const base = nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '');
  if (base.length < 2) return '';
  if (!existentes.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const c = `${base}-${String(n)}`;
    if (!existentes.has(c)) return c;
  }
  return base;
}

const entero = (t: string): number | null => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : null);

export interface ContextoRevision {
  readonly nuevo: boolean;
  readonly existentes: readonly { readonly id: string; readonly sku: string }[];
}

export function revisarProducto(f: FormProducto, ctx: ContextoRevision): ErroresProducto {
  const e: Record<string, string> = {};
  const nombre = f.nombre.trim();
  if (nombre === '') e['nombre'] = 'Escriba el nombre del producto.';
  else if (nombre.length > TOPES_PRODUCTO.nombre) e['nombre'] = `Máximo ${String(TOPES_PRODUCTO.nombre)} caracteres.`;
  if (ctx.nuevo) {
    if (f.id === '') e['id'] = 'Falta el identificador. Se genera desde el nombre; puede cambiarlo.';
    else if (!ID.test(f.id)) e['id'] = 'Use minúsculas, números y guiones, de 2 a 60 caracteres, sin empezar con guion.';
    else if (ctx.existentes.some((x) => x.id === f.id)) e['id'] = 'Ya existe un producto con ese identificador. Cambie el identificador.';
  }
  const categoria = f.categoria.trim();
  if (categoria === '') e['categoria'] = 'Escriba la categoría.';
  else if (categoria.length > TOPES_PRODUCTO.categoria) e['categoria'] = `Máximo ${String(TOPES_PRODUCTO.categoria)} caracteres.`;
  if (f.marca.trim().length > TOPES_PRODUCTO.marca) e['marca'] = `Máximo ${String(TOPES_PRODUCTO.marca)} caracteres.`;
  if (ctx.nuevo) {
    if (f.sku.trim() === '') e['sku'] = 'Escriba el SKU, el código con que identifica el producto.';
    else if (!SKU.test(f.sku.trim())) e['sku'] = 'Use letras, números, punto, guion o guion bajo, hasta 40 caracteres.';
    else if (ctx.existentes.some((x) => x.sku === f.sku.trim())) e['sku'] = 'Ese SKU ya lo usa otro producto.';
  }
  if (f.garantia.trim() !== '') {
    const g = entero(f.garantia);
    if (g === null || g < 1 || g > 120) e['garantia'] = 'Indique meses enteros, de 1 a 120, o déjela vacía.';
  }
  if (f.minimo.trim() !== '' && entero(f.minimo) === null) e['minimo'] = 'Indique un número entero desde 0, o déjelo vacío.';
  if (f.costo.trim() !== '') {
    const c = textoACentavos(f.costo);
    if (c === null) e['costo'] = MONTO;
    else if (c > MAX_CENTAVOS) e['costo'] = 'El monto es demasiado alto.';
  }
  for (const m of MERCADOS_PRECIO) {
    const t = f.precios[m.clave] ?? '';
    const c = textoACentavos(t);
    if (t.trim() === '') e[clavePrecio(m.clave)] = `Falta el precio de ${m.nombre}. Es obligatorio en cada mercado.`;
    else if (c === null) e[clavePrecio(m.clave)] = MONTO;
    else if (c > MAX_CENTAVOS) e[clavePrecio(m.clave)] = 'El monto es demasiado alto.';
  }
  return e;
}

/** Precio en centavos por mercado; `null` si algún mercado no es válido. */
export function preciosACentavos(f: FormProducto): PrecioUSDCentavos | null {
  const salida: Record<string, number> = {};
  for (const m of MERCADOS_PRECIO) {
    const c = textoACentavos(f.precios[m.clave] ?? '');
    if (c === null) return null;
    salida[m.clave] = c;
  }
  return salida as unknown as PrecioUSDCentavos;
}

/** Entrada de alta; solo con un formulario ya revisado. */
export function aEntrada(f: FormProducto): EntradaProducto | null {
  const precioUSD = preciosACentavos(f);
  if (precioUSD === null) return null;
  const costo = f.costo.trim() === '' ? undefined : textoACentavos(f.costo);
  return {
    id: f.id, nombre: f.nombre.trim(), categoria: f.categoria.trim(), ...(f.marca.trim() !== '' ? { marca: f.marca.trim() } : {}), sku: f.sku.trim(), activo: f.activo, conSerie: f.conSerie,
    ...(f.garantia.trim() !== '' ? { garantiaMeses: Number(f.garantia) } : {}), ...(f.minimo.trim() !== '' ? { minimo: Number(f.minimo) } : {}), precioUSD,
    ...(costo !== undefined && costo !== null ? { costoUSD: costo } : {}),
  };
}

export interface CambiosDeEdicion {
  /** Todo lo cambiado, precio incluido (`precioUSD`): una sola llamada a `actualizarProducto`. */
  readonly cambios: CambiosProducto;
  /** Datos independientes que la persona dejó vacíos y hoy tienen valor. */
  readonly vaciados: readonly string[];
  /** Se desactiva un producto que hoy está activo. */
  readonly desactiva: boolean;
}

/** Diferencias entre el formulario y el producto: `null` en lo que se vacía (marca, garantía, mínimo, costo). */
export function cambiosDeEdicion(f: FormProducto, p: ProductoPanel, puedeEditarCosto: boolean): CambiosDeEdicion {
  const c: { -readonly [K in keyof CambiosProducto]: CambiosProducto[K] } = {};
  const vaciados: string[] = [];
  if (f.nombre.trim() !== p.nombre) c.nombre = f.nombre.trim();
  if (f.categoria.trim() !== p.categoria) c.categoria = f.categoria.trim();
  const marca = f.marca.trim();
  if (marca !== (p.marca ?? '')) {
    if (marca === '') {
      c.marca = null;
      vaciados.push('la marca');
    } else c.marca = marca;
  }
  if (f.activo !== p.activo) c.activo = f.activo;
  if (f.conSerie !== p.conSerie) c.conSerie = f.conSerie;
  if (f.garantia.trim() === '') {
    if (p.garantiaMeses !== undefined) {
      c.garantiaMeses = null;
      vaciados.push('la garantía');
    }
  } else if (Number(f.garantia) !== p.garantiaMeses) c.garantiaMeses = Number(f.garantia);
  if (f.minimo.trim() === '') {
    if (p.minimo !== undefined) {
      c.minimo = null;
      vaciados.push('el mínimo de existencias');
    }
  } else if (Number(f.minimo) !== p.minimo) c.minimo = Number(f.minimo);
  if (puedeEditarCosto) {
    if (f.costo.trim() === '') {
      if (p.costoUSD !== undefined) {
        c.costoUSD = null;
        vaciados.push('el costo');
      }
    } else {
      const costo = textoACentavos(f.costo);
      if (costo !== null && costo !== p.costoUSD) c.costoUSD = costo;
    }
  }
  const precios = preciosACentavos(f);
  const cambiaPrecio = precios !== null && MERCADOS_PRECIO.some((m) => precios[m.clave] !== p.precioUSD[m.clave]);
  if (precios !== null && cambiaPrecio) c.precioUSD = precios;
  return { cambios: c, vaciados, desactiva: p.activo && !f.activo };
}

/** «la marca y la garantía» / «la marca, la garantía y el costo». */
export function listaEnTexto(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1] ?? ''}`;
}

const CAMPO_DE_RUTA: Readonly<Record<string, string>> = { id: 'id', nombre: 'nombre', categoria: 'categoria', marca: 'marca', sku: 'sku', garantiaMeses: 'garantia', conSerie: 'conSerie', minimo: 'minimo', costoUSD: 'costo' };

/** El campo al que corresponde un error del servidor, con su texto; `null` si no es de un campo (va como error general). */
export function errorDeServidor(e: unknown): { campo: string; texto: string } | null {
  if (!(e instanceof ErrorApi)) return null;
  if (/\bsku\b/i.test(e.message) && /uso|existe/i.test(e.message)) return { campo: 'sku', texto: 'Ese SKU ya lo usa otro producto.' };
  if (/(n[uú]mero de serie|conSerie)/i.test(e.message) && /movimientos?/i.test(e.message)) return { campo: 'conSerie', texto: 'No se puede cambiar: el producto ya tuvo movimientos.' };
  if (/producto .* ya existe/i.test(e.message)) return { campo: 'id', texto: 'Ya existe un producto con ese identificador. Cambie el identificador.' };
  for (const ruta of e.detalle.campos ?? []) {
    const ultimo = ruta.split('.').pop() ?? '';
    const m = MERCADOS_PRECIO.find((x) => x.clave === ultimo);
    if (m !== undefined && /precio/i.test(ruta)) return { campo: clavePrecio(m.clave), texto: `El servidor no aceptó el precio de ${m.nombre}. Revíselo.` };
    const campo = CAMPO_DE_RUTA[ultimo];
    if (campo !== undefined) return { campo, texto: 'El servidor no aceptó este dato. Revíselo.' };
  }
  return null;
}
