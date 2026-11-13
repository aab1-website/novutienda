import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { aplicarPlan } from './aplicar.js';
import {
  EntradaInvalida,
  EstadoInvalido,
  NoEncontrado,
  ProductoInactivo,
  SerieNoDisponible,
  StockInsuficiente,
  type Faltante,
} from './errores.js';
import { hashCarga } from './hash.js';
import {
  esIdSegmento,
  exigirCantidad,
  exigirProducto,
  exigirSeries,
  exigirTenant,
  exigirUbicacion,
  MAX_LINEAS,
  idUnidad,
} from './ids.js';
import { Lector, sumarMeses, Trabajo, type Autor, type Datos, type PlanStock } from './motor.js';
import { exigirAutor } from './operacion.js';

/** Línea que el POS o los pedidos piden descontar. */
export interface LineaSalida {
  readonly productoId: string;
  readonly cantidad: number;
  readonly almacenId: string;
  /** En productos con serie: las vendidas. Si es `undefined`, se asigna la más antigua; `[]` se rechaza. */
  readonly series?: readonly string[];
}

export interface LineaResuelta {
  readonly productoId: string;
  readonly almacenId: string;
  readonly cantidad: number;
  readonly series: readonly string[];
}

export interface ReferenciaSalida {
  readonly tipo: 'venta' | 'pedido';
  readonly id: string;
}

export interface PlanSalida extends PlanStock {
  readonly tipo: 'salida';
  /** Solo las líneas que controlan stock (las demás no se mueven ni se registran). */
  readonly lineas: readonly LineaResuelta[];
}

export interface PlanReversion extends PlanStock {
  readonly tipo: 'reversion';
  readonly lineas: readonly LineaResuelta[];
  /** `true` si la reversión ya se aplicó: `aplicarReversion` no escribe nada. */
  readonly repetida: boolean;
}

export const idOperacionSalida = (ref: ReferenciaSalida): string => (ref.tipo === 'venta' ? `venta-${ref.id}` : `nc-${ref.id}`);
export const idOperacionReversion = (ref: ReferenciaSalida): string =>
  ref.tipo === 'venta' ? `venta-anula-${ref.id}` : `nc-anula-${ref.id}`;

function exigirReferencia(ref: ReferenciaSalida): void {
  if ((ref?.tipo !== 'venta' && ref?.tipo !== 'pedido') || !esIdSegmento(ref.id)) throw new EntradaInvalida('referencia inválida');
}

interface LineaNormalizada {
  productoId: string;
  almacenId: string;
  cantidad: number;
  series: string[] | undefined;
}

/** Valida cada línea (estricto) y fusiona las repetidas de un mismo (producto, almacén). */
function normalizar(lineas: readonly LineaSalida[]): LineaNormalizada[] {
  if (!Array.isArray(lineas) || lineas.length < 1 || lineas.length > MAX_LINEAS) {
    throw new EntradaInvalida(`lineas debe tener entre 1 y ${MAX_LINEAS} elementos`);
  }
  const porClave = new Map<string, LineaNormalizada>();
  for (const l of lineas) {
    const productoId = exigirProducto(l.productoId);
    const almacenId = exigirUbicacion(l.almacenId);
    const cantidad = exigirCantidad(l.cantidad);
    const series = l.series === undefined ? undefined : exigirSeries(l.series);
    const k = `${productoId}|${almacenId}`;
    const previa = porClave.get(k);
    if (previa === undefined) {
      porClave.set(k, { productoId, almacenId, cantidad, series: series === undefined ? undefined : [...series] });
      continue;
    }
    if ((previa.series === undefined) !== (series === undefined)) throw new EntradaInvalida('líneas repetidas mezclan series y no series');
    previa.cantidad += cantidad;
    if (previa.series !== undefined && series !== undefined) previa.series.push(...series);
  }
  const todas = [...porClave.values()];
  const vistas = new Set<string>();
  for (const l of todas) {
    for (const s of l.series ?? []) {
      const k = idUnidad(l.productoId, s);
      if (vistas.has(k)) throw new EntradaInvalida(`serie repetida: ${s}`);
      vistas.add(k);
    }
  }
  return todas;
}

export interface OpcionesSalida {
  /** Zona de la fecha de calendario de `garantiaHasta`. Por defecto `America/La_Paz`, como Recibos. */
  readonly zonaHoraria?: string;
}

/**
 * SOLO LECTURAS. Verifica productos activos, stock y series, y calcula el plan.
 * Lanza `StockInsuficiente` (con todos los faltantes), `SerieNoDisponible` o `ProductoInactivo`.
 * Un producto sin `stockTotal` no controla stock: su línea no mueve nada.
 */
export async function prepararSalida(
  tx: TransaccionIdentidad,
  tenantId: string,
  lineas: readonly LineaSalida[],
  opciones: OpcionesSalida = {},
): Promise<PlanSalida> {
  exigirTenant(tenantId);
  const norm = normalizar(lineas);
  const t = new Trabajo(new Lector(tx, tenantId));
  await Promise.all(norm.map((l) => t.cargar(l.productoId, l.almacenId)));

  // Fase 1: TODO lo que no depende de la cantidad en stock (producto activo, formato y pertenencia de cada serie al
  // producto y a la ubicación, coherencia entre series y cantidad). Así una entrada inválida falla siempre igual,
  // haya o no stock: el error nunca distingue «stock >= N» de «stock < N».
  const pendientes: { l: LineaNormalizada; series: string[] | undefined }[] = [];
  for (const l of norm) {
    const prod = t.producto(l.productoId);
    if (prod['activo'] !== true) throw new ProductoInactivo(l.productoId, 'inactivo');
    if (typeof prod['stockTotal'] !== 'number') continue;
    const ex = t.existencia(l.productoId, l.almacenId);
    let series: string[] | undefined;
    if (prod['conSerie'] === true) {
      if (l.series === undefined) series = undefined;
      else if (l.series.length !== l.cantidad) throw new EntradaInvalida(`${l.productoId}: las series deben ser tantas como la cantidad`);
      else {
        series = l.series;
        await Promise.all(series.map((s) => t.unidad(l.productoId, s)));
        for (const s of series) {
          const u = t.unidadLeida(l.productoId, s);
          if (u === undefined || u['estado'] !== 'disponible' || u['ubicacionId'] !== l.almacenId || !ex.series.includes(s)) {
            throw new SerieNoDisponible(l.productoId, s);
          }
        }
      }
    } else if (l.series !== undefined && l.series.length > 0) {
      throw new EntradaInvalida(`${l.productoId} no lleva serie`);
    }
    pendientes.push({ l, series });
  }

  // Fase 2: la cantidad. Con series explícitas ya validadas, hay al menos tantas disponibles como se piden.
  const faltantes: Faltante[] = [];
  const resueltas: LineaResuelta[] = [];
  for (const { l, series: explicitas } of pendientes) {
    const ex = t.existencia(l.productoId, l.almacenId);
    if (ex.cantidad < l.cantidad) {
      faltantes.push({ productoId: l.productoId, almacenId: l.almacenId, pedido: l.cantidad, disponible: ex.cantidad });
      continue;
    }
    const conSerie = t.producto(l.productoId)['conSerie'] === true;
    const series = conSerie ? (explicitas ?? ex.series.slice(0, l.cantidad)) : [];
    resueltas.push({ productoId: l.productoId, almacenId: l.almacenId, cantidad: l.cantidad, series });
  }
  if (faltantes.length > 0) throw new StockInsuficiente(faltantes);

  for (const l of resueltas) {
    t.mover(l.productoId, l.almacenId, -l.cantidad, { quitar: l.series });
    const meses = t.producto(l.productoId)['garantiaMeses'];
    for (const s of l.series) {
      t.marcarUnidad({
        productoId: l.productoId,
        serie: s,
        ...(t.unidadLeida(l.productoId, s) !== undefined ? { base: t.unidadLeida(l.productoId, s) as Datos } : {}),
        estado: 'vendida',
        ubicacionId: l.almacenId,
        ...(typeof meses === 'number' && Number.isSafeInteger(meses) && meses > 0 ? { garantiaHasta: sumarMeses(t.ahora, meses, opciones.zonaHoraria) } : {}),
        modo: 'set',
      });
    }
  }
  return { ...t.plan(), tipo: 'salida', lineas: resueltas };
}

/** Huella de una salida: producto, almacén y cantidad (sin series, que pueden asignarse automáticamente). */
export function hashSalida(lineas: readonly { productoId: string; almacenId: string; cantidad: number }[]): string {
  const porClave = new Map<string, { productoId: string; almacenId: string; cantidad: number }>();
  for (const l of lineas) {
    const k = `${l.productoId}|${l.almacenId}`;
    const p = porClave.get(k);
    porClave.set(k, { productoId: l.productoId, almacenId: l.almacenId, cantidad: (p?.cantidad ?? 0) + l.cantidad });
  }
  return hashCarga('salida', [...porClave.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v));
}

const lineasJson = (ls: readonly LineaResuelta[]): Datos[] =>
  ls.map((l) => ({ productoId: l.productoId, almacenId: l.almacenId, cantidad: l.cantidad, series: [...l.series] }));

/**
 * SOLO ESCRITURAS, en la transacción del POS o del pedido: existencias, stockTotal, bajoMinimo,
 * existenciasPublicas, unidades → vendida con garantiaHasta, movimientos (`create`), la operación
 * `venta-{id}` / `nc-{id}` (`create`: repetirla hace fallar la transacción), eventos y auditoría.
 * Quien llama debe haber comprobado antes que su propio documento (venta, pedido) no existe.
 */
export function aplicarSalida(
  tx: TransaccionIdentidad,
  plan: PlanSalida,
  ref: ReferenciaSalida,
  por: Autor,
): void {
  exigirReferencia(ref);
  const autor = exigirAutor(por);
  const lineas = lineasJson(plan.lineas);
  aplicarPlan(tx, plan, {
    operacionId: idOperacionSalida(ref),
    tipoOperacion: 'salida',
    accion: `inventarios.salida-${ref.tipo}`,
    referencia: { tipo: ref.tipo, id: ref.id },
    tipoMovimiento: ref.tipo,
    por: autor,
    hashCarga: hashSalida(plan.lineas),
    resultado: { lineas },
    resumen: { referencia: `${ref.tipo}:${ref.id}`, lineas: lineas.length },
  });
}

function leerLineas(op: Datos): LineaResuelta[] {
  const r = op['resultado'] as { lineas?: unknown } | undefined;
  if (!Array.isArray(r?.lineas)) throw new EstadoInvalido('La operación original no guarda líneas');
  return (r.lineas as Datos[]).map((l) => ({
    productoId: exigirProducto(l['productoId']),
    almacenId: exigirUbicacion(l['almacenId']),
    cantidad: exigirCantidad(l['cantidad']),
    series: exigirSeries(l['series']),
  }));
}

/**
 * SOLO LECTURAS. Lee la operación original (`venta-{id}`/`nc-{id}`) y prepara la devolución
 * de stock y series. Si ya se revirtió, devuelve un plan `repetida` sin escrituras.
 */
export async function prepararReversion(
  tx: TransaccionIdentidad,
  tenantId: string,
  ref: ReferenciaSalida,
): Promise<PlanReversion> {
  exigirTenant(tenantId);
  exigirReferencia(ref);
  const lector = new Lector(tx, tenantId);
  const [orig, rev] = await Promise.all([
    lector.leer('operaciones', idOperacionSalida(ref)),
    lector.leer('operaciones', idOperacionReversion(ref)),
  ]);
  if (orig === undefined) throw new NoEncontrado(`No hay salida registrada para ${ref.tipo}:${ref.id}`);
  const t = new Trabajo(lector);
  if (rev !== undefined) return { ...t.plan(), tipo: 'reversion', lineas: [], repetida: true };
  const lineas = leerLineas(orig);
  await Promise.all(lineas.map((l) => t.cargar(l.productoId, l.almacenId)));
  for (const l of lineas) await Promise.all(l.series.map((s) => t.unidad(l.productoId, s)));
  for (const l of lineas) {
    for (const s of l.series) {
      const u = t.unidadLeida(l.productoId, s);
      const vr = u?.['ventaRef'] as { tipo?: unknown; id?: unknown } | undefined;
      if (u === undefined || u['estado'] !== 'vendida' || vr?.tipo !== ref.tipo || vr.id !== ref.id) {
        throw new EstadoInvalido(`La serie ${s} no está vendida en ${ref.tipo}:${ref.id}`);
      }
    }
    t.mover(l.productoId, l.almacenId, l.cantidad, { agregar: l.series });
    for (const s of l.series) {
      t.marcarUnidad({
        productoId: l.productoId,
        serie: s,
        base: t.unidadLeida(l.productoId, s) as Datos,
        estado: 'disponible',
        ubicacionId: l.almacenId,
        modo: 'set',
      });
    }
  }
  return { ...t.plan(), tipo: 'reversion', lineas, repetida: false };
}

/** SOLO ESCRITURAS. Operación `venta-anula-{id}` / `nc-anula-{id}`. No hace nada si el plan es `repetida`. */
export function aplicarReversion(tx: TransaccionIdentidad, plan: PlanReversion, ref: ReferenciaSalida, por: Autor): void {
  exigirReferencia(ref);
  const autor = exigirAutor(por);
  if (plan.repetida) return;
  const lineas = lineasJson(plan.lineas);
  aplicarPlan(tx, plan, {
    operacionId: idOperacionReversion(ref),
    tipoOperacion: 'reversion',
    accion: `inventarios.reversion-${ref.tipo}`,
    referencia: { tipo: ref.tipo, id: ref.id },
    tipoMovimiento: 'anulacion',
    por: autor,
    hashCarga: hashCarga('reversion', lineas),
    resultado: { lineas },
    resumen: { referencia: `${ref.tipo}:${ref.id}`, lineas: lineas.length },
  });
}
