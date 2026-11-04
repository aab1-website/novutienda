import { LimiteDelPlan, registrarAuditoria, type Actor } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';
import { aCsv, decodificarUtf8, ErrorCsv, MAX_BYTES_ARCHIVO, neutralizarCelda, parsearCsv } from './csv.js';
import { ErrorConsola } from './errores.js';
import { LIMITES_CONSOLA } from './limites.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, CatalogoPuerto, DatosProducto, LectorHojas, PrecioUSD, ProductoCatalogo, Reloj } from './puertos.js';
import { ID_PRODUCTO, rutaSitio, tenantValido } from './rutas.js';

export const MAX_FILAS_IMPORTACION = 1000;

type Columna = 'id' | 'nombre' | 'categoria' | 'marca' | 'sku' | 'activo' | 'garantiaMeses' | 'precioBO' | 'precioAR';
export const COLUMNAS_EXPORTACION: readonly Columna[] = ['id', 'nombre', 'categoria', 'marca', 'sku', 'activo', 'garantiaMeses', 'precioBO', 'precioAR'];

const ALIAS: Readonly<Record<string, Columna>> = {
  id: 'id', codigo: 'id', nombre: 'nombre', categoria: 'categoria', marca: 'marca', sku: 'sku', activo: 'activo',
  garantiameses: 'garantiaMeses', garantia: 'garantiaMeses',
  preciobo: 'precioBO', preciobousd: 'precioBO', precioar: 'precioAR', precioarusd: 'precioAR',
};
/** Columnas que se reconocen solo para avisar que se ignoran: el CSV nunca toca el stock. */
const COLUMNAS_STOCK = new Set(['stock', 'existencias', 'existencia', 'cantidad', 'almacen', 'ubicacion', 'deposito', 'tienda', 'minimo']);

const normalizar = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface CambiosFila {
  readonly datos: Partial<DatosProducto>;
  readonly precio: Partial<PrecioUSD>;
}

export interface FilaSimulada {
  /** Número de línea del archivo (el encabezado es la 1). */
  readonly linea: number;
  readonly id: string;
  readonly accion: 'crear' | 'actualizar' | 'sin-cambios' | 'error';
  readonly errores: readonly string[];
  readonly advertencias: readonly string[];
  readonly cambios: CambiosFila;
}

export interface Simulacion {
  readonly filas: readonly FilaSimulada[];
  readonly resumen: { readonly crear: number; readonly actualizar: number; readonly sinCambios: number; readonly errores: number };
  readonly columnasIgnoradas: readonly string[];
}

export interface EntradaImportacion {
  readonly tenantId: string;
  readonly actor: Actor;
  /** Bytes del archivo .csv o .xlsx (se distingue por la firma ZIP, no por la extensión). */
  readonly contenido: Uint8Array;
}

export interface DepsSimulacion {
  readonly catalogo: CatalogoPuerto;
  readonly lector?: LectorHojas;
}

async function leerFilas(contenido: Uint8Array, lector: LectorHojas | undefined): Promise<readonly (readonly string[])[]> {
  if (contenido.length === 0) throw new ErrorConsola('entrada-invalida', 'El archivo está vacío');
  if (contenido.length > MAX_BYTES_ARCHIVO) throw new ErrorConsola('entrada-invalida', 'El archivo supera 2 MB');
  const esZip = contenido[0] === 0x50 && contenido[1] === 0x4b && contenido[2] === 0x03 && contenido[3] === 0x04;
  if (esZip) {
    if (lector === undefined) throw new ErrorConsola('no-disponible', 'La lectura de Excel no está disponible; use CSV');
    return lector.leerPrimeraHoja(contenido);
  }
  const texto = decodificarUtf8(contenido);
  if (texto === undefined) throw new ErrorConsola('entrada-invalida', 'El archivo CSV debe estar codificado en UTF-8');
  try {
    return parsearCsv(texto.replace(/^\uFEFF/, ''));
  } catch (e) {
    if (e instanceof ErrorCsv) throw new ErrorConsola('entrada-invalida', e.message);
    throw e;
  }
}

const SI = new Set(['si', 'sí', 'true', '1', 'verdadero', 'x']);
const NO = new Set(['no', 'false', '0', 'falso']);

function numeroUsd(v: string): number | undefined {
  if (!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(v)) return undefined;
  return Number(v.replace(',', '.'));
}

const TEXTO = (v: string, max: number): boolean => v.length <= max && !/[<>]/.test(v) && ![...v].some((c) => (c.codePointAt(0) ?? 0) < 32);

/** Simulación fila por fila. No escribe nada. La validación es del servidor: el cliente no decide qué es válido. */
export async function simularImportacion(deps: DepsSimulacion, e: EntradaImportacion): Promise<Simulacion> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.administrar);
  const filas = await leerFilas(e.contenido, deps.lector);
  const encabezado = filas[0];
  if (encabezado === undefined) throw new ErrorConsola('entrada-invalida', 'El archivo no tiene encabezado');
  if (filas.length - 1 > MAX_FILAS_IMPORTACION) throw new ErrorConsola('entrada-invalida', `Máximo ${String(MAX_FILAS_IMPORTACION)} filas por importación`);

  const indice = new Map<Columna, number>();
  const ignoradas: string[] = [];
  encabezado.forEach((h, i) => {
    const n = normalizar(h);
    const col = ALIAS[n];
    if (col !== undefined && !indice.has(col)) indice.set(col, i);
    else if (n !== '') ignoradas.push(COLUMNAS_STOCK.has(n) ? `${h} (el CSV no modifica el stock)` : h);
  });
  if (!indice.has('id')) throw new ErrorConsola('entrada-invalida', 'Falta la columna «id»');

  const existentes = new Map((await deps.catalogo.listarProductos(t)).map((p) => [p.id, p] as const));
  const skusExistentes = new Map([...existentes.values()].filter((p) => p.sku !== undefined).map((p) => [p.sku as string, p.id] as const));
  let totalProductos = existentes.size;
  const idsVistos = new Set<string>();
  const skusVistos = new Map<string, string>();
  const resultado: FilaSimulada[] = [];

  filas.slice(1).forEach((fila, k) => {
    const linea = k + 2;
    const celda = (c: Columna): string | undefined => {
      const i = indice.get(c);
      const v = i === undefined ? undefined : (fila[i] ?? '').trim();
      return v === undefined || v === '' ? undefined : v;
    };
    const errores: string[] = [];
    const advertencias: string[] = [];
    const id = celda('id') ?? '';
    if (fila.every((c) => c.trim() === '')) return; // fila vacía
    if (!ID_PRODUCTO.test(id)) errores.push('id inválido (minúsculas, números y guiones, 2 a 60 caracteres)');
    else if (idsVistos.has(id)) errores.push('id repetido en el archivo');
    idsVistos.add(id);
    const previo = existentes.get(id);

    const datos: { -readonly [c in keyof DatosProducto]?: DatosProducto[c] } = {};
    const texto = (c: 'nombre' | 'categoria' | 'marca', max: number): void => {
      const v = celda(c);
      if (v === undefined) return;
      if (!TEXTO(v, max)) {
        errores.push(`${c}: texto inválido (máximo ${String(max)} caracteres, sin < ni >)`);
        return;
      }
      const n = neutralizarCelda(v);
      if (n !== v) advertencias.push(`${c}: empieza con un carácter de fórmula; se guardó con «'» delante`);
      datos[c] = n;
    };
    texto('nombre', 120);
    texto('categoria', 60);
    texto('marca', 60);
    const sku = celda('sku');
    if (sku !== undefined) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(sku)) errores.push('sku inválido');
      else if (previo !== undefined && sku === previo.sku) skusVistos.set(sku, id); // sin cambio: no se envía
      else if (previo !== undefined) errores.push('sku: no se edita una vez creado el producto');
      else {
        const dueno = skusExistentes.get(sku) ?? skusVistos.get(sku);
        if (dueno !== undefined && dueno !== id) errores.push('sku repetido en otro producto');
        else {
          datos.sku = sku;
          skusVistos.set(sku, id);
        }
      }
    }
    const activo = celda('activo');
    if (activo !== undefined) {
      const a = activo.toLowerCase();
      if (SI.has(a)) datos.activo = true;
      else if (NO.has(a)) datos.activo = false;
      else errores.push('activo: use sí o no');
    }
    const gar = celda('garantiaMeses');
    if (gar !== undefined) {
      if (!/^\d{1,3}$/.test(gar) || Number(gar) < 1 || Number(gar) > 120) errores.push('garantiaMeses: entero de 1 a 120');
      else datos.garantiaMeses = Number(gar);
    }
    const precio: { bo?: number; ar?: number } = {};
    for (const [c, m] of [['precioBO', 'bo'], ['precioAR', 'ar']] as const) {
      const v = celda(c);
      if (v === undefined) continue;
      const n = numeroUsd(v);
      if (n === undefined) errores.push(`${c}: número en USD, hasta 2 decimales, sin signos ni fórmulas`);
      else precio[m] = n;
    }

    let accion: FilaSimulada['accion'];
    if (previo === undefined) {
      if (datos.nombre === undefined) errores.push('nombre: es obligatorio para crear');
      if (datos.categoria === undefined) errores.push('categoria: es obligatoria para crear');
      if (precio.bo === undefined || precio.ar === undefined) advertencias.push('sin precio en algún mercado: quedará «a consultar» (0)');
      if (errores.length === 0 && totalProductos >= LIMITES_CONSOLA.productos) {
        errores.push(`supera el límite de ${String(LIMITES_CONSOLA.productos)} productos del plan`);
      }
      accion = errores.length > 0 ? 'error' : 'crear';
      if (accion === 'crear') totalProductos += 1;
    } else {
      const cambiaDatos = (Object.keys(datos) as (keyof DatosProducto)[]).some((c) => datos[c] !== previo[c]);
      const cambiaPrecio = (precio.bo !== undefined && precio.bo !== previo.precioUSD.bo) || (precio.ar !== undefined && precio.ar !== previo.precioUSD.ar);
      accion = errores.length > 0 ? 'error' : cambiaDatos || cambiaPrecio ? 'actualizar' : 'sin-cambios';
    }
    resultado.push({ linea, id, accion, errores, advertencias, cambios: { datos, precio } });
  });

  const cuenta = (a: FilaSimulada['accion']): number => resultado.filter((f) => f.accion === a).length;
  return {
    filas: resultado,
    resumen: { crear: cuenta('crear'), actualizar: cuenta('actualizar'), sinCambios: cuenta('sin-cambios'), errores: cuenta('error') },
    columnasIgnoradas: ignoradas,
  };
}

export interface DepsImportacion extends DepsSimulacion {
  readonly db: BaseDatosConsola;
  readonly reloj: Reloj;
}

export interface ResultadoImportacion {
  readonly aplicadas: number;
  readonly fallidas: readonly { readonly linea: number; readonly id: string; readonly motivo: string }[];
  readonly simulacion: Simulacion;
}

/**
 * Importa tras volver a simular en el servidor. Con filas inválidas rechaza todo salvo `omitirErrores`.
 * Crear y editar pasan por el puerto del catálogo (Inventarios): la consola no escribe productos ni stock.
 */
export async function importarProductos(
  deps: DepsImportacion,
  e: EntradaImportacion & { readonly omitirErrores?: boolean },
): Promise<ResultadoImportacion> {
  const t = tenantValido(e.tenantId);
  const sim = await simularImportacion(deps, e);
  if (sim.resumen.errores > 0 && e.omitirErrores !== true) {
    throw new ErrorConsola('entrada-invalida', 'El archivo tiene filas con errores; corríjalas o importe omitiéndolas', sim.filas.filter((f) => f.accion === 'error').map((f) => `línea ${String(f.linea)}: ${f.errores.join('; ')}`));
  }
  const existentes = new Map((await deps.catalogo.listarProductos(t)).map((p) => [p.id, p] as const));
  let aplicadas = 0;
  const fallidas: { linea: number; id: string; motivo: string }[] = [];
  for (const f of sim.filas) {
    if (f.accion !== 'crear' && f.accion !== 'actualizar') continue;
    try {
      if (f.accion === 'crear') {
        const d = f.cambios.datos;
        await deps.db.runTransaction((tx) =>
          deps.catalogo.crearProducto(
            tx, t, f.id,
            { ...d, nombre: d.nombre ?? '', categoria: d.categoria ?? '', activo: d.activo ?? true },
            { bo: f.cambios.precio.bo ?? 0, ar: f.cambios.precio.ar ?? 0 },
            e.actor.uid,
          ),
        );
      } else {
        const previo = existentes.get(f.id) as ProductoCatalogo;
        if (Object.keys(f.cambios.datos).length > 0) {
          await deps.db.runTransaction((tx) => deps.catalogo.actualizarDatosProducto(tx, t, f.id, f.cambios.datos, e.actor.uid));
        }
        const { bo, ar } = f.cambios.precio;
        if (bo !== undefined || ar !== undefined) {
          await deps.db.runTransaction((tx) =>
            deps.catalogo.actualizarPrecioUSD(tx, t, f.id, { bo: bo ?? previo.precioUSD.bo, ar: ar ?? previo.precioUSD.ar }, e.actor.uid),
          );
        }
      }
      aplicadas += 1;
    } catch (err) {
      fallidas.push({ linea: f.linea, id: f.id, motivo: err instanceof LimiteDelPlan ? `supera el límite de ${String(err.tope)} productos del plan` : 'no se pudo aplicar la fila' });
    }
  }
  const ahoraIso = new Date(deps.reloj.ahora()).toISOString();
  await deps.db.runTransaction(async (tx) => {
    const estado = await leerEstadoSitio(tx, t);
    if (aplicadas > 0) anotarCambio(tx, t, estado, ahoraIso);
    registrarAuditoria(tx, {
      tenantId: t, uid: e.actor.uid, rol: 'adm', accion: 'productos.importar', ruta: rutaSitio(t, 'estado'),
      resumenDespues: { aplicadas, fallidas: fallidas.length, omitidas: sim.resumen.errores },
    });
  });
  return { aplicadas, fallidas, simulacion: sim };
}

/** Exporta el catálogo a CSV (UTF-8 con BOM para Excel). Neutraliza fórmulas; no incluye stock ni costos. */
export function exportarProductosCsv(productos: readonly ProductoCatalogo[]): string {
  const filas = productos.map((p) => [
    p.id, p.nombre, p.categoria, p.marca ?? '', p.sku ?? '', p.activo ? 'si' : 'no',
    p.garantiaMeses === undefined ? '' : String(p.garantiaMeses), String(p.precioUSD.bo), String(p.precioUSD.ar),
  ]);
  return `\uFEFF${aCsv([COLUMNAS_EXPORTACION, ...filas])}`;
}
