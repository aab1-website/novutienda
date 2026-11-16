import { ErrorApi } from '../../api/errores.js';
import type { CambiosProducto, CodigoMoneda, EntradaProducto, PreciosPorMercado, ProductoPanel } from '../../api/tipos.js';
import { centavosATexto, textoACentavos } from '../../util/dinero.js';
import { PARECIDO_SKU } from './identificador.js';
import { nombreMoneda, type MercadoPrecio } from './nombres.js';

/**
 * Revisión del alta y la edición de un producto antes de enviarla: el error de cada campo, con las mismas reglas que el
 * servidor (`validarEntradaProducto` de `@novutienda/inventarios`). Es una comodidad para marcar el error junto al
 * campo: el servidor vuelve a validar todo.
 */

export const TOPES_PRODUCTO = { nombre: 120, categoria: 60, marca: 60, sku: 40 } as const;
const MAX_CENTAVOS = 10_000_000_000;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** «Escriba un monto en dólares, por ejemplo 12,50.»; sin moneda conocida no se nombra ninguna. */
const montoEn = (moneda: CodigoMoneda | undefined): string => `Escriba un monto${moneda === undefined ? '' : ` en ${nombreMoneda(moneda)}`}, por ejemplo 12,50.`;

export interface FormProducto {
  nombre: string;
  categoria: string;
  marca: string;
  sku: string;
  garantia: string;
  minimo: string;
  costo: string;
  activo: boolean;
  conSerie: boolean;
  /** Texto del precio por clave de mercado (`bo`, `ar`…): se recorren los mercados declarados por el comercio. */
  precios: Readonly<Record<string, string>>;
}

/** Claves de error: `nombre`, `categoria`, `marca`, `sku`, `garantia`, `minimo`, `costo`, `precio.<clave>`. */
export type ErroresProducto = Readonly<Record<string, string>>;

export const clavePrecio = (clave: string): string => `precio.${clave}`;

/** Precio base del producto en un mercado (centavos de su moneda base), o `undefined` si está «sin precio» ahí. */
export function precioDelProducto(p: ProductoPanel, clave: string): number | undefined {
  const precios = p.precioUSD;
  return Object.hasOwn(precios, clave) ? precios[clave] : undefined;
}

export function formInicial(p: ProductoPanel | null, mercados: readonly MercadoPrecio[]): FormProducto {
  const precios: Record<string, string> = {};
  for (const m of mercados) {
    const c = p === null ? undefined : precioDelProducto(p, m.clave);
    precios[m.clave] = c === undefined ? '' : centavosATexto(c);
  }
  return {
    nombre: p?.nombre ?? '', categoria: p?.categoria ?? '', marca: p?.marca ?? '', sku: p?.sku ?? '',
    garantia: p?.garantiaMeses === undefined ? '' : String(p.garantiaMeses), minimo: p?.minimo === undefined ? '' : String(p.minimo),
    costo: p?.costoUSD === undefined ? '' : centavosATexto(p.costoUSD), activo: p?.activo ?? true, conSerie: p?.conSerie ?? false, precios,
  };
}

/**
 * Lee un borrador guardado: se queda solo con los campos del formulario de hoy. Un borrador viejo que traiga `id` e `idEditado`
 * (el campo «Identificador» ya no existe) no se marca como modificado por eso.
 */
export function leerBorrador(v: FormProducto | null): FormProducto | null {
  if (v === null) return null;
  return {
    nombre: v.nombre, categoria: v.categoria, marca: v.marca, sku: v.sku, garantia: v.garantia, minimo: v.minimo, costo: v.costo,
    activo: v.activo, conSerie: v.conSerie, precios: v.precios,
  };
}

export const mismoForm = (a: FormProducto, b: FormProducto): boolean => JSON.stringify(a) === JSON.stringify(b);

const entero = (t: string): number | null => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : null);

export interface ContextoRevision {
  readonly nuevo: boolean;
  /** Mercados declarados por el comercio, en su orden. */
  readonly mercados: readonly MercadoPrecio[];
  /** Moneda de costo del comercio; ausente si no se entregó (no se nombra ninguna). */
  readonly monedaCosto?: CodigoMoneda | undefined;
  /** Claves de los mercados en que el producto que se edita ya está «sin precio»: ahí se puede dejar vacío. */
  readonly sinPrecio?: readonly string[];
  readonly existentes: readonly { readonly id: string; readonly sku: string }[];
}

/** Error del SKU de un producto nuevo (formato o repetido); `null` si está bien. No dice nada de un SKU vacío. */
export function errorDeSku(sku: string, existentes: readonly { readonly sku: string }[]): string | null {
  const t = sku.trim();
  if (t === '') return null;
  if (!SKU.test(t)) return 'Use letras, números, punto, guion o guion bajo, hasta 40 caracteres.';
  if (existentes.some((x) => x.sku === t)) return 'Ese SKU ya lo usa otro producto.';
  return null;
}

/** Aviso (no bloquea): otro producto tiene un SKU que solo difiere en mayúsculas. */
export function avisoDeSku(sku: string, existentes: readonly { readonly sku: string }[]): string | null {
  const t = sku.trim();
  if (!SKU.test(t)) return null;
  return existentes.some((x) => x.sku !== t && x.sku.toLowerCase() === t.toLowerCase()) ? PARECIDO_SKU : null;
}

export function revisarProducto(f: FormProducto, ctx: ContextoRevision): ErroresProducto {
  const e: Record<string, string> = {};
  const nombre = f.nombre.trim();
  if (nombre === '') e['nombre'] = 'Escriba el nombre del producto.';
  else if (nombre.length > TOPES_PRODUCTO.nombre) e['nombre'] = `Máximo ${String(TOPES_PRODUCTO.nombre)} caracteres.`;
  const categoria = f.categoria.trim();
  if (categoria === '') e['categoria'] = 'Escriba la categoría.';
  else if (categoria.length > TOPES_PRODUCTO.categoria) e['categoria'] = `Máximo ${String(TOPES_PRODUCTO.categoria)} caracteres.`;
  if (f.marca.trim().length > TOPES_PRODUCTO.marca) e['marca'] = `Máximo ${String(TOPES_PRODUCTO.marca)} caracteres.`;
  if (ctx.nuevo) {
    if (f.sku.trim() === '') e['sku'] = 'Escriba el SKU, el código con que identifica el producto.';
    else {
      const m = errorDeSku(f.sku, ctx.existentes);
      if (m !== null) e['sku'] = m;
    }
  }
  if (f.garantia.trim() !== '') {
    const g = entero(f.garantia);
    if (g === null || g < 1 || g > 120) e['garantia'] = 'Indique meses enteros, de 1 a 120, o déjela vacía.';
  }
  if (f.minimo.trim() !== '' && entero(f.minimo) === null) e['minimo'] = 'Indique un número entero desde 0, o déjelo vacío.';
  if (f.costo.trim() !== '') {
    const c = textoACentavos(f.costo);
    if (c === null) e['costo'] = montoEn(ctx.monedaCosto);
    else if (c > MAX_CENTAVOS) e['costo'] = 'El monto es demasiado alto.';
  }
  for (const m of ctx.mercados) {
    const t = f.precios[m.clave] ?? '';
    const c = textoACentavos(t);
    // Al editar, un mercado puede seguir sin precio solo si ya lo estaba; el alta exige todos y no se quita un precio existente.
    if (t.trim() === '') {
      if (ctx.nuevo || !(ctx.sinPrecio ?? []).includes(m.clave)) e[clavePrecio(m.clave)] = `Falta el precio de ${m.nombre}. Es obligatorio en cada mercado.`;
    } else if (c === null) e[clavePrecio(m.clave)] = montoEn(m.monedaBase);
    else if (c > MAX_CENTAVOS) e[clavePrecio(m.clave)] = 'El monto es demasiado alto.';
  }
  return e;
}

/** Precio en centavos por mercado declarado; un mercado vacío se omite (solo si ya estaba sin precio); `null` si alguno no es válido. */
export function preciosACentavos(f: FormProducto, mercados: readonly MercadoPrecio[]): PreciosPorMercado | null {
  const salida: Record<string, number> = {};
  for (const m of mercados) {
    if ((f.precios[m.clave] ?? '').trim() === '') continue;
    const c = textoACentavos(f.precios[m.clave] ?? '');
    if (c === null) return null;
    salida[m.clave] = c;
  }
  return salida;
}

/** Entrada de alta; solo con un formulario ya revisado. */
export function aEntrada(f: FormProducto, mercados: readonly MercadoPrecio[], id: string): EntradaProducto | null {
  const precioUSD = preciosACentavos(f, mercados);
  if (precioUSD === null) return null;
  const costo = f.costo.trim() === '' ? undefined : textoACentavos(f.costo);
  return {
    id, nombre: f.nombre.trim(), categoria: f.categoria.trim(), ...(f.marca.trim() !== '' ? { marca: f.marca.trim() } : {}), sku: f.sku.trim(), activo: f.activo, conSerie: f.conSerie,
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
export function cambiosDeEdicion(f: FormProducto, p: ProductoPanel, puedeEditarCosto: boolean, mercados: readonly MercadoPrecio[]): CambiosDeEdicion {
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
  const precios = preciosACentavos(f, mercados);
  const cambiaPrecio = precios !== null && mercados.some((m) => Object.hasOwn(precios, m.clave) && precios[m.clave] !== precioDelProducto(p, m.clave));
  if (precios !== null && cambiaPrecio) c.precioUSD = precios;
  return { cambios: c, vaciados, desactiva: p.activo && !f.activo };
}

/** «la marca y la garantía» / «la marca, la garantía y el costo». */
export function listaEnTexto(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1] ?? ''}`;
}

const CAMPO_DE_RUTA: Readonly<Record<string, string>> = { nombre: 'nombre', categoria: 'categoria', marca: 'marca', sku: 'sku', garantiaMeses: 'garantia', conSerie: 'conSerie', minimo: 'minimo', costoUSD: 'costo' };

/** El servidor dice que la clave interna elegida ya la tiene otro producto («El producto x ya existe»): se reintenta con otra. */
export const esProductoYaExiste = (e: unknown): boolean => e instanceof ErrorApi && /producto \S+ ya existe/i.test(e.message);

/** El campo al que corresponde un error del servidor, con su texto; `null` si no es de un campo (va como error general). */
export function errorDeServidor(e: unknown, mercados: readonly MercadoPrecio[]): { campo: string; texto: string } | null {
  if (!(e instanceof ErrorApi)) return null;
  if (esProductoYaExiste(e)) return null;
  if (/\bsku\b/i.test(e.message) && /uso|existe/i.test(e.message)) return { campo: 'sku', texto: 'Ese SKU ya lo usa otro producto.' };
  if (/(n[uú]mero de serie|conSerie)/i.test(e.message) && /movimientos?/i.test(e.message)) return { campo: 'conSerie', texto: 'No se puede cambiar: el producto ya tuvo movimientos.' };
  for (const ruta of e.detalle.campos ?? []) {
    const ultimo = ruta.split('.').pop() ?? '';
    const m = mercados.find((x) => x.clave === ultimo);
    if (m !== undefined && /precio/i.test(ruta)) return { campo: clavePrecio(m.clave), texto: `El servidor no aceptó el precio de ${m.nombre}. Revíselo.` };
    const campo = CAMPO_DE_RUTA[ultimo];
    if (campo !== undefined) return { campo, texto: 'El servidor no aceptó este dato. Revíselo.' };
  }
  return null;
}
