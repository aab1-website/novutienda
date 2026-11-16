import { expect } from 'vitest';
import {
  crearProducto,
  crearUbicacion,
  fijarReloj,
  ingresar,
  UBICACIONES,
  type Autor,
  type EntradaProducto,
} from './api.js';
import { DobleDb } from './doble-db.js';
import type { ConfiguracionComercial } from '@novutienda/nucleo';

export const T = 't1';
export const ADM: Autor = { uid: 'u-adm', rol: 'adm' };
export const SUP: Autor = { uid: 'u-sup', rol: 'sup' };
export const SUP2: Autor = { uid: 'u-sup2', rol: 'sup' };
export const CAJ: Autor = { uid: 'u-caj', rol: 'caj' };

/** El tenant de tres monedas (documento anterior, sin `comercial`): sus mercados son BO y AR, con base en USD. */
export const COMERCIAL_TRES: ConfiguracionComercial = {
  mercados: [
    { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', zonaHoraria: 'America/La_Paz', tipoCambio: { par: 'BOB/USD', fuentes: ['BCB'] }, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' } },
    { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', zonaHoraria: 'America/Argentina/Buenos_Aires', tipoCambio: { par: 'ARS/USD', fuentes: ['BNA', 'BCRA'] }, redondeo: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } },
  ],
  monedas: ['BOB', 'USD', 'ARS'],
};

/** Un comercio de UN mercado, una moneda y sin tipo de cambio (el precio base es el precio). */
export const COMERCIAL_UN_MERCADO: ConfiguracionComercial = {
  mercados: [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', zonaHoraria: 'America/Lima', tipoCambio: null, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' } }],
  monedas: ['PEN'],
};

export const tenantOk = { estado: 'activo', plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };

export const producto = (id: string, extra: Partial<EntradaProducto> = {}): EntradaProducto => ({
  id,
  nombre: `Producto ${id}`,
  categoria: 'general',
  sku: `SKU-${id}`,
  precioUSD: { bo: 1000, ar: 1100 },
  ...extra,
});

let n = 0;
export const op = (prefijo = 'op'): string => `${prefijo}-${String((n += 1))}`;

/** Entorno con tenant, las tres ubicaciones y el reloj fijo. */
export async function nuevoEntorno(): Promise<DobleDb> {
  fijarReloj(() => Date.parse('2026-11-04T12:00:00.000Z'));
  const db = new DobleDb();
  db.poner(`tenants/${T}`, tenantOk);
  for (const u of UBICACIONES) {
    await db.runTransaction((tx) => crearUbicacion(tx, { tenantId: T, operacionId: op('ubic'), por: ADM, ubicacionId: u, nombre: u }));
  }
  return db;
}

export async function altaProducto(db: DobleDb, p: EntradaProducto): Promise<void> {
  await db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op('prod'), por: ADM, producto: p }));
}

export async function cargar(
  db: DobleDb,
  productoId: string,
  ubicacionId: string,
  cantidad: number,
  series?: string[],
): Promise<void> {
  await db.runTransaction((tx) =>
    ingresar(tx, {
      tenantId: T,
      operacionId: op('ing'),
      por: SUP,
      ubicacionId,
      lineas: [{ productoId, cantidad, ...(series !== undefined ? { series } : {}) }],
    }),
  );
}

export const doc = (db: DobleDb, coleccion: string, id: string): Record<string, unknown> | undefined =>
  db.dato(`tenants/${T}/${coleccion}/${id}`) as Record<string, unknown> | undefined;

export const contar = (db: DobleDb, coleccion: string): number => db.coleccion(`tenants/${T}/${coleccion}`).length;

/** Invariantes del módulo: se comprueban después de cada operación. */
export function verificarInvariantes(db: DobleDb): void {
  const productos = db.coleccion(`tenants/${T}/productos`);
  for (const { ruta, datos } of productos) {
    const id = ruta.split('/').pop() as string;
    if (typeof datos['stockTotal'] !== 'number') continue;
    const exs = db.coleccion(`tenants/${T}/existencias`).filter((e) => e.datos['productoId'] === id);
    let suma = 0;
    for (const e of exs) {
      const cantidad = e.datos['cantidad'] as number;
      expect(Number.isInteger(cantidad) && cantidad >= 0, `saldo negativo en ${e.ruta}`).toBe(true);
      suma += cantidad;
      if (datos['conSerie'] === true) {
        const series = e.datos['series'] as string[];
        expect(series.length, `series vs cantidad en ${e.ruta}`).toBe(cantidad);
        const disponibles = db
          .coleccion(`tenants/${T}/unidades`)
          .filter((u) => u.datos['productoId'] === id && u.datos['ubicacionId'] === e.datos['ubicacionId'] && u.datos['estado'] === 'disponible')
          .map((u) => u.datos['serie'] as string)
          .sort();
        expect(disponibles, `unidades disponibles vs series en ${e.ruta}`).toEqual([...series].sort());
      }
    }
    expect(suma, `suma de existencias vs stockTotal de ${id}`).toBe(datos['stockTotal']);
    const pub = doc(db, 'existenciasPublicas', id);
    // Regla única: activo y existencia en `tienda` > 0 (los depósitos no cuentan).
    const tienda = exs.find((e) => e.datos['ubicacionId'] === 'tienda')?.datos['cantidad'] as number | undefined;
    expect(pub?.['disponible'], `disponibilidad pública de ${id}`).toBe(datos['activo'] === true && (tienda ?? 0) > 0);
    const min = datos['minimo'];
    expect(datos['bajoMinimo']).toBe(typeof min === 'number' && datos['stockTotal'] <= min);
  }
}
