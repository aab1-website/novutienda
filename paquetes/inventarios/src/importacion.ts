import type { CambioProductoCambiado, TransaccionIdentidad } from '@novutienda/nucleo';
import { EntradaInvalida, ErrorInventario, SinPermiso } from './errores.js';
import { esProductoId, esSku, exigirSegmento, exigirTenant, UBICACIONES } from './ids.js';
import { Lector, type Autor, type Datos } from './motor.js';
import { ejecutarOperacion, exigirAutor, PERMISOS, type ResultadoOperacion } from './operacion.js';
import { leerCupo, prepararEdicion, prepararProductoNuevo, reservarLimite, validarEntradaProducto, type CambiosProducto, type EntradaProducto, type ProductoValido } from './productos.js';

export const MAX_BYTES_CSV = 256 * 1024;

/** Neutraliza una celda que un programa de planillas interpretaría como fórmula (= + - @, tab, CR). */
export const neutralizarCelda = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** Analiza CSV (RFC 4180): comas, comillas dobles, saltos de línea dentro de comillas. */
export function analizarCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entre = false;
  let hayCelda = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i] as string;
    if (entre) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else entre = false;
      } else celda += c;
    } else if (c === '"' && celda === '') {
      entre = true;
      hayCelda = true;
    } else if (c === ',') {
      fila.push(celda);
      celda = '';
      hayCelda = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      if (hayCelda || celda !== '') fila.push(celda);
      if (fila.length > 0) filas.push(fila);
      fila = [];
      celda = '';
      hayCelda = false;
    } else celda += c;
  }
  if (entre) throw new EntradaInvalida('CSV con comillas sin cerrar');
  if (hayCelda || celda !== '') fila.push(celda);
  if (fila.length > 0) filas.push(fila);
  return filas;
}

/** Máximo de filas de datos de una importación (el encabezado no cuenta). */
export const MAX_FILAS_IMPORTACION = 1000;
/** Escrituras que se admiten por transacción de importación (Firestore permite 500; queda margen para el registro). */
const PRESUPUESTO_ESCRITURAS = 400;

type Columna =
  | 'id' | 'nombre' | 'categoria' | 'marca' | 'sku' | 'conSerie' | 'activo' | 'publicado' | 'garantiaMeses' | 'minimo'
  | 'precioBO' | 'precioAR' | 'costoUSD' | 'stockTienda' | 'stockDeposito1' | 'stockDeposito2';
type Unidad = 'centavos' | 'usd';

/**
 * Encabezados admitidos (se comparan sin tildes, mayúsculas ni signos). Los dos formatos anteriores siguen valiendo:
 * `precioUSDbo`, `precioUSDar` y `costoUSD` van en centavos enteros (formato de Inventarios y de su exportación);
 * `precioBO`, `precioAR`, `costo` (y `precio_bo`, `precioBOusd`...) van en USD con hasta 2 decimales (formato de la consola
 * y de la exportación).
 */
const ALIAS: Readonly<Record<string, readonly [Columna, Unidad | null]>> = {
  id: ['id', null], codigo: ['id', null], nombre: ['nombre', null], categoria: ['categoria', null], marca: ['marca', null], sku: ['sku', null],
  conserie: ['conSerie', null], activo: ['activo', null], publicado: ['publicado', null],
  garantiameses: ['garantiaMeses', null], garantia: ['garantiaMeses', null], minimo: ['minimo', null],
  preciousdbo: ['precioBO', 'centavos'], preciousdar: ['precioAR', 'centavos'],
  preciobo: ['precioBO', 'usd'], preciobousd: ['precioBO', 'usd'], precioar: ['precioAR', 'usd'], precioarusd: ['precioAR', 'usd'],
  costousd: ['costoUSD', 'centavos'], costo: ['costoUSD', 'usd'],
  stocktienda: ['stockTienda', null], stockdeposito1: ['stockDeposito1', null], stockdeposito2: ['stockDeposito2', null],
};
const COLUMNAS_STOCK = { stockTienda: UBICACIONES[0], stockDeposito1: UBICACIONES[1], stockDeposito2: UBICACIONES[2] } as const;
/** Nombres que sugieren stock pero no son columnas de carga: se avisa que se ignoran. */
const SUENA_A_STOCK = new Set(['stock', 'existencias', 'existencia', 'cantidad', 'almacen', 'ubicacion', 'deposito', 'tienda']);

const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Texto CSV o matriz de texto ya leída (de CSV o de la primera hoja de un xlsx: ver `leerArchivoImportacion`). */
export type FuenteTabla = string | readonly (readonly string[])[];

export interface ErrorFila {
  /** Encabezado de la columna tal como viene en el archivo; `null` si el error es de la fila entera. */
  readonly columna: string | null;
  readonly motivo: string;
}

interface DatosFila {
  nombre?: string;
  categoria?: string;
  marca?: string;
  sku?: string;
  conSerie?: boolean;
  activo?: boolean;
  publicado?: boolean;
  garantiaMeses?: number;
  minimo?: number;
  /** Centavos de USD. */
  bo?: number;
  ar?: number;
  costoUSD?: number;
}

export interface FilaLeida {
  /** Número de línea del archivo (el encabezado es la 1). */
  readonly linea: number;
  readonly id: string;
  readonly datos: DatosFila;
  readonly stock: readonly { readonly ubicacionId: string; readonly cantidad: number }[];
  readonly errores: readonly ErrorFila[];
  readonly advertencias: readonly string[];
}

export interface LecturaCsv {
  readonly filas: readonly FilaLeida[];
  readonly columnasIgnoradas: readonly string[];
}

const SI = new Set(['si', 'sí', 'true', '1', 'verdadero', 'x']);
const NO = new Set(['no', 'false', '0', 'falso']);
const TEXTO_OK = (v: string, max: number): boolean => v.length <= max && !/[<>]/.test(v) && ![...v].some((c) => (c.codePointAt(0) ?? 0) < 32);

/** Convierte un importe a centavos enteros: `centavos` exige un entero; `usd` admite hasta 2 decimales (coma o punto). */
function importe(v: string, unidad: Unidad): number | undefined {
  if (unidad === 'centavos') return /^\d{1,11}$/.test(v) && Number(v) <= 100_000_000_00 ? Number(v) : undefined;
  const m = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(v);
  if (m === null) return undefined;
  const c = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return c <= 100_000_000_00 ? c : undefined;
}

/**
 * Lee el CSV. Los errores de encabezado, tamaño o formato general lanzan `EntradaInvalida`; los errores de cada fila
 * (formato de una celda) se anotan en la fila para que la simulación los informe todos juntos.
 */
export function leerCsvFilas(fuente: FuenteTabla, cargaInicial: boolean): LecturaCsv {
  let filas: readonly (readonly string[])[];
  if (typeof fuente === 'string') {
    if (fuente.length === 0 || fuente.length > MAX_BYTES_CSV) throw new EntradaInvalida('CSV vacío o demasiado grande');
    filas = analizarCsv(fuente.charCodeAt(0) === 0xfeff ? fuente.slice(1) : fuente);
  } else {
    // Una hoja de cálculo puede traer filas más cortas (celdas finales vacías): se completan con vacío.
    const ancho = Math.max(0, ...fuente.slice(0, 1).map((f) => f.length));
    filas = fuente.map((f) => (f.length < ancho ? [...f, ...Array<string>(ancho - f.length).fill('')] : f));
  }
  const [cab, ...datos] = filas;
  if (cab === undefined) throw new EntradaInvalida('CSV sin encabezado');
  const indice = new Map<Columna, { i: number; etiqueta: string; unidad: Unidad | null }>();
  const ignoradas: string[] = [];
  for (const [i, h] of cab.entries()) {
    const n = normalizar(h);
    const alias = ALIAS[n];
    if (alias === undefined) {
      if (n !== '') ignoradas.push(SUENA_A_STOCK.has(n) ? `${h} (el CSV no modifica el stock salvo en la carga inicial, con stockTienda, stockDeposito1 y stockDeposito2)` : h);
      continue;
    }
    if (indice.has(alias[0])) throw new EntradaInvalida(`columna repetida: ${h}`);
    indice.set(alias[0], { i, etiqueta: h, unidad: alias[1] });
  }
  if (!indice.has('id')) throw new EntradaInvalida('falta la columna id');
  const conStock = (Object.keys(COLUMNAS_STOCK) as Columna[]).filter((c) => indice.has(c));
  if (!cargaInicial && conStock.length > 0) throw new EntradaInvalida('El CSV no toca el stock: las columnas de stock solo se admiten en la carga inicial');
  if (datos.length < 1 || datos.length > MAX_FILAS_IMPORTACION) throw new EntradaInvalida(`El CSV debe tener entre 1 y ${String(MAX_FILAS_IMPORTACION)} filas`);

  const salida: FilaLeida[] = [];
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const [k, f] of datos.entries()) {
    const linea = k + 2;
    if (f.every((x) => x.trim() === '')) continue;
    const errores: ErrorFila[] = [];
    const advertencias: string[] = [];
    const d: DatosFila = {};
    const stock: { ubicacionId: string; cantidad: number }[] = [];
    if (f.length !== cab.length) errores.push({ columna: null, motivo: 'el número de columnas no coincide con el encabezado' });
    const celda = (c: Columna): string | undefined => {
      const x = indice.get(c);
      const v = x === undefined ? undefined : (f[x.i] ?? '').trim();
      return v === undefined || v === '' ? undefined : v;
    };
    const err = (c: Columna, motivo: string): void => {
      errores.push({ columna: indice.get(c)?.etiqueta ?? c, motivo });
    };
    const id = celda('id') ?? '';
    if (!esProductoId(id)) err('id', 'id inválido (minúsculas, números y guiones, 2 a 60 caracteres)');
    else if (ids.has(id)) err('id', 'id repetido en el archivo');
    ids.add(id);
    for (const [c, max] of [['nombre', 120], ['categoria', 60], ['marca', 60]] as const) {
      const v = celda(c);
      if (v === undefined) continue;
      if (!TEXTO_OK(v, max)) {
        err(c, `texto inválido (máximo ${String(max)} caracteres, sin < ni >)`);
        continue;
      }
      const n = neutralizarCelda(v);
      if (n !== v) advertencias.push(`${c}: empieza con un carácter de fórmula; se guardó con «'» delante`);
      d[c] = n;
    }
    const sku = celda('sku');
    if (sku !== undefined) {
      if (!esSku(sku)) err('sku', 'sku inválido');
      else if (skus.has(sku)) err('sku', 'sku repetido en el archivo');
      else {
        d.sku = sku;
        skus.add(sku);
      }
    }
    for (const c of ['conSerie', 'activo', 'publicado'] as const) {
      const v = celda(c);
      if (v === undefined) continue;
      const a = v.toLowerCase();
      if (SI.has(a)) d[c] = true;
      else if (NO.has(a)) d[c] = false;
      else err(c, 'use sí o no (true o false)');
    }
    const gar = celda('garantiaMeses');
    if (gar !== undefined) {
      if (!/^\d{1,3}$/.test(gar) || Number(gar) < 1 || Number(gar) > 120) err('garantiaMeses', 'entero de 1 a 120');
      else d.garantiaMeses = Number(gar);
    }
    const min = celda('minimo');
    if (min !== undefined) {
      if (!/^\d{1,10}$/.test(min) || Number(min) > 1_000_000_000) err('minimo', 'entero no negativo');
      else d.minimo = Number(min);
    }
    for (const [c, destino] of [['precioBO', 'bo'], ['precioAR', 'ar'], ['costoUSD', 'costoUSD']] as const) {
      const v = celda(c);
      if (v === undefined) continue;
      const unidad = indice.get(c)?.unidad ?? 'centavos';
      const n = importe(v, unidad);
      if (n === undefined) err(c, unidad === 'centavos' ? 'importe en centavos de USD: entero sin signos ni fórmulas' : 'importe en USD, hasta 2 decimales, sin signos ni fórmulas');
      else d[destino] = n;
    }
    for (const [c, ubicacionId] of Object.entries(COLUMNAS_STOCK) as [Columna, string][]) {
      const v = celda(c);
      if (v === undefined) continue;
      if (!/^\d{1,7}$/.test(v) || Number(v) > 1_000_000) err(c, 'entero no negativo (máximo 1.000.000)');
      else if (Number(v) > 0) stock.push({ ubicacionId, cantidad: Number(v) });
    }
    salida.push({ linea, id, datos: d, stock, errores, advertencias });
  }
  return { filas: salida, columnasIgnoradas: ignoradas };
}

export interface FilaImportada {
  readonly producto: EntradaProducto;
  readonly stock: readonly { readonly ubicacionId: string; readonly cantidad: number }[];
}

/**
 * Lectura estricta para quien solo CREA (la carga de demostración): cada fila debe ser un producto completo y válido;
 * acumula los errores por fila y lanza una sola `EntradaInvalida`. No mira la base de datos.
 */
export function leerCsvProductos(csv: FuenteTabla, cargaInicial: boolean): FilaImportada[] {
  const { filas } = leerCsvFilas(csv, cargaInicial);
  const errores: string[] = [];
  const salida: FilaImportada[] = [];
  for (const f of filas) {
    const d = f.datos;
    const propios = f.errores.map((x) => (x.columna === null ? x.motivo : `${x.columna}: ${x.motivo}`));
    for (const [c, v] of [['nombre', d.nombre], ['categoria', d.categoria], ['sku', d.sku]] as const) if (v === undefined) propios.push(`${c}: es obligatorio`);
    if (d.conSerie === true && f.stock.length > 0) propios.push('un producto con serie no admite carga de stock por CSV (use el ingreso con series)');
    if (propios.length > 0) {
      errores.push(`fila ${String(f.linea)}: ${propios.join('; ')}`);
      continue;
    }
    try {
      validarEntradaProducto(crearEntrada(f));
    } catch (e) {
      if (!(e instanceof EntradaInvalida)) throw e;
      errores.push(`fila ${String(f.linea)}: ${e.message}`);
      continue;
    }
    salida.push({ producto: crearEntrada(f), stock: f.stock });
  }
  if (errores.length > 0) throw new EntradaInvalida(`CSV rechazado (${String(errores.length)} error(es))`, errores.slice(0, 20));
  return salida;
}

export interface FilaSimulada {
  readonly linea: number;
  readonly id: string;
  readonly accion: 'crear' | 'actualizar' | 'sin-cambios' | 'error';
  readonly errores: readonly ErrorFila[];
  readonly advertencias: readonly string[];
  /** Campos que cambiarían (nombres de columna canónicos); vacío salvo en `actualizar`. */
  readonly cambios: readonly string[];
}

export interface Simulacion {
  readonly filas: readonly FilaSimulada[];
  readonly resumen: { readonly crear: number; readonly actualizar: number; readonly sinCambios: number; readonly errores: number };
  readonly columnasIgnoradas: readonly string[];
}

/** Producto nuevo a partir de una fila (el precio que falta queda en 0, «a consultar»). */
function crearEntrada(fila: FilaLeida): EntradaProducto {
  const d = fila.datos;
  return {
    id: fila.id,
    nombre: d.nombre as string,
    categoria: d.categoria as string,
    sku: d.sku as string,
    precioUSD: { bo: d.bo ?? 0, ar: d.ar ?? 0 },
    ...(d.marca !== undefined ? { marca: d.marca } : {}),
    ...(d.conSerie !== undefined ? { conSerie: d.conSerie } : {}),
    ...(d.activo !== undefined ? { activo: d.activo } : {}),
    ...(d.publicado !== undefined ? { publicado: d.publicado } : {}),
    ...(d.garantiaMeses !== undefined ? { garantiaMeses: d.garantiaMeses } : {}),
    ...(d.minimo !== undefined ? { minimo: d.minimo } : {}),
    ...(d.costoUSD !== undefined ? { costoUSD: d.costoUSD } : {}),
  };
}

interface PlanFila {
  readonly fila: FilaLeida;
  accion: FilaSimulada['accion'];
  errores: ErrorFila[];
  advertencias: string[];
  cambios: string[];
  producto?: ProductoValido;
  edicion?: CambiosProducto;
}

const ERR = (columna: string | null, motivo: string): ErrorFila => ({ columna, motivo });

/** Decide qué haría una fila contra el estado actual (solo lecturas). La validación es del servidor. */
async function planificarFila(lector: Lector, fila: FilaLeida): Promise<PlanFila> {
  const plan: PlanFila = { fila, accion: 'error', errores: [...fila.errores], advertencias: [...fila.advertencias], cambios: [] };
  if (plan.errores.length > 0) return plan;
  const d = fila.datos;
  const previo = await lector.leer('productos', fila.id);
  if (previo === undefined) {
    if (d.nombre === undefined) plan.errores.push(ERR('nombre', 'es obligatorio para crear'));
    if (d.categoria === undefined) plan.errores.push(ERR('categoria', 'es obligatoria para crear'));
    if (d.sku === undefined) plan.errores.push(ERR('sku', 'es obligatorio para crear'));
    else if ((await lector.leer('skus', d.sku)) !== undefined) plan.errores.push(ERR('sku', 'ya está en uso por otro producto'));
    if (d.bo === undefined || d.ar === undefined) plan.advertencias.push('sin precio en algún mercado: quedará «a consultar» (0)');
    if (d.conSerie === true && fila.stock.length > 0) plan.errores.push(ERR('stock', 'un producto con serie no admite carga de stock por CSV (use el ingreso con series)'));
    if (plan.errores.length > 0) return plan;
    try {
      plan.producto = validarEntradaProducto(crearEntrada(fila));
    } catch (e) {
      if (!(e instanceof EntradaInvalida)) throw e;
      plan.errores.push(ERR(null, e.message));
      return plan;
    }
    plan.accion = 'crear';
    return plan;
  }
  // Producto existente: se actualiza solo lo que el archivo trae y difiere; una celda vacía no borra nada.
  // El stock de un producto que ya existe no se toca (y así un reintento tras un corte no falla por lo ya creado).
  if (fila.stock.length > 0) plan.advertencias.push('stock ignorado: el producto ya existe; su stock se mueve con ingreso, traspaso o ajuste');
  if (d.sku !== undefined && d.sku !== previo['sku']) plan.errores.push(ERR('sku', 'no se edita una vez creado el producto'));
  const c: { -readonly [k in keyof CambiosProducto]: CambiosProducto[k] } = {};
  for (const k of ['nombre', 'categoria', 'marca', 'activo', 'publicado', 'garantiaMeses', 'minimo'] as const) {
    const v = d[k];
    if (v !== undefined && v !== previo[k]) {
      (c as Record<string, unknown>)[k] = v;
      plan.cambios.push(k);
    }
  }
  if (d.conSerie !== undefined && d.conSerie !== (previo['conSerie'] === true)) {
    if (previo['conMovimientos'] === true) plan.errores.push(ERR('conSerie', 'no se puede cambiar: el producto ya tiene movimientos de inventario'));
    else {
      c.conSerie = d.conSerie;
      plan.cambios.push('conSerie');
    }
  }
  const antes = (previo['precioUSD'] ?? {}) as Record<string, unknown>;
  const bo = d.bo ?? (antes['bo'] as number | undefined);
  const ar = d.ar ?? (antes['ar'] as number | undefined);
  if ((d.bo !== undefined && d.bo !== antes['bo']) || (d.ar !== undefined && d.ar !== antes['ar'])) {
    c.precioUSD = { bo: bo ?? 0, ar: ar ?? 0 };
    plan.cambios.push('precioUSD');
  }
  if (d.costoUSD !== undefined && d.costoUSD !== (await lector.leer('costos', fila.id))?.['costoUSD']) {
    c.costoUSD = d.costoUSD;
    plan.cambios.push('costoUSD');
  }
  if (plan.errores.length > 0) return plan;
  plan.accion = plan.cambios.length > 0 ? 'actualizar' : 'sin-cambios';
  if (plan.accion === 'actualizar') plan.edicion = c;
  return plan;
}

/** Escrituras que una fila puede pedir; no depende del estado, así el reparto en lotes es estable ante un reintento. */
const pesoFila = (f: FilaLeida): number => 10 + 4 * f.stock.length;

function leer(tx: TransaccionIdentidad, tenantId: string, csv: FuenteTabla, cargaInicial: boolean): { lector: Lector; lectura: LecturaCsv } {
  return { lector: new Lector(tx, exigirTenant(tenantId)), lectura: leerCsvFilas(csv, cargaInicial) };
}

/**
 * Simula la importación fila por fila (crear / actualizar / sin cambios / error con columna y motivo) sin escribir nada
 * ni consumir ningún `operacionId`. Incluye el tope de productos del plan.
 */
export async function simularImportacionCsv(
  tx: TransaccionIdentidad,
  e: { tenantId: string; por: Autor; csv: FuenteTabla; cargaInicial?: boolean },
): Promise<Simulacion> {
  const por = exigirAutor(e.por);
  if (!PERMISOS.importacion.includes(por.rol)) throw new SinPermiso(`El rol ${por.rol} no puede ejecutar importar-csv`);
  const { lector, lectura } = leer(tx, e.tenantId, e.csv, e.cargaInicial === true);
  const { usado, tope } = await leerCupo(lector, e.tenantId, 'productos');
  let creados = 0;
  const filas: FilaSimulada[] = [];
  for (const f of lectura.filas) {
    const p = await planificarFila(lector, f);
    if (p.accion === 'crear') {
      if (usado + creados >= tope) {
        p.accion = 'error';
        p.errores.push(ERR(null, `supera el límite de ${String(tope)} productos del plan`));
      } else creados += 1;
    }
    filas.push({ linea: f.linea, id: f.id, accion: p.accion, errores: p.errores, advertencias: p.advertencias, cambios: p.cambios });
  }
  const n = (a: FilaSimulada['accion']): number => filas.filter((f) => f.accion === a).length;
  return {
    filas,
    resumen: { crear: n('crear'), actualizar: n('actualizar'), sinCambios: n('sin-cambios'), errores: n('error') },
    columnasIgnoradas: lectura.columnasIgnoradas,
  };
}

const detalleErrores = (filas: readonly FilaSimulada[]): string[] =>
  filas.filter((f) => f.accion === 'error').map((f) => `línea ${String(f.linea)}: ${f.errores.map((x) => (x.columna === null ? x.motivo : `${x.columna}: ${x.motivo}`)).join('; ')}`);

interface ResultadoLote {
  creados: number;
  actualizados: number;
  sinCambios: number;
  productos: string[];
}

/** Aplica una tanda de filas en UNA transacción (todo o nada dentro de la tanda). Relee el estado: no confía en la simulación. */
async function importarLote(
  tx: TransaccionIdentidad,
  e: { tenantId: string; operacionId: string; por: Autor; cargaInicial: boolean; filas: readonly FilaLeida[] },
): Promise<ResultadoOperacion<Datos>> {
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'importar-csv',
    accion: 'inventarios.importar-csv',
    // La identidad de la tanda es el contenido del archivo, no el estado: un reintento produce el mismo hash.
    carga: { cargaInicial: e.cargaInicial, filas: e.filas.map((f) => ({ id: f.id, datos: f.datos, stock: f.stock })) },
    por: exigirAutor(e.por),
    roles: PERMISOS.importacion,
    construir: async (t) => {
      const planes: PlanFila[] = [];
      for (const f of e.filas) planes.push(await planificarFila(t.lector, f));
      const malas = planes.filter((p) => p.accion === 'error');
      if (malas.length > 0) {
        throw new EntradaInvalida(
          `La importación cambió desde la simulación (${String(malas.length)} fila(s) ya no son válidas)`,
          malas.map((p) => `línea ${String(p.fila.linea)}: ${p.errores.map((x) => (x.columna === null ? x.motivo : `${x.columna}: ${x.motivo}`)).join('; ')}`),
        );
      }
      const nuevas = planes.filter((p) => p.accion === 'crear');
      if (nuevas.length > 0) await reservarLimite(t, 'productos', nuevas.length);
      const cambios: { productoId: string; cambio: CambioProductoCambiado }[] = [];
      const resultado: ResultadoLote = { creados: 0, actualizados: 0, sinCambios: 0, productos: [] };
      for (const p of planes) {
        if (p.accion === 'crear' && p.producto !== undefined) {
          await prepararProductoNuevo(t, p.producto, UBICACIONES);
          for (const s of p.fila.stock) t.mover(p.producto.id, s.ubicacionId, s.cantidad, { tipo: 'ingreso' });
          cambios.push({ productoId: p.fila.id, cambio: 'creado' });
          resultado.creados += 1;
          resultado.productos.push(p.fila.id);
        } else if (p.accion === 'actualizar' && p.edicion !== undefined) {
          await prepararEdicion(t, p.fila.id, p.edicion);
          cambios.push({ productoId: p.fila.id, cambio: p.cambios.length === 1 && p.cambios[0] === 'precioUSD' ? 'precio' : 'editado' });
          resultado.actualizados += 1;
          resultado.productos.push(p.fila.id);
        } else resultado.sinCambios += 1;
      }
      return {
        resultado: { ...resultado },
        referencia: e.cargaInicial ? { tipo: 'carga-inicial', id: e.operacionId } : { tipo: 'importacion', id: e.operacionId },
        tipoMovimiento: 'ingreso',
        cambiosProducto: cambios,
      };
    },
  });
}

/**
 * Variante de UNA transacción (todo o nada real): para archivos pequeños. Solo admite filas cuyo peso quepa en una
 * transacción; con errores rechaza el archivo entero con el detalle por fila.
 */
export async function importarProductosCsv(
  tx: TransaccionIdentidad,
  e: { tenantId: string; operacionId: string; por: Autor; csv: FuenteTabla; cargaInicial?: boolean },
): Promise<ResultadoOperacion<Datos>> {
  const cargaInicial = e.cargaInicial === true;
  const { lectura } = leer(tx, e.tenantId, e.csv, cargaInicial);
  if (lectura.filas.reduce((s, f) => s + pesoFila(f), 0) > PRESUPUESTO_ESCRITURAS) {
    throw new EntradaInvalida('El archivo no cabe en una sola transacción; use la importación por lotes');
  }
  const mal = lectura.filas.filter((f) => f.errores.length > 0);
  if (mal.length > 0) {
    throw new EntradaInvalida(`CSV rechazado (${String(mal.length)} error(es))`, mal.slice(0, 20).map((f) => `línea ${String(f.linea)}: ${f.errores.map((x) => x.motivo).join('; ')}`));
  }
  return importarLote(tx, { tenantId: e.tenantId, operacionId: e.operacionId, por: e.por, cargaInicial, filas: lectura.filas });
}

export interface BaseTransaccional {
  runTransaction<R>(f: (tx: TransaccionIdentidad) => Promise<R>): Promise<R>;
}

export interface ResultadoImportacion {
  /** `false` si se detuvo a mitad (error de una tanda o tiempo agotado): lo ya aplicado queda; reintente con el mismo `operacionId`. */
  readonly completa: boolean;
  readonly creados: number;
  readonly actualizados: number;
  readonly sinCambios: number;
  /** Filas con error que se omitieron (`omitirErrores`). */
  readonly omitidas: number;
  readonly lotes: { readonly total: number; readonly aplicados: number };
  readonly productos: readonly string[];
  /** Motivo de la detención, si `completa` es `false`. */
  readonly detencion?: string;
  readonly simulacion: Simulacion;
}

/**
 * Importa por lotes. Firestore limita una transacción a 500 escrituras, así que un archivo grande NO puede ser todo o
 * nada: se simula completo (con errores se rechaza todo salvo `omitirErrores`) y se aplica en tandas, cada una una
 * transacción atómica con su propio `operacionId` derivado (`<operacionId>-l<n>`), tope del plan, auditoría y eventos
 * `producto.cambiado`. Un fallo a mitad deja aplicadas las tandas anteriores y no escribe nada de la tanda fallida;
 * repetir la llamada con el mismo `operacionId` reconoce las tandas hechas (idempotentes) y sigue por las pendientes.
 */
export async function importarCsvPorLotes(
  db: BaseTransaccional,
  e: { tenantId: string; operacionId: string; por: Autor; csv: FuenteTabla; cargaInicial?: boolean; omitirErrores?: boolean; presupuestoMs?: number; ahora?: () => number },
): Promise<ResultadoImportacion> {
  exigirSegmento(e.operacionId, 'operacionId');
  const cargaInicial = e.cargaInicial === true;
  const por = exigirAutor(e.por);
  const simulacion = await db.runTransaction((tx) => simularImportacionCsv(tx, { tenantId: e.tenantId, por, csv: e.csv, cargaInicial }));
  if (simulacion.resumen.errores > 0 && e.omitirErrores !== true) {
    throw new EntradaInvalida(`El archivo tiene ${String(simulacion.resumen.errores)} fila(s) con errores; corríjalas o importe omitiéndolas`, detalleErrores(simulacion.filas).slice(0, 50));
  }
  const buenas = new Set(simulacion.filas.filter((f) => f.accion !== 'error').map((f) => f.linea));
  const filas = leerCsvFilas(e.csv, cargaInicial).filas.filter((f) => buenas.has(f.linea));
  const lotes: FilaLeida[][] = [];
  let peso = 0;
  for (const f of filas) {
    if (lotes.length === 0 || peso + pesoFila(f) > PRESUPUESTO_ESCRITURAS) {
      lotes.push([]);
      peso = 0;
    }
    (lotes[lotes.length - 1] as FilaLeida[]).push(f);
    peso += pesoFila(f);
  }
  const ahora = e.ahora ?? Date.now;
  const limite = e.presupuestoMs === undefined ? Infinity : ahora() + e.presupuestoMs;
  const total = { creados: 0, actualizados: 0, sinCambios: 0 };
  const productos: string[] = [];
  let aplicados = 0;
  let detencion: string | undefined;
  for (const [i, lote] of lotes.entries()) {
    if (ahora() > limite) {
      detencion = 'Se agotó el tiempo de la llamada; repita con el mismo operacionId para continuar';
      break;
    }
    try {
      const r = await db.runTransaction((tx) =>
        importarLote(tx, { tenantId: e.tenantId, operacionId: `${e.operacionId}-l${String(i + 1)}`, por, cargaInicial, filas: lote }),
      );
      const x = r.resultado as unknown as ResultadoLote;
      total.creados += x.creados;
      total.actualizados += x.actualizados;
      total.sinCambios += x.sinCambios;
      productos.push(...x.productos);
      aplicados += 1;
    } catch (err) {
      if (!(err instanceof ErrorInventario)) throw err;
      detencion = `Tanda ${String(i + 1)} de ${String(lotes.length)}: ${err.message}${err instanceof EntradaInvalida && err.detalles.length > 0 ? ` (${err.detalles.slice(0, 3).join(' | ')})` : ''}`;
      break;
    }
  }
  return {
    completa: detencion === undefined,
    ...total,
    omitidas: simulacion.resumen.errores,
    lotes: { total: lotes.length, aplicados },
    productos,
    ...(detencion !== undefined ? { detencion } : {}),
    simulacion,
  };
}

export interface ProductoExportable {
  readonly id: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly marca?: string;
  readonly sku: string;
  readonly conSerie: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  /** Centavos de USD (como se guardan); la exportación los escribe en USD con 2 decimales, que la importación lee sin cambiar precios. */
  readonly precioUSD: { readonly bo: number; readonly ar: number };
  readonly costoUSD?: number;
  readonly activo: boolean;
  readonly publicado: boolean;
}

const celdaCsv = (v: string): string => {
  const n = neutralizarCelda(v);
  return /[",\r\n]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n;
};

/** Centavos enteros a «12.50» sin pasar por coma flotante. */
export function centavosAUsd(c: number): string {
  const e = Math.trunc(c);
  return `${String(Math.floor(e / 100))}.${String(e % 100).padStart(2, '0')}`;
}

/** Encabezados de la exportación: precios y costo en USD con decimales (los que el importador lee en USD). */
export const COLUMNAS_EXPORTACION = ['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioBO', 'precioAR', 'costo', 'activo', 'publicado'] as const;

/** Exporta productos a CSV neutralizando toda celda de texto que empiece con = + - @. Sin costos salvo que vengan. */
export function exportarProductosCsv(productos: readonly ProductoExportable[]): string {
  const filas = productos.map((p) =>
    [
      p.id, p.nombre, p.categoria, p.marca ?? '', p.sku, String(p.conSerie), p.garantiaMeses?.toString() ?? '', p.minimo?.toString() ?? '',
      centavosAUsd(p.precioUSD.bo), centavosAUsd(p.precioUSD.ar), p.costoUSD === undefined ? '' : centavosAUsd(p.costoUSD), String(p.activo), String(p.publicado),
    ].map(celdaCsv).join(','),
  );
  return `${[COLUMNAS_EXPORTACION.join(','), ...filas].join('\r\n')}\r\n`;
}
