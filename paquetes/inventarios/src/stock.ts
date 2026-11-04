import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { EntradaInvalida, ErrorInventario, EstadoInvalido, SerieNoDisponible } from './errores.js';
import { exigirCantidad, exigirProducto, exigirSeries, exigirUbicacion, MAX_CANTIDAD, MAX_LINEAS, ruta } from './ids.js';
import { MARCA_SERVIDOR, type Autor, type Datos, type Trabajo } from './motor.js';
import { ejecutarOperacion, exigirAutor, exigirListaLineas, exigirMotivo, PERMISOS, type ResultadoOperacion } from './operacion.js';

export interface LineaIngreso {
  readonly productoId: string;
  readonly cantidad: number;
  /** Obligatoria (una por unidad) en productos con serie; prohibida en los demás. */
  readonly series?: readonly string[];
}

export interface LineaTraspaso {
  readonly productoId: string;
  readonly cantidad: number;
  readonly series?: readonly string[];
}

export interface LineaAjuste {
  readonly productoId: string;
  readonly ubicacionId: string;
  /** Entero distinto de cero: positivo suma, negativo resta. */
  readonly delta: number;
}

interface Base {
  readonly tenantId: string;
  readonly operacionId: string;
  readonly por: Autor;
}

function lineasUnicas<T extends { productoId: string }>(ls: readonly T[]): T[] {
  const vistos = new Set<string>();
  for (const l of ls) {
    if (vistos.has(l.productoId)) throw new EntradaInvalida(`producto repetido en las líneas: ${l.productoId}`);
    vistos.add(l.productoId);
  }
  return [...ls];
}

export interface LineaValida {
  productoId: string;
  cantidad: number;
  series: string[] | undefined;
}

function validarLineas(x: readonly (LineaIngreso | LineaTraspaso)[]): LineaValida[] {
  exigirListaLineas(x, MAX_LINEAS);
  return lineasUnicas(
    x.map((l) => ({
      productoId: exigirProducto(l.productoId),
      cantidad: exigirCantidad(l.cantidad),
      series: l.series === undefined ? undefined : exigirSeries(l.series),
    })),
  );
}

const ordenar = <T extends { productoId: string }>(ls: readonly T[]): T[] => [...ls].sort((a, b) => a.productoId.localeCompare(b.productoId));

/** Reglas de series de una línea: producto con serie exige una por unidad; sin serie, ninguna. */
export function seriesDeLinea(t: Trabajo, l: LineaValida): string[] {
  const conSerie = t.producto(l.productoId)['conSerie'] === true;
  if (!conSerie) {
    if (l.series !== undefined && l.series.length > 0) throw new EntradaInvalida(`${l.productoId} no lleva serie`);
    return [];
  }
  if (l.series === undefined || l.series.length !== l.cantidad) {
    throw new EntradaInvalida(`${l.productoId}: se requiere una serie por unidad`);
  }
  return l.series;
}

export function exigirControl(t: Trabajo, productoId: string): void {
  if (typeof t.producto(productoId)['stockTotal'] !== 'number') throw new EstadoInvalido(`El producto ${productoId} no controla stock`);
}

/** Ingreso de mercadería a una ubicación. Las unidades con serie se crean con `create`. Sup/adm. */
export async function ingresar(
  tx: TransaccionIdentidad,
  e: Base & { ubicacionId: string; lineas: readonly LineaIngreso[] },
): Promise<ResultadoOperacion<Datos>> {
  const ubicacionId = exigirUbicacion(e.ubicacionId);
  const lineas = validarLineas(e.lineas);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'ingreso',
    accion: 'inventarios.ingreso',
    carga: { ubicacionId, lineas: ordenar(lineas) },
    por: exigirAutor(e.por),
    roles: PERMISOS.ingreso,
    construir: async (t) => {
      await Promise.all(lineas.map((l) => t.cargar(l.productoId, ubicacionId)));
      const salida: Datos[] = [];
      for (const l of lineas) {
        exigirControl(t, l.productoId);
        const series = seriesDeLinea(t, l);
        await Promise.all(series.map((s) => t.unidad(l.productoId, s)));
        for (const s of series) {
          if (t.unidadLeida(l.productoId, s) !== undefined) throw new ErrorInventario('already-exists', `La serie ya está registrada: ${l.productoId}/${s}`);
          t.marcarUnidad({ productoId: l.productoId, serie: s, estado: 'disponible', ubicacionId, modo: 'create' });
        }
        t.mover(l.productoId, ubicacionId, l.cantidad, { agregar: series });
        salida.push({ productoId: l.productoId, cantidad: l.cantidad, series: [...series] });
      }
      return {
        resultado: { ubicacionId, lineas: salida },
        referencia: { tipo: 'ingreso', id: e.operacionId },
        tipoMovimiento: 'ingreso',
      };
    },
  });
}

/** Traspaso inmediato (sin «en tránsito») entre dos ubicaciones distintas. Sup/adm. */
export async function traspasar(
  tx: TransaccionIdentidad,
  e: Base & { origenId: string; destinoId: string; lineas: readonly LineaTraspaso[] },
): Promise<ResultadoOperacion<Datos>> {
  const origenId = exigirUbicacion(e.origenId);
  const destinoId = exigirUbicacion(e.destinoId);
  if (origenId === destinoId) throw new EntradaInvalida('origen y destino deben ser distintos');
  const lineas = validarLineas(e.lineas);
  const por = exigirAutor(e.por);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'traspaso',
    accion: 'inventarios.traspaso',
    carga: { origenId, destinoId, lineas: ordenar(lineas) },
    por,
    roles: PERMISOS.traspaso,
    construir: async (t) => {
      await Promise.all(lineas.flatMap((l) => [t.cargar(l.productoId, origenId), t.cargar(l.productoId, destinoId)]));
      const salida: Datos[] = [];
      for (const l of lineas) {
        exigirControl(t, l.productoId);
        const series = seriesDeLinea(t, l);
        await Promise.all(series.map((s) => t.unidad(l.productoId, s)));
        for (const s of series) {
          const u = t.unidadLeida(l.productoId, s);
          if (u === undefined || u['estado'] !== 'disponible' || u['ubicacionId'] !== origenId) throw new SerieNoDisponible(l.productoId, s);
          t.marcarUnidad({ productoId: l.productoId, serie: s, base: u, estado: 'disponible', ubicacionId: destinoId, modo: 'set' });
        }
        t.mover(l.productoId, origenId, -l.cantidad, { quitar: series, tipo: 'traspaso' });
        t.mover(l.productoId, destinoId, l.cantidad, { agregar: series, tipo: 'traspaso' });
        salida.push({ productoId: l.productoId, cantidad: l.cantidad, series: [...series] });
      }
      t.escribir({
        ruta: ruta(t.tenantId, 'traspasos', e.operacionId),
        modo: 'create',
        datos: { origenId, destinoId, lineas: salida, por: por.uid, rol: por.rol, fecha: MARCA_SERVIDOR },
      });
      return {
        resultado: { origenId, destinoId, lineas: salida },
        referencia: { tipo: 'traspaso', id: e.operacionId },
        tipoMovimiento: 'traspaso',
      };
    },
  });
}

/** Ajuste manual de existencias. Solo adm, con motivo obligatorio y nunca en productos con serie. */
export async function ajustar(
  tx: TransaccionIdentidad,
  e: Base & { motivo: string; lineas: readonly LineaAjuste[] },
): Promise<ResultadoOperacion<Datos>> {
  const motivo = exigirMotivo(e.motivo);
  exigirListaLineas(e.lineas, MAX_LINEAS);
  const vistos = new Set<string>();
  const lineas = e.lineas.map((l) => {
    const productoId = exigirProducto(l.productoId);
    const ubicacionId = exigirUbicacion(l.ubicacionId);
    if (!Number.isSafeInteger(l.delta) || l.delta === 0 || Math.abs(l.delta) > MAX_CANTIDAD) throw new EntradaInvalida('delta inválido');
    const k = `${productoId}|${ubicacionId}`;
    if (vistos.has(k)) throw new EntradaInvalida(`línea repetida: ${k}`);
    vistos.add(k);
    return { productoId, ubicacionId, delta: l.delta };
  });
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'ajuste',
    accion: 'inventarios.ajuste',
    carga: { motivo, lineas: [...lineas].sort((a, b) => `${a.productoId}${a.ubicacionId}`.localeCompare(`${b.productoId}${b.ubicacionId}`)) },
    por: exigirAutor(e.por),
    roles: PERMISOS.ajuste,
    construir: async (t) => {
      await Promise.all(lineas.map((l) => t.cargar(l.productoId, l.ubicacionId)));
      for (const l of lineas) {
        exigirControl(t, l.productoId);
        if (t.producto(l.productoId)['conSerie'] === true) {
          throw new EntradaInvalida(`${l.productoId}: el ajuste no se admite en productos con serie (use ingreso o merma)`);
        }
        t.mover(l.productoId, l.ubicacionId, l.delta, { tipo: 'ajuste' });
      }
      return {
        resultado: { lineas: lineas.map((l) => ({ ...l })) },
        referencia: { tipo: 'ajuste', id: e.operacionId },
        tipoMovimiento: 'ajuste',
        motivo,
      };
    },
  });
}
