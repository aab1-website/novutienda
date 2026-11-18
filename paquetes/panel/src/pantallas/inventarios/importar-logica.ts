import type { CodigoMoneda, ErrorFilaImportacion, FilaSimulada, MercadoDeclarado, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { formatoBytes } from '../../util/base64.js';
import { nombreMoneda } from './nombres.js';

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

const ANTES_DE_PRECIOS: readonly ColumnaDoc[] = [
  { nombre: 'nombre', texto: 'nombre del producto.' },
  { nombre: 'categoria', texto: 'categoría.' },
  { nombre: 'marca', texto: 'marca (opcional).' },
  { nombre: 'sku', texto: 'código del producto. Cada producto se reconoce por su SKU: si ya existe se actualiza y, si no, se crea. Obligatorio en cada fila.' },
  { nombre: 'conSerie', texto: 'si, no (si cada unidad lleva número de serie).' },
  { nombre: 'garantiaMeses', texto: 'meses de garantía (opcional).' },
  { nombre: 'minimo', texto: 'existencia mínima antes de avisar (opcional).' },
];
const DESPUES_DE_PRECIOS: readonly ColumnaDoc[] = [
  { nombre: 'activo', texto: 'si, no.' },
  { nombre: 'publicado', texto: 'si, no.' },
];

/** Importe con hasta 2 decimales, en la moneda indicada («en dólares con hasta 2 decimales»). */
const importeEn = (moneda: CodigoMoneda | undefined): string => `${moneda === undefined ? '' : `en ${nombreMoneda(moneda)} `}con hasta 2 decimales`;

/**
 * Columnas del archivo, en el orden de la exportación (que a su vez sirve de plantilla): una columna de precio por cada
 * mercado declarado por el comercio (`precio<ID>`, en la moneda base del mercado) y el costo en la moneda de costo del
 * comercio (`monedaCosto`; si no se conoce, no se nombra ninguna). La primera columna de precio lleva el ejemplo.
 */
export function columnasArchivo(mercados: readonly MercadoDeclarado[], monedaCosto?: CodigoMoneda): readonly ColumnaDoc[] {
  const precios = mercados.map((m, i): ColumnaDoc => ({
    nombre: `precio${m.id}`,
    texto: `precio del mercado de ${m.nombre}, ${importeEn(m.monedaBase)}${i === 0 ? ' (por ejemplo 1234.50)' : ''}.`,
  }));
  return [...ANTES_DE_PRECIOS, ...precios, { nombre: 'costo', texto: `costo ${importeEn(monedaCosto)} (opcional).` }, ...DESPUES_DE_PRECIOS];
}

/** Cierre de la lista de columnas: en qué moneda van los precios. */
export function notaPrecios(mercados: readonly MercadoDeclarado[]): string {
  const bases = [...new Set(mercados.map((m) => m.monedaBase))];
  return bases.length === 1 ? `Los precios van en ${nombreMoneda(bases[0] as string)}, con decimales.` : 'Cada precio va en la moneda base de su mercado, con decimales.';
}

/** Solo en la carga inicial. */
export const COLUMNAS_STOCK: readonly ColumnaDoc[] = [
  { nombre: 'stockTienda', texto: 'existencias iniciales en la Tienda.' },
  { nombre: 'stockDeposito1', texto: 'existencias iniciales en el Depósito 1.' },
  { nombre: 'stockDeposito2', texto: 'existencias iniciales en el Depósito 2.' },
];

export const encabezadosPlantilla = (cargaInicial: boolean, mercados: readonly MercadoDeclarado[], monedaCosto?: CodigoMoneda): string[] =>
  [...columnasArchivo(mercados, monedaCosto), ...(cargaInicial ? COLUMNAS_STOCK : [])].map((c) => c.nombre);

/** Lo que la pantalla muestra de una fila: el nombre y el SKU del producto, nunca su clave interna. */
export function datosDeFila(f: FilaSimulada): { nombre: string; sku: string } {
  const g = f as FilaSimulada & { readonly nombre?: string; readonly sku?: string };
  return { nombre: g.nombre ?? '', sku: g.sku ?? '' };
}

export const ACCION_TEXTO: Readonly<Record<FilaSimulada['accion'], string>> = {
  crear: 'Se creará', actualizar: 'Se actualizará', 'sin-cambios': 'Sin cambios', error: 'Con error',
};

const RANGO: Readonly<Record<FilaSimulada['accion'], number>> = { error: 0, actualizar: 1, crear: 2, 'sin-cambios': 3 };

/** Errores primero (lo que hay que corregir), después lo que cambia y al final lo que no. Dentro de cada grupo, por línea. */
export function ordenarFilas(filas: readonly FilaSimulada[]): FilaSimulada[] {
  return [...filas].sort((a, b) => RANGO[a.accion] - RANGO[b.accion] || a.linea - b.linea);
}

/** `primera`: línea del archivo donde el SKU apareció antes (solo para el motivo «sku repetido»). */
export function textoError(e: ErrorFilaImportacion, primera?: number): string {
  if (e.columna === 'sku' && /repetido/i.test(e.motivo)) {
    return primera === undefined ? 'Este SKU ya aparece en otra fila del archivo; deje una sola fila por producto.' : `Este SKU ya aparece en la fila ${String(primera)} del archivo; deje una sola fila por producto.`;
  }
  return e.columna === null ? e.motivo : `Columna «${e.columna}»: ${e.motivo}`;
}

/** Línea de la primera fila del archivo con el mismo SKU que `f` (la que quedó antes), si existe. */
export function lineaPrevia(filas: readonly FilaSimulada[], f: FilaSimulada): number | undefined {
  const sku = datosDeFila(f).sku;
  if (sku === '') return undefined;
  return filas.filter((x) => x.linea < f.linea && datosDeFila(x).sku === sku).map((x) => x.linea).sort((a, b) => a - b)[0];
}

/** Texto del botón principal y su motivo cuando no hay nada que aplicar. */
export const textoBotonImportar = (n: number): string => (n === 0 ? 'Nada que importar' : `Importar ${String(n)} ${n === 1 ? 'fila' : 'filas'}`);

/** Por qué no hay nada que aplicar, según el caso. */
export function motivoSinAplicar(s: Simulacion['resumen']): string {
  if (s.sinCambios > 0 && s.errores === 0) {
    return `${s.sinCambios === 1 ? 'La fila válida ya está igual' : `Las ${String(s.sinCambios)} filas válidas ya están iguales`} en el inventario: no hay nada que cambiar.`;
  }
  if (s.sinCambios > 0) {
    return `${s.sinCambios === 1 ? 'La fila válida ya está igual' : `Las ${String(s.sinCambios)} filas válidas ya están iguales`} en el inventario: no hay nada que cambiar. Corrija las filas con error.`;
  }
  return 'No hay filas para crear ni actualizar.';
}

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

/** Mensaje cuando el archivo no es el del intento anterior (el servidor reconoce la importación por su contenido). */
export const TEXTO_ARCHIVO_CAMBIO = 'El archivo cambió desde el intento anterior: empiece de nuevo con una importación nueva.';

/** Aviso cuando el servidor no importó nada porque los datos cambiaron desde la simulación. */
export const TEXTO_DESACTUALIZADA = 'Los datos cambiaron desde la simulación. Revise la simulación nueva antes de importar.';

/**
 * Traduce el motivo de detención del servidor a algo que una persona pueda actuar: qué pasó y qué hacer. Nunca deja pasar
 * identificadores técnicos («operacionId», el código de la operación).
 */
export function textoDetencion(detencion: string | undefined): string {
  const d = (detencion ?? '').trim();
  if (/otro contenido|otros datos/i.test(d)) return TEXTO_ARCHIVO_CAMBIO;
  if (/tiempo de la llamada/i.test(d)) return 'Se agotó el tiempo de espera. Pulse «Continuar la importación» para seguir con lo que falta.';
  const sinTecnico = d
    .replace(/;?\s*repita con el mismo operacionId[^.]*\.?/i, '')
    .replace(/\boperacionId\b/gi, '')
    .replace(/La operación \S+ /i, 'La operación ')
    .trim()
    .replace(/[;:,]\s*$/, '');
  const tanda = /^Tanda (\d+) de (\d+):\s*(.*)$/i.exec(sinTecnico);
  const causa = tanda === null ? sinTecnico : (tanda[3] ?? '').trim();
  const donde = tanda === null ? '' : ` en la tanda ${tanda[1] ?? ''} de ${tanda[2] ?? ''}`;
  const problema = causa === '' ? `Hubo un problema${donde}.` : `Hubo un problema${donde}: ${causa.replace(/\.$/, '')}.`;
  return `${problema} Pulse «Continuar la importación» para seguir con lo que falta; si se repite, avise al administrador.`;
}

/** Líneas con error de una simulación, en orden. */
export const lineasConError = (s: Simulacion): number[] => s.filas.filter((f) => f.accion === 'error').map((f) => f.linea).sort((a, b) => a - b);

const textoLineas = (l: readonly number[]): string => (l.length === 0 ? 'ninguna' : l.join(', '));

export interface AvisoOmitidas {
  /** Qué se omitió, exacto: cuántas y cuáles líneas. */
  readonly texto: string;
  /** Lo omitido no coincide con lo que la persona aceptó en la confirmación: va destacado. */
  readonly difiere: string | null;
}

/**
 * Cuando la importación real omitió filas con error: cuántas y cuáles líneas, y si no coincide con lo aceptado en la
 * confirmación (`aceptadas`: las líneas con error de la simulación que la persona vio).
 */
export function avisoOmitidas(r: ResultadoImportacion, aceptadas: readonly number[]): AvisoOmitidas | null {
  const omitidas = lineasConError(r.simulacion);
  if (r.omitidas === 0 && omitidas.length === 0 && aceptadas.length === 0) return null;
  const texto = `Se omitieron ${plural(r.omitidas, 'fila con error', 'filas con error')} (líneas del archivo: ${textoLineas(omitidas)}). No entraron al inventario: corríjalas y súbalas en otro archivo.`;
  const mismas = omitidas.length === aceptadas.length && omitidas.every((l, i) => l === aceptadas[i]);
  const difiere = r.omitidas === aceptadas.length && mismas
    ? null
    : `Atención: usted aceptó omitir ${plural(aceptadas.length, 'fila', 'filas')} (líneas: ${textoLineas(aceptadas)}) y el servidor omitió ${String(r.omitidas)} (líneas: ${textoLineas(omitidas)}). Revise ese resultado antes de seguir.`;
  return { texto, difiere };
}
