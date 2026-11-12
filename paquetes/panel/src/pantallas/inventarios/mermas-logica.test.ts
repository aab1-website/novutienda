import { describe, expect, it } from 'vitest';
import type { MermaVista, ProductoPanel } from '../../api/tipos.js';
import { MERMA_INICIAL, ordenarMermas, resumenResolucion, revisarSolicitud } from './mermas-logica.js';

const prod = (conSerie = false): ProductoPanel => ({ id: 'cable', nombre: 'Cable', categoria: 'c', sku: 's', activo: true, publicado: false, conSerie, precioUSD: { bo: 1, ar: 1 }, stockTotal: 5, existencias: { tienda: 5, 'deposito-1': 0, 'deposito-2': 0 }, bajoMinimo: false, disponible: true });
const merma = (mermaId: string, estado: MermaVista['estado'], fecha: string): MermaVista => ({ mermaId, productoId: 'cable', ubicacionId: 'tienda', cantidad: 2, series: [], motivo: 'roto', estado, solicitadaPor: 'u', fecha });

describe('ordenarMermas', () => {
  it('pone las pendientes primero y, en cada grupo, lo más reciente arriba', () => {
    const o = ordenarMermas([merma('a', 'aprobada', '2026-11-04'), merma('b', 'solicitada', '2026-11-01'), merma('c', 'solicitada', '2026-11-03'), merma('d', 'rechazada', '2026-11-05')]);
    expect(o.map((m) => m.mermaId)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('revisarSolicitud', () => {
  it('marca producto, cantidad y motivo', () => {
    expect(Object.keys(revisarSolicitud({ ...MERMA_INICIAL, cantidad: '0' }, undefined)).sort()).toEqual(['cantidad', 'motivo', 'producto']);
  });
  it('no deja dar de baja más de lo que hay en el almacén', () => {
    expect(revisarSolicitud({ ...MERMA_INICIAL, productoId: 'cable', cantidad: '9', motivo: 'x' }, prod())['cantidad']).toMatch(/En Tienda hay 5/);
    expect(revisarSolicitud({ ...MERMA_INICIAL, productoId: 'cable', cantidad: '5', motivo: 'x' }, prod())).toEqual({});
  });
  it('con serie pide las series', () => {
    expect(revisarSolicitud({ ...MERMA_INICIAL, productoId: 'cable', motivo: 'x' }, prod(true))['series']).toMatch(/serie/);
  });
});

describe('resumenResolucion', () => {
  it('al aprobar dice «Hay 5, quedarán 3»; al rechazar, que el stock no cambia', () => {
    expect(resumenResolucion(merma('a', 'solicitada', 'f'), prod(), 'aprobada').join(' ')).toContain('Hay 5, quedarán 3');
    expect(resumenResolucion(merma('a', 'solicitada', 'f'), prod(), 'rechazada').join(' ')).toContain('El stock no cambia');
  });
});
