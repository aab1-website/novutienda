// Importación de productos del doble: la misma forma y reglas visibles del servidor (`inventarios.importarProductosCsv`):
// simulación fila por fila con errores por columna, crear/actualizar/sin cambios, tandas con resultado incompleto y archivo
// CSV o Excel. No sustituye las pruebas del módulo.
//
// Excel en el doble: no hay lector de hojas; un archivo cuyos bytes empiezan por la firma `PK\u0003\u0004` se acepta y su
// contenido tras esa firma se toma como la hoja en texto CSV (`archivoExcelDoble` lo arma en las pruebas).
import type { Entrada } from '../../api/contrato.js';
import type { ErrorFilaImportacion, FilaSimulada, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { auditar, fallo, type Contexto } from '../estado.js';
import { parsearCsv } from './inventario.js';

const FIRMA_EXCEL = 'PK\u0003\u0004';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILAS = 1000;
const ID_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const SI = new Set(['si', 'sí', 'true', '1', 'verdadero', 'x']);
const NO = new Set(['no', 'false', '0', 'falso']);

type Columna = 'id' | 'nombre' | 'categoria' | 'marca' | 'sku' | 'conSerie' | 'activo' | 'publicado' | 'garantiaMeses' | 'minimo' | 'precioBO' | 'precioAR' | 'costoUSD' | 'stockTienda' | 'stockDeposito1' | 'stockDeposito2';
type Unidad = 'centavos' | 'usd';
const ALIAS: Readonly<Record<string, readonly [Columna, Unidad | null]>> = {
  id: ['id', null], codigo: ['id', null], nombre: ['nombre', null], categoria: ['categoria', null], marca: ['marca', null], sku: ['sku', null],
  conserie: ['conSerie', null], activo: ['activo', null], publicado: ['publicado', null], garantiameses: ['garantiaMeses', null], garantia: ['garantiaMeses', null],
  minimo: ['minimo', null], preciousdbo: ['precioBO', 'centavos'], preciousdar: ['precioAR', 'centavos'], preciobo: ['precioBO', 'usd'], precioar: ['precioAR', 'usd'],
  costousd: ['costoUSD', 'centavos'], costo: ['costoUSD', 'usd'],
  stocktienda: ['stockTienda', null], stockdeposito1: ['stockDeposito1', null], stockdeposito2: ['stockDeposito2', null],
};
const SUENA_A_STOCK = new Set(['stock', 'existencias', 'existencia', 'cantidad', 'almacen', 'ubicacion', 'deposito', 'tienda']);
const STOCK = { stockTienda: 'tienda', stockDeposito1: 'deposito-1', stockDeposito2: 'deposito-2' } as const;
const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Arma un «archivo Excel» del doble (firma + hoja en texto CSV), en base64, para las pruebas y la demostración. */
export function archivoExcelDoble(hojaCsv: string): string {
  return btoa(unescape(encodeURIComponent(FIRMA_EXCEL + hojaCsv)));
}

function texto(e: { archivo?: string | undefined; csv?: string | undefined }): string {
  if ((e.archivo === undefined) === (e.csv === undefined)) throw fallo('entrada-invalida', 'Envíe `archivo` (base64) o `csv`, uno solo.');
  if (e.csv !== undefined) {
    if (e.csv.length === 0 || e.csv.length > 262_144) throw fallo('entrada-invalida', 'CSV vacío o demasiado grande');
    return e.csv;
  }
  const b64 = e.archivo as string;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw fallo('entrada-invalida', 'El archivo debe venir en base64.');
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw fallo('entrada-invalida', 'El archivo está vacío o supera 2 MB.');
  const t = new TextDecoder().decode(bytes);
  return t.startsWith(FIRMA_EXCEL) ? t.slice(FIRMA_EXCEL.length) : t;
}

function importe(v: string, unidad: Unidad): number | undefined {
  if (unidad === 'centavos') return /^\d{1,11}$/.test(v) && Number(v) <= 10_000_000_000 ? Number(v) : undefined;
  const m = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(v);
  return m === null ? undefined : Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

interface Fila {
  linea: number; id: string; errores: ErrorFilaImportacion[]; advertencias: string[];
  d: { nombre?: string; categoria?: string; marca?: string; sku?: string; conSerie?: boolean; activo?: boolean; publicado?: boolean; garantiaMeses?: number; minimo?: number; bo?: number; ar?: number; costoUSD?: number };
  stock: { ubicacionId: 'tienda' | 'deposito-1' | 'deposito-2'; cantidad: number }[];
}

function leer(c: Contexto, entrada: { archivo?: string | undefined; csv?: string | undefined }, cargaInicial: boolean): { filas: Fila[]; ignoradas: string[] } {
  const [cab, ...datos] = parsearCsv(texto(entrada));
  if (cab === undefined) throw fallo('entrada-invalida', 'CSV sin encabezado');
  const indice = new Map<Columna, { i: number; etiqueta: string; unidad: Unidad | null }>();
  const ignoradas: string[] = [];
  for (const [i, h] of cab.entries()) {
    const n = normalizar(h);
    const alias = ALIAS[n];
    if (alias === undefined) {
      if (n !== '') ignoradas.push(SUENA_A_STOCK.has(n) ? `${h} (el CSV no modifica el stock salvo en la carga inicial)` : h);
      continue;
    }
    if (indice.has(alias[0])) throw fallo('entrada-invalida', `columna repetida: ${h}`);
    indice.set(alias[0], { i, etiqueta: h, unidad: alias[1] });
  }
  if (!indice.has('id')) throw fallo('entrada-invalida', 'falta la columna id');
  if (!cargaInicial && (Object.keys(STOCK) as Columna[]).some((k) => indice.has(k))) throw fallo('entrada-invalida', 'El CSV no toca el stock: las columnas de stock solo se admiten en la carga inicial');
  if (datos.length < 1 || datos.length > MAX_FILAS) throw fallo('entrada-invalida', `El CSV debe tener entre 1 y ${MAX_FILAS} filas`);
  const ids = new Set<string>();
  const skus = new Set<string>();
  const filas: Fila[] = [];
  for (const [k, f] of datos.entries()) {
    const fila: Fila = { linea: k + 2, id: '', errores: [], advertencias: [], d: {}, stock: [] };
    const celda = (col: Columna): string | undefined => {
      const x = indice.get(col);
      const v = x === undefined ? undefined : (f[x.i] ?? '').trim();
      return v === undefined || v === '' ? undefined : v;
    };
    const err = (col: Columna, motivo: string): void => void fila.errores.push({ columna: indice.get(col)?.etiqueta ?? col, motivo });
    if (f.length !== cab.length) fila.errores.push({ columna: null, motivo: 'el número de columnas no coincide con el encabezado' });
    fila.id = celda('id') ?? '';
    if (!ID_PRODUCTO.test(fila.id)) err('id', 'id inválido (minúsculas, números y guiones, 2 a 60 caracteres)');
    else if (ids.has(fila.id)) err('id', 'id repetido en el archivo');
    ids.add(fila.id);
    for (const col of ['nombre', 'categoria', 'marca'] as const) {
      const v = celda(col);
      if (v === undefined) continue;
      if (/[<>]/.test(v) || v.length > (col === 'nombre' ? 120 : 60)) err(col, 'texto inválido (sin < ni >, longitud máxima)');
      else fila.d[col] = v;
    }
    const sku = celda('sku');
    if (sku !== undefined) {
      if (!SKU.test(sku)) err('sku', 'sku inválido');
      else if (skus.has(sku)) err('sku', 'sku repetido en el archivo');
      else {
        fila.d.sku = sku;
        skus.add(sku);
      }
    }
    for (const col of ['conSerie', 'activo', 'publicado'] as const) {
      const v = celda(col);
      if (v === undefined) continue;
      if (SI.has(v.toLowerCase())) fila.d[col] = true;
      else if (NO.has(v.toLowerCase())) fila.d[col] = false;
      else err(col, 'use sí o no (true o false)');
    }
    const gar = celda('garantiaMeses');
    if (gar !== undefined) { if (!/^\d{1,3}$/.test(gar) || Number(gar) < 1 || Number(gar) > 120) err('garantiaMeses', 'entero de 1 a 120'); else fila.d.garantiaMeses = Number(gar); }
    const min = celda('minimo');
    if (min !== undefined) { if (!/^\d{1,10}$/.test(min)) err('minimo', 'entero no negativo'); else fila.d.minimo = Number(min); }
    for (const [col, destino] of [['precioBO', 'bo'], ['precioAR', 'ar'], ['costoUSD', 'costoUSD']] as const) {
      const v = celda(col);
      if (v === undefined) continue;
      const unidad = indice.get(col)?.unidad ?? 'centavos';
      const n = importe(v, unidad);
      if (n === undefined) err(col, unidad === 'centavos' ? 'importe en centavos de USD: entero sin signos ni fórmulas' : 'importe en USD, hasta 2 decimales, sin signos ni fórmulas');
      else fila.d[destino] = n;
    }
    for (const [col, ubicacionId] of Object.entries(STOCK) as [Columna, 'tienda' | 'deposito-1' | 'deposito-2'][]) {
      const v = celda(col);
      if (v === undefined) continue;
      if (!/^\d{1,7}$/.test(v)) err(col, 'entero no negativo (máximo 1.000.000)');
      else if (Number(v) > 0) fila.stock.push({ ubicacionId, cantidad: Number(v) });
    }
    filas.push(fila);
  }
  void c;
  return { filas, ignoradas };
}

/** Qué haría una fila contra el estado actual (solo lectura). */
function planificar(c: Contexto, f: Fila, nuevos: number): { accion: FilaSimulada['accion']; errores: ErrorFilaImportacion[]; advertencias: string[]; cambios: string[] } {
  const errores = [...f.errores];
  const advertencias = [...f.advertencias];
  const cambios: string[] = [];
  if (errores.length > 0) return { accion: 'error', errores, advertencias, cambios };
  const previo = c.e.productos.get(f.id);
  const d = f.d;
  if (previo === undefined) {
    if (d.nombre === undefined) errores.push({ columna: 'nombre', motivo: 'es obligatorio para crear' });
    if (d.categoria === undefined) errores.push({ columna: 'categoria', motivo: 'es obligatoria para crear' });
    if (d.sku === undefined) errores.push({ columna: 'sku', motivo: 'es obligatorio para crear' });
    else if ([...c.e.productos.values()].some((p) => p.sku === d.sku)) errores.push({ columna: 'sku', motivo: 'ya está en uso por otro producto' });
    if (d.conSerie === true && f.stock.length > 0) errores.push({ columna: 'stock', motivo: 'un producto con serie no admite carga de stock por CSV (use el ingreso con series)' });
    if (c.e.productos.size + nuevos >= 200) errores.push({ columna: null, motivo: 'supera el límite de 200 productos del plan' });
    if (d.bo === undefined || d.ar === undefined) advertencias.push('sin precio en algún mercado: quedará «a consultar» (0)');
    return { accion: errores.length > 0 ? 'error' : 'crear', errores, advertencias, cambios };
  }
  if (f.stock.length > 0) advertencias.push('stock ignorado: el producto ya existe; su stock se mueve con ingreso, traspaso o ajuste');
  if (d.sku !== undefined && d.sku !== previo.sku) errores.push({ columna: 'sku', motivo: 'no se edita una vez creado el producto' });
  for (const k of ['nombre', 'categoria', 'marca', 'activo', 'publicado', 'garantiaMeses', 'minimo'] as const) {
    if (d[k] !== undefined && d[k] !== previo[k]) cambios.push(k);
  }
  if (d.conSerie !== undefined && d.conSerie !== previo.conSerie) {
    if (c.e.movimientos.some((m) => m.productoId === previo.id)) errores.push({ columna: 'conSerie', motivo: 'no se puede cambiar: el producto ya tiene movimientos de inventario' });
    else cambios.push('conSerie');
  }
  if ((d.bo !== undefined && d.bo !== previo.precioUSD.bo) || (d.ar !== undefined && d.ar !== previo.precioUSD.ar)) cambios.push('precioUSD');
  if (d.costoUSD !== undefined && d.costoUSD !== previo.costoUSD) cambios.push('costoUSD');
  if (errores.length > 0) return { accion: 'error', errores, advertencias, cambios: [] };
  return { accion: cambios.length > 0 ? 'actualizar' : 'sin-cambios', errores, advertencias, cambios };
}

export function simularImportacionDoble(c: Contexto, e: Entrada<'simularImportacionProductos'>): Simulacion {
  const { filas, ignoradas } = leer(c, e, e.cargaInicial === true);
  let nuevos = 0;
  const out: FilaSimulada[] = filas.map((f) => {
    const p = planificar(c, f, nuevos);
    if (p.accion === 'crear') nuevos += 1;
    return { linea: f.linea, id: f.id, ...p };
  });
  const n = (a: FilaSimulada['accion']): number => out.filter((x) => x.accion === a).length;
  return { filas: out, resumen: { crear: n('crear'), actualizar: n('actualizar'), sinCambios: n('sin-cambios'), errores: n('error') }, columnasIgnoradas: ignoradas };
}

/** Aplica el plan por tandas; la tanda que `estado.importacion.fallaEnTanda` indica se detiene sin escribir nada de ella. */
export function importarProductosDoble(c: Contexto, e: Entrada<'importarProductosCsv'>): ResultadoImportacion {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(e.operacionId ?? '')) throw fallo('entrada-invalida', 'operacionId inválido');
  const cargaInicial = e.cargaInicial === true;
  const simulacion = simularImportacionDoble(c, { ...(e.archivo !== undefined ? { archivo: e.archivo } : { csv: e.csv as string }), cargaInicial } as Entrada<'simularImportacionProductos'>);
  if (simulacion.resumen.errores > 0 && e.omitirErrores !== true) {
    const detalles = simulacion.filas.filter((f) => f.accion === 'error').map((f) => `línea ${f.linea}: ${f.errores.map((x) => (x.columna === null ? x.motivo : `${x.columna}: ${x.motivo}`)).join('; ')}`);
    throw fallo('entrada-invalida', `El archivo tiene ${simulacion.resumen.errores} fila(s) con errores; corríjalas o importe omitiéndolas`, { detalles });
  }
  if (e.omitirErrores === true) {
    // Igual que el servidor: omitir exige la lista y debe coincidir exactamente con las filas con error de la simulación nueva.
    if (e.lineasOmitidas === undefined) throw fallo('entrada-invalida', 'Con omitirErrores debe enviar lineasOmitidas: las líneas con error que acepta omitir');
    const vistas = new Set(e.lineasOmitidas);
    const ahoraConError = simulacion.filas.filter((f) => f.accion === 'error').map((f) => f.linea);
    if (vistas.size !== ahoraConError.length || ahoraConError.some((l) => !vistas.has(l))) {
      return {
        completa: false, creados: 0, actualizados: 0, sinCambios: 0, omitidas: 0, lotes: { total: 0, aplicados: 0 }, productos: [], desactualizada: true,
        detencion: 'El archivo o los datos cambiaron desde la simulación; vuelva a simular. No se escribió nada.', simulacion,
      };
    }
  }
  const { filas } = leer(c, e, cargaInicial);
  const buenas = new Map(simulacion.filas.filter((f) => f.accion !== 'error').map((f) => [f.linea, f.accion]));
  const aplicables = filas.filter((f) => buenas.has(f.linea));
  const { filasPorTanda, fallaEnTanda } = c.e.importacion;
  const total = Math.ceil(aplicables.length / filasPorTanda);
  const r = { creados: 0, actualizados: 0, sinCambios: 0 };
  const productos: string[] = [];
  let aplicados = 0;
  let detencion: string | undefined;
  for (let t = 1; t <= total; t++) {
    if (fallaEnTanda === t) {
      detencion = `Tanda ${t} de ${total}: error simulado por el doble; repita con el mismo operacionId para continuar`;
      break;
    }
    // Una tanda ya aplicada con este `operacionId` se reconoce (idempotente) y suma lo que había dado.
    const clave = `${e.operacionId}-l${t}`;
    const previa = c.e.operaciones.get(clave);
    if (previa !== undefined) {
      const x = previa.resultado as { creados: number; actualizados: number; sinCambios: number; productos: string[] };
      r.creados += x.creados; r.actualizados += x.actualizados; r.sinCambios += x.sinCambios; productos.push(...x.productos);
      aplicados += 1;
      continue;
    }
    const antes = { ...r };
    const desde = productos.length;
    for (const f of aplicables.slice((t - 1) * filasPorTanda, t * filasPorTanda)) {
      const accion = buenas.get(f.linea);
      if (accion === 'crear') {
        c.e.productos.set(f.id, {
          id: f.id, nombre: f.d.nombre as string, categoria: f.d.categoria as string, ...(f.d.marca !== undefined ? { marca: f.d.marca } : {}), sku: f.d.sku as string,
          activo: f.d.activo ?? true, publicado: f.d.publicado ?? false, conSerie: f.d.conSerie ?? false,
          ...(f.d.garantiaMeses !== undefined ? { garantiaMeses: f.d.garantiaMeses } : {}), ...(f.d.minimo !== undefined ? { minimo: f.d.minimo } : {}),
          precioUSD: { bo: f.d.bo ?? 0, ar: f.d.ar ?? 0 }, costoUSD: f.d.costoUSD ?? 0, stockTotal: 0, existencias: { tienda: 0, 'deposito-1': 0, 'deposito-2': 0 },
        });
        const p = c.e.productos.get(f.id);
        if (p !== undefined) {
          for (const s of f.stock) p.existencias[s.ubicacionId] += s.cantidad;
          p.stockTotal = p.existencias.tienda + p.existencias['deposito-1'] + p.existencias['deposito-2'];
        }
        r.creados += 1;
        productos.push(f.id);
      } else if (accion === 'actualizar') {
        const p = c.e.productos.get(f.id);
        if (p === undefined) continue;
        const { bo, ar, costoUSD, ...directos } = f.d;
        Object.assign(p, Object.fromEntries(Object.entries(directos).filter(([k, v]) => v !== undefined && k !== 'sku')));
        if (bo !== undefined || ar !== undefined) p.precioUSD = { bo: bo ?? p.precioUSD.bo, ar: ar ?? p.precioUSD.ar };
        if (costoUSD !== undefined) p.costoUSD = costoUSD;
        r.actualizados += 1;
        productos.push(f.id);
      } else r.sinCambios += 1;
    }
    c.e.operaciones.set(clave, {
      hash: clave,
      resultado: { creados: r.creados - antes.creados, actualizados: r.actualizados - antes.actualizados, sinCambios: r.sinCambios - antes.sinCambios, productos: productos.slice(desde) },
    });
    aplicados += 1;
  }
  if (r.creados + r.actualizados > 0) {
    c.e.cambiosSinPublicar += 1;
    auditar(c, 'inventarios.importar-csv', 'productos');
  }
  return { completa: detencion === undefined, ...r, omitidas: simulacion.resumen.errores, lotes: { total, aplicados }, productos, ...(detencion !== undefined ? { detencion } : {}), simulacion };
}
