// Entorno compartido de las pruebas de integración: UNA base serializable para todos los módulos,
// los puertos reales de la plataforma y los datos mínimos (tenant, almacenes, cotizaciones, productos).
import {
  UBICACIONES, crearProducto, crearUbicacion, fijarReloj, ingresar, type Autor, type EntradaProducto,
} from '@novutienda/inventarios';
import { cargarManual, leerCotizacion, type CopiaCotizacion, type IdModulo, type Mercado, type Redondeo } from '@novutienda/nucleo';
import type { ActorPos, DepsPos } from '@novutienda/pos';
import {
  almacenCotizacionesDesde, catalogoParaPos, consumidoresDePlataforma, crearCatalogoConsola, ejecutorRecibosDesde, inventariosParaPos,
} from '../../plataforma/coordinador/index.js';
import { BandejaMemoria } from './bandeja-memoria.js';
import { DobleDb } from './doble-db.js';

export const T = 'casa-a';
export const T2 = 'casa-b';
/** Miércoles 2026-11-04 11:00 en La Paz. */
export const AHORA = Date.UTC(2026, 10, 4, 15, 0, 0);
export const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const caj: ActorPos = { uid: 'u-caj', rol: 'caj' };
export const sup: ActorPos = { uid: 'u-sup', rol: 'sup' };
export const adm: ActorPos = { uid: 'u-adm', rol: 'adm' };
export const ADM: Autor = { uid: 'u-adm', rol: 'adm' };
export const SUP: Autor = { uid: 'u-sup', rol: 'sup' };

export const REDONDEO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
};

const tenantOk = { estado: 'activo', plan: 'base', modulos: { consola: { version: '0.1.0', submodulos: [] }, inventarios: { version: '0.1.0', submodulos: [] }, pos: { version: '0.1.0', submodulos: [] }, recibos: { version: '0.1.0', submodulos: [] }, website: { version: '0.1.0', submodulos: [] } }, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };
const ACTOR_COTIZACION = { uid: 'u-adm', rol: 'adm', proveedor: 'password' } as const;

let secuencia = 0;
export const op = (prefijo = 'op'): string => `${prefijo}-${String((secuencia += 1))}`;

export interface Entorno {
  readonly db: DobleDb;
  readonly reloj: { ahora: number };
  readonly deps: DepsPos;
  readonly bandeja: BandejaMemoria;
  readonly recibos: ReturnType<typeof ejecutorRecibosDesde>;
  readonly catalogoConsola: ReturnType<typeof crearCatalogoConsola>;
  readonly almacen: ReturnType<typeof almacenCotizacionesDesde>;
}

/** Entorno vacío (sin tenants). Fija el reloj de Inventarios, que es global del módulo. */
export function crearEntorno(): Entorno {
  const reloj = { ahora: AHORA };
  fijarReloj(() => reloj.ahora);
  const db = new DobleDb();
  const deps: DepsPos = {
    db, inventarios: inventariosParaPos, catalogo: catalogoParaPos, redondeo: REDONDEO, ahora: () => reloj.ahora,
  };
  return {
    db,
    reloj,
    deps,
    bandeja: new BandejaMemoria(db, consumidoresDePlataforma(db, { ahora: () => new Date(reloj.ahora).toISOString() }, async (t) => Object.keys((db.dato(`tenants/${t}`)?.['modulos'] as object | undefined) ?? {}) as IdModulo[])),
    recibos: ejecutorRecibosDesde(db),
    catalogoConsola: crearCatalogoConsola({ db, lector: db }),
    almacen: almacenCotizacionesDesde(db),
  };
}

export const COTIZACION_BO = 7;
export const COTIZACION_AR = 1000;

/** Tenant con sus 3 almacenes (por Inventarios) y las cotizaciones del día cargadas con `cargarManual` del núcleo. */
export async function prepararTenant(e: Entorno, tenantId: string): Promise<void> {
  e.db.poner(`tenants/${tenantId}`, tenantOk);
  for (const u of UBICACIONES) {
    await e.db.runTransaction((tx) => crearUbicacion(tx, { tenantId, operacionId: op('ubic'), por: ADM, ubicacionId: u, nombre: u }));
  }
  const fecha = '2026-11-04';
  for (const [mercado, valor] of [['BO', COTIZACION_BO], ['AR', COTIZACION_AR]] as const) {
    await cargarManual(e.almacen, { mercado, valor, fecha, actor: ACTOR_COTIZACION, ahoraMs: e.reloj.ahora }, { tenantId });
  }
}

export const producto = (id: string, extra: Partial<EntradaProducto> = {}): EntradaProducto => ({
  id,
  nombre: `Producto ${id}`,
  categoria: 'general',
  sku: `SKU-${id}`,
  precioUSD: { bo: 1000, ar: 1000 },
  ...extra,
});

export async function altaProducto(e: Entorno, tenantId: string, p: EntradaProducto): Promise<void> {
  await e.db.runTransaction((tx) => crearProducto(tx, { tenantId, operacionId: op('prod'), por: ADM, producto: p }));
}

export async function cargarStock(e: Entorno, tenantId: string, productoId: string, ubicacionId: string, cantidad: number, series?: string[]): Promise<void> {
  await e.db.runTransaction((tx) =>
    ingresar(tx, {
      tenantId, operacionId: op('ing'), por: SUP, ubicacionId,
      lineas: [{ productoId, cantidad, ...(series !== undefined ? { series } : {}) }],
    }),
  );
}

/**
 * Catálogo estándar: `lapiz` (sin serie, 10 USD en ambos mercados) y `celular` (con serie, garantía de
 * 12 meses, 100 USD). Stock: lapiz 10 en tienda y 5 en deposito-1; celular A, B, C en tienda.
 */
export async function catalogoEstandar(e: Entorno, tenantId: string): Promise<void> {
  await altaProducto(e, tenantId, producto('lapiz', { nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 } }));
  await altaProducto(e, tenantId, producto('celular', { nombre: 'Celular X1', conSerie: true, garantiaMeses: 12, precioUSD: { bo: 10000, ar: 10000 }, minimo: 1 }));
  await cargarStock(e, tenantId, 'lapiz', 'tienda', 10);
  await cargarStock(e, tenantId, 'lapiz', 'deposito-1', 5);
  await cargarStock(e, tenantId, 'celular', 'tienda', 3, ['A', 'B', 'C']);
}

export async function entornoListo(tenantId = T): Promise<Entorno> {
  const e = crearEntorno();
  await prepararTenant(e, tenantId);
  await catalogoEstandar(e, tenantId);
  return e;
}

export const cotizacionVigente = (e: Entorno, mercado: Mercado, tenantId = T): Promise<CopiaCotizacion> =>
  leerCotizacion(e.almacen, mercado, e.reloj.ahora, { tenantId });

export const doc = (e: Entorno, tenantId: string, ruta: string): Record<string, unknown> | undefined =>
  e.db.dato(`tenants/${tenantId}/${ruta}`) as Record<string, unknown> | undefined;

export const eventosDe = (e: Entorno, tenantId: string, tipo: string): Record<string, unknown>[] =>
  e.db.coleccion(`tenants/${tenantId}/eventos`).map((x) => x.datos).filter((x) => x['tipo'] === tipo);

export const contar = (e: Entorno, tenantId: string, coleccion: string): number => e.db.coleccion(`tenants/${tenantId}/${coleccion}`).length;
