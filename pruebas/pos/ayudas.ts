import type { Redondeo, TransaccionIdentidad } from '@novutienda/nucleo';
import type {
  ActorPos, DepsPos, LineaSalida, ProductoCatalogo, PuertoCatalogo, PuertoInventarios, ReferenciaMovimiento,
} from '@novutienda/pos';
import { DobleDb } from './doble-db.js';

export const T = 'tenant-a';
export const AHORA = Date.UTC(2026, 10, 4, 15, 0, 0); // miércoles 2026-11-04
export const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const caj: ActorPos = { uid: 'u-caj', rol: 'caj' };
export const caj2: ActorPos = { uid: 'u-caj2', rol: 'caj' };
export const sup: ActorPos = { uid: 'u-sup', rol: 'sup' };
export const sup2: ActorPos = { uid: 'u-sup2', rol: 'sup' };
export const adm: ActorPos = { uid: 'u-adm', rol: 'adm' };

export class StockInsuficiente extends Error {}
export class SerieNoDisponible extends Error {}
export class ProductoInactivo extends Error {}

const rutaStock = (almacen: string, producto: string): string => `tenants/${T}/_stock/${almacen}~${producto}`;
const rutaSalida = (id: string): string => `tenants/${T}/_salidas/${id}`;

interface PlanDoble {
  readonly escrituras: readonly (readonly [string, Record<string, unknown>])[];
  readonly lineas: readonly LineaSalida[];
}

/** Doble del puerto de Inventarios: stock y series viven en el mismo doble de base (participan de la serialización). */
export const inventariosDoble: PuertoInventarios = {
  async prepararSalida(tx: TransaccionIdentidad, _t, lineas) {
    const escrituras: [string, Record<string, unknown>][] = [];
    for (const l of lineas) {
      const ruta = rutaStock(l.almacenId, l.productoId);
      const d = (await tx.get(ruta)).data() ?? { cantidad: 0, series: [] };
      const cantidad = d['cantidad'] as number;
      if (cantidad < l.cantidad) throw new StockInsuficiente(`stock insuficiente de ${l.productoId}`);
      const disponibles = [...((d['series'] as string[] | undefined) ?? [])];
      for (const s of l.series ?? []) {
        const i = disponibles.indexOf(s);
        if (i < 0) throw new SerieNoDisponible(`serie no disponible ${s}`);
        disponibles.splice(i, 1);
      }
      escrituras.push([ruta, { cantidad: cantidad - l.cantidad, series: disponibles }]);
    }
    return { escrituras, lineas } satisfies PlanDoble;
  },
  aplicarSalida(tx, plan, ref: ReferenciaMovimiento) {
    const p = plan as PlanDoble;
    for (const [r, d] of p.escrituras) tx.set(r, d);
    tx.set(rutaSalida(ref.id), { lineas: p.lineas as unknown as Record<string, unknown>[] });
  },
  async prepararReversion(tx, _t, ref) {
    const salida = (await tx.get(rutaSalida(ref.id))).data();
    if (salida === undefined) throw new Error('salida inexistente');
    const lineas = salida['lineas'] as LineaSalida[];
    const escrituras: [string, Record<string, unknown>][] = [];
    for (const l of lineas) {
      const ruta = rutaStock(l.almacenId, l.productoId);
      const d = (await tx.get(ruta)).data() ?? { cantidad: 0, series: [] };
      escrituras.push([ruta, { cantidad: (d['cantidad'] as number) + l.cantidad, series: [...((d['series'] as string[]) ?? []), ...(l.series ?? [])] }]);
    }
    return { escrituras, lineas } satisfies PlanDoble;
  },
  aplicarReversion(tx, plan) {
    for (const [r, d] of (plan as PlanDoble).escrituras) tx.set(r, d);
  },
};

export const catalogoDoble: PuertoCatalogo = {
  async leerProducto(tx, _t, id) {
    const d = (await tx.get(`tenants/${T}/_productos/${id}`)).data();
    return d === undefined ? null : (d as unknown as ProductoCatalogo);
  },
};

export const REDONDEO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
};

export interface Entorno {
  readonly db: DobleDb;
  readonly deps: DepsPos;
  reloj: { ahora: number };
}

export function crearEntorno(): Entorno {
  const db = new DobleDb();
  const reloj = { ahora: AHORA };
  db.poner(`tenants/${T}`, { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  db.poner(`tenants/${T}/cotizaciones/BO`, { cotizacionId: 'BO-2026-11-04-1', valor: 7, fecha: '2026-11-04', fuente: 'BCB' });
  db.poner(`tenants/${T}/cotizaciones/AR`, { cotizacionId: 'AR-2026-11-04-1', valor: 1000, fecha: '2026-11-04', fuente: 'BNA' });
  // p1: 10 USD (sin serie); p2: 100 USD con series; p3: sin precio en AR.
  const prod = (id: string, d: Partial<ProductoCatalogo> & { preciosUsd: ProductoCatalogo['preciosUsd'] }): void =>
    db.poner(`tenants/${T}/_productos/${id}`, { productoId: id, nombre: `Producto ${id}`, activo: true, controlaSeries: false, ...d });
  prod('p1', { preciosUsd: { BO: 10, AR: 10 } });
  prod('p2', { preciosUsd: { BO: 100, AR: 100 }, controlaSeries: true, garantiaMeses: 12 });
  prod('p3', { preciosUsd: { BO: 5 } });
  db.poner(rutaStock('tienda', 'p1'), { cantidad: 10, series: [] });
  db.poner(rutaStock('tienda', 'p2'), { cantidad: 3, series: ['S1', 'S2', 'S3'] });
  db.poner(rutaStock('tienda', 'p3'), { cantidad: 1, series: [] });
  const deps: DepsPos = { db, inventarios: inventariosDoble, catalogo: catalogoDoble, redondeo: REDONDEO, ahora: () => reloj.ahora };
  return { db, deps, reloj };
}

export const stock = (e: Entorno, almacen: string, producto: string): number =>
  (e.db.dato(rutaStock(almacen, producto)) as { cantidad: number }).cantidad;

export const eventos = (e: Entorno, tipo?: string): Record<string, unknown>[] =>
  e.db.coleccion(`tenants/${T}/eventos`).filter((x) => tipo === undefined || x['tipo'] === tipo);

export const auditoria = (e: Entorno): Record<string, unknown>[] => e.db.coleccion(`tenants/${T}/auditoria`);

import { abrirTurno, confirmarVenta, type Carrito } from '@novutienda/pos';

export const TURNO = UUID(900);

export const abrir = (e: Entorno, actor: ActorPos = caj, apertura: Record<string, number> = { BOB: 10000 }, id: string = TURNO) =>
  abrirTurno(e.deps, T, actor, id, apertura);

export const carritoP1 = (cantidad = 1, extra: Partial<Carrito> = {}): Carrito => ({
  mercado: 'BO',
  moneda: 'BOB',
  lineas: [{ productoId: 'p1', cantidad }],
  ...extra,
});

export const efectivo = (monto: number, cambio?: number) => ({
  medio: 'efectivo' as const,
  moneda: 'BOB' as const,
  monto,
  ...(cambio !== undefined ? { cambio } : {}),
});

/** Vende `cantidad` de p1 (7000 centavos c/u) en efectivo exacto. */
export const venderP1 = (e: Entorno, n: number, actor: ActorPos = caj, cantidad = 1) =>
  confirmarVenta(e.deps, T, actor, UUID(n), carritoP1(cantidad), [efectivo(7000 * cantidad)]);
