import type { ErrorFilaImportacion, FilaSimulada, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { formatoBytes } from '../../util/base64.js';

/** Lógica pura de la importación de productos (la pantalla es `importar.tsx`). */

export const MAX_BYTES_ARCHIVO = 2 * 1024 * 1024;
export const MAX_FILAS = 1000;
export const EXTENSIONES = ['csv', 'xlsx'] as const;
export const ACEPTA_ARCHIVO = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Revisión previa del archivo, antes de leerlo: tipo (por extensión; el servidor distingue por la firma) y tamaño. */
export function validarArchivo(a: { readonly name: string; readonly size: number }): string | null {
  const ext = a.name.includes('.') ? a.name.slice(a.name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (ext === 'xls') return 'Los archivos .xls (Excel antiguo) no se admiten. Guárdelo como .xlsx o como .csv.';
  if (!(EXTENSIONES as readonly string[]).includes(ext)) return 'Solo se admiten archivos CSV (.csv) o Excel (.xlsx).';
  if (a.size === 0) return 'El archivo está vacío.';
  if (a.size > MAX_BYTES_ARCHIVO) return `El archivo pesa ${formatoBytes(a.size)} y el máximo es ${formatoBytes(MAX_BYTES_ARCHIVO)}.`;
  return null;
}

export interface ColumnaDoc {
  readonly nombre: string;
  readonly texto: string;
}

/** Columnas del archivo, en el orden de la exportación (que a su vez sirve de plantilla). */
export const COLUMNAS_ARCHIVO: readonly ColumnaDoc[] = [
  { nombre: 'id', texto: 'identificador del producto (letras minúsculas, números y guiones). Es lo que une cada fila con un producto.' },
  { nombre: 'nombre', texto: 'nombre del producto.' },
  { nombre: 'categoria', texto: 'categoría.' },
  { nombre: 'marca', texto: 'marca (opcional).' },
  { nombre: 'sku', texto: 'código del producto. Obligatorio en una fila nueva: sin SKU, la fila es un error.' },
  { nombre: 'conSerie', texto: 'si, no (si cada unidad lleva número de serie).' },
  { nombre: 'garantiaMeses', texto: 'meses de garantía (opcional).' },
  { nombre: 'minimo', texto: 'existencia mínima antes de avisar (opcional).' },
  { nombre: 'precioBO', texto: 'precio del mercado de Bolivia, en dólares con hasta 2 decimales (por ejemplo 1234.50).' },
  { nombre: 'precioAR', texto: 'precio del mercado de Argentina, en dólares con hasta 2 decimales.' },
  { nombre: 'costo', texto: 'costo en dólares con hasta 2 decimales (opcional).' },
  { nombre: 'activo', texto: 'si, no.' },
  { nombre: 'publicado', texto: 'si, no.' },
];

/** Solo en la carga inicial. */
export const COLUMNAS_STOCK: readonly ColumnaDoc[] = [
  { nombre: 'stockTienda', texto: 'existencias iniciales en la Tienda.' },
  { nombre: 'stockDeposito1', texto: 'existencias iniciales en el Depósito 1.' },
  { nombre: 'stockDeposito2', texto: 'existencias iniciales en el Depósito 2.' },
];

export const encabezadosPlantilla = (cargaInicial: boolean): string[] => [...COLUMNAS_ARCHIVO, ...(cargaInicial ? COLUMNAS_STOCK : [])].map((c) => c.nombre);

export const ACCION_TEXTO: Readonly<Record<FilaSimulada['accion'], string>> = {
  crear: 'Se creará', actualizar: 'Se actualizará', 'sin-cambios': 'Sin cambios', error: 'Con error',
};

const RANGO: Readonly<Record<FilaSimulada['accion'], number>> = { error: 0, actualizar: 1, crear: 2, 'sin-cambios': 3 };

/** Errores primero (lo que hay que corregir), después lo que cambia y al final lo que no. Dentro de cada grupo, por línea. */
export function ordenarFilas(filas: readonly FilaSimulada[]): FilaSimulada[] {
  return [...filas].sort((a, b) => RANGO[a.accion] - RANGO[b.accion] || a.linea - b.linea);
}

export const textoError = (e: ErrorFilaImportacion): string => (e.columna === null ? e.motivo : `Columna «${e.columna}»: ${e.motivo}`);

const plural = (n: number, uno: string, varios: string): string => `${String(n)} ${n === 1 ? uno : varios}`;

/** «3 se crearán, 2 se actualizarán, 5 sin cambios, 1 con error». */
export function resumenSimulacion(s: Simulacion['resumen']): string {
  return [
    `${String(s.crear)} ${s.crear === 1 ? 'se creará' : 'se crearán'}`,
    `${String(s.actualizar)} ${s.actualizar === 1 ? 'se actualizará' : 'se actualizarán'}`,
    `${String(s.sinCambios)} sin cambios`,
    `${String(s.errores)} con error`,
  ].join(', ');
}

/** Filas que una importación aplicaría (crear y actualizar). */
export const aplicables = (s: Simulacion['resumen']): number => s.crear + s.actualizar;

/** Qué dice el diálogo de confirmación. */
export function lineasConfirmacion(s: Simulacion, omitir: boolean, cargaInicial: boolean): string[] {
  const l = [`${resumenSimulacion(s.resumen)}.`];
  if (omitir) l.push(`Se importan las filas válidas y se omiten ${plural(s.resumen.errores, 'fila con error', 'filas con error')}: esas no entran al inventario.`);
  if (cargaInicial) l.push('Es la carga inicial: las columnas de existencias sí suman stock a los productos nuevos.');
  else l.push('El archivo no modifica el stock.');
  l.push('Las filas se aplican por tandas; si alguna falla, lo ya aplicado queda y se puede continuar.');
  return l;
}

export function textoResultado(r: ResultadoImportacion): string {
  const partes = [plural(r.creados, 'producto creado', 'productos creados'), plural(r.actualizados, 'actualizado', 'actualizados'), `${String(r.sinCambios)} sin cambios`];
  if (r.omitidas > 0) partes.push(plural(r.omitidas, 'fila omitida por error', 'filas omitidas por error'));
  return partes.join(', ');
}

export const textoTandas = (r: ResultadoImportacion): string => `${String(r.lotes.aplicados)} de ${String(r.lotes.total)} ${r.lotes.total === 1 ? 'tanda aplicada' : 'tandas aplicadas'}`;
