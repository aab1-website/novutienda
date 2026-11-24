// Descarga total del inventario en hojas (para un libro de Excel): funciones puras, sin lectura de base. El servidor reúne los
// datos (`llamadas/inventarios.ts`, acción `exportarTotal`) y el panel escribe el .xlsx. Las celdas van SIN neutralizar: el
// escritor del .xlsx neutraliza todo texto que empiece con = + - @, y la importación lo deshace.
import { aCentavos, monedaCostoDe, precioDeMercado, type ConfiguracionComercial } from '@novutienda/nucleo';
import { claveDePrecio } from './comercial.js';
import { centavosAUsd, columnasDeExportacion, type ProductoExportable } from './importacion.js';

/** Últimos movimientos que entran al archivo. */
export const MAX_MOVIMIENTOS_EXPORTACION = 5_000;
/** Unidades con serie que se leen para el archivo. */
export const MAX_SERIES_EXPORTACION = 20_000;

/** Nombres de las hojas, en el orden del libro: Productos va primera para que reimportar el archivo siga funcionando. */
export const HOJAS_EXPORTACION_TOTAL = ['Productos', 'Existencias por almacén', 'Series', 'Movimientos', 'Costos y márgenes'] as const;

export type CeldaTotal = string | number;
export interface HojaTotal {
  readonly nombre: string;
  readonly filas: readonly (readonly CeldaTotal[])[];
}

export interface AlmacenTotal { readonly id: string; readonly nombre: string }
export interface ExistenciaTotal { readonly productoId: string; readonly ubicacionId: string; readonly cantidad: number }
export interface UnidadTotal { readonly productoId: string; readonly serie: string; readonly estado: string; readonly ubicacionId: string; readonly garantiaHasta?: string }
export interface MovimientoTotal {
  readonly fecha: string;
  readonly tipo: string;
  readonly productoId: string;
  readonly ubicacionId: string;
  readonly delta: number;
  readonly referencia?: string;
}
/** Tipo de cambio que rige hoy en un mercado (`valor` = unidades de la moneda de venta por una de la base). */
export interface CotizacionTotal { readonly par: string; readonly valor: number; readonly fecha: string }

export interface EntradaExportacionTotal {
  readonly productos: readonly ProductoExportable[];
  readonly comercial: ConfiguracionComercial;
  readonly almacenes: readonly AlmacenTotal[];
  readonly existencias: readonly ExistenciaTotal[];
  readonly unidades: readonly UnidadTotal[];
  /** Los más recientes primero; la hoja los escribe tal cual. */
  readonly movimientos: readonly MovimientoTotal[];
  /** Por id de mercado; ausente si el mercado no tiene tipo de cambio o no hay uno utilizable. */
  readonly cotizaciones: Readonly<Record<string, CotizacionTotal | undefined>>;
}

const si = (v: boolean): string => (v ? 'sí' : 'no');
const porTexto = (a: string, b: string): number => a.localeCompare(b, 'es');

function hojaProductos(e: EntradaExportacionTotal): HojaTotal {
  const claves = e.comercial.mercados.map((m) => claveDePrecio(m.id));
  const filas = e.productos.map((p) => [
    p.nombre, p.categoria, p.marca ?? '', p.sku, si(p.conSerie), p.garantiaMeses?.toString() ?? '', p.minimo?.toString() ?? '',
    ...claves.map((k) => (p.precioUSD[k] === undefined ? '' : centavosAUsd(p.precioUSD[k]))),
    p.costoUSD === undefined ? '' : centavosAUsd(p.costoUSD), si(p.activo), si(p.publicado),
  ]);
  return { nombre: HOJAS_EXPORTACION_TOTAL[0], filas: [columnasDeExportacion(e.comercial), ...filas] };
}

export function armarExportacionTotal(e: EntradaExportacionTotal): readonly HojaTotal[] {
  const producto = new Map(e.productos.map((p) => [p.id, p]));
  const nombreDe = (id: string): string => producto.get(id)?.nombre ?? id;
  const almacen = new Map(e.almacenes.map((a) => [a.id, a.nombre]));
  const almacenDe = (id: string): string => almacen.get(id) ?? id;

  const existencias = [...e.existencias]
    .sort((a, b) => porTexto(nombreDe(a.productoId), nombreDe(b.productoId)) || porTexto(a.ubicacionId, b.ubicacionId))
    .map((x) => [nombreDe(x.productoId), producto.get(x.productoId)?.sku ?? '', almacenDe(x.ubicacionId), x.cantidad]);

  const series = [...e.unidades]
    .sort((a, b) => porTexto(nombreDe(a.productoId), nombreDe(b.productoId)) || porTexto(a.serie, b.serie))
    .map((u) => [nombreDe(u.productoId), u.serie, u.estado, almacenDe(u.ubicacionId), u.garantiaHasta ?? '']);

  const movimientos = e.movimientos.map((m) => [m.fecha, m.tipo, nombreDe(m.productoId), almacenDe(m.ubicacionId), m.delta, m.referencia ?? '']);

  return [
    hojaProductos(e),
    { nombre: HOJAS_EXPORTACION_TOTAL[1], filas: [['Producto', 'SKU', 'Almacén', 'Cantidad'], ...existencias] },
    { nombre: HOJAS_EXPORTACION_TOTAL[2], filas: [['Producto', 'Serie', 'Estado', 'Almacén', 'Fin de garantía'], ...series] },
    { nombre: HOJAS_EXPORTACION_TOTAL[3], filas: [['Fecha', 'Tipo', 'Producto', 'Almacén', 'Cantidad', 'Referencia'], ...movimientos] },
    hojaMargenes(e),
  ];
}

const ENCABEZADO_MARGENES = [
  'Producto', 'SKU', 'Mercado', 'Moneda de venta', 'Precio de venta', 'Moneda del costo', 'Costo', 'Costo en moneda de venta', 'Margen (%)', 'Tipo de cambio', 'Fecha del tipo de cambio', 'Nota',
] as const;

/**
 * Margen por mercado, en la moneda de venta: el costo (moneda de costo del comercio) se convierte con el tipo de cambio de HOY
 * del mercado, y la hoja anota su valor y fecha. Solo se convierte lo que se puede sin suponer: costo ya en la moneda de venta,
 * o en la moneda base del mercado (se multiplica por el tipo de cambio). En otro caso la fila queda sin margen, con su nota.
 */
function hojaMargenes(e: EntradaExportacionTotal): HojaTotal {
  const monedaCosto = monedaCostoDe(e.comercial);
  const filas: CeldaTotal[][] = [];
  for (const p of e.productos) {
    for (const m of e.comercial.mercados) {
      const base = p.precioUSD[claveDePrecio(m.id)];
      if (base === undefined) continue;
      const cot = e.cotizaciones[m.id];
      const precio = precioDeMercado(base / 100, m, cot === undefined ? null : { par: cot.par, valor: cot.valor });
      const fila = (precioTxt: string, costoConv: string, margen: CeldaTotal, nota: string): CeldaTotal[] => [
        p.nombre, p.sku, m.nombre, m.monedaVenta, precioTxt, monedaCosto, p.costoUSD === undefined ? '' : centavosAUsd(p.costoUSD), costoConv, margen,
        cot === undefined ? '' : cot.valor.toString(), cot === undefined ? '' : cot.fecha, nota,
      ];
      if (precio.tipo !== 'precio') {
        filas.push(fila('', '', '', precio.tipo === 'invalido' && m.tipoCambio != null && cot === undefined ? 'Sin tipo de cambio vigente' : 'Sin precio'));
        continue;
      }
      if (p.costoUSD === undefined) { filas.push(fila(centavosAUsd(precio.centavos), '', '', 'Sin costo')); continue; }
      let costoConv: number | null = null;
      if (monedaCosto === m.monedaVenta) costoConv = p.costoUSD;
      else if (monedaCosto === m.monedaBase && cot !== undefined) costoConv = aCentavos((p.costoUSD / 100) * cot.valor);
      if (costoConv === null) { filas.push(fila(centavosAUsd(precio.centavos), '', '', `El costo está en ${monedaCosto} y no se puede llevar a ${m.monedaVenta}`)); continue; }
      const margen = ((precio.centavos - costoConv) / precio.centavos) * 100;
      filas.push(fila(centavosAUsd(precio.centavos), centavosAUsd(costoConv), Math.round(margen * 10) / 10, ''));
    }
  }
  return { nombre: HOJAS_EXPORTACION_TOTAL[4], filas: [[...ENCABEZADO_MARGENES], ...filas] };
}

