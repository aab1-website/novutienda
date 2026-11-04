import { beforeEach, describe, expect, it } from 'vitest';
import {
  abrirConteo,
  cerrarConteo,
  EntradaInvalida,
  EstadoInvalido,
  OperacionConflicto,
  registrarLineaConteo,
  resolverMerma,
  SerieNoDisponible,
  SinPermiso,
  solicitarMerma,
  StockInsuficiente,
  type Autor,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, CAJ, cargar, contar, doc, nuevoEntorno, op, producto, SUP, SUP2, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;

beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz'));
  await altaProducto(db, producto('goma'));
  await altaProducto(db, producto('celular', { conSerie: true }));
  await cargar(db, 'lapiz', 'tienda', 10);
  await cargar(db, 'goma', 'tienda', 5);
  await cargar(db, 'celular', 'tienda', 3, ['S1', 'S2', 'S3']);
});

const solicitar = (id: string, o: { productoId?: string; cantidad?: number; series?: string[]; por?: Autor; motivo?: string } = {}) =>
  db.runTransaction((tx) =>
    solicitarMerma(tx, {
      tenantId: T,
      operacionId: id,
      por: o.por ?? CAJ,
      productoId: o.productoId ?? 'lapiz',
      ubicacionId: 'tienda',
      cantidad: o.cantidad ?? 2,
      ...(o.series !== undefined ? { series: o.series } : {}),
      motivo: o.motivo ?? 'rota',
    }),
  );
const resolver = (id: string, mermaId: string, decision: 'aprobada' | 'rechazada', por: Autor = SUP) =>
  db.runTransaction((tx) => resolverMerma(tx, { tenantId: T, operacionId: id, mermaId, decision, por }));

describe('merma', () => {
  it('solicitar no mueve stock; aprobar descuenta y deja movimiento inmutable', async () => {
    await solicitar('m1');
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(10);
    expect(doc(db, 'mermas', 'm1')?.['estado']).toBe('solicitada');
    await resolver('r1', 'm1', 'aprobada');
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(8);
    expect(doc(db, 'mermas', 'm1')).toMatchObject({ estado: 'aprobada', resueltaPor: 'u-sup' });
    expect(doc(db, 'movimientos', 'r1__lapiz__tienda')).toMatchObject({ tipo: 'merma', delta: -2 });
    verificarInvariantes(db);
  });

  it('quien solicitó no la aprueba', async () => {
    await solicitar('m1', { por: SUP });
    await expect(resolver('r1', 'm1', 'aprobada', SUP)).rejects.toBeInstanceOf(SinPermiso);
    await expect(resolver('r2', 'm1', 'rechazada', SUP)).rejects.toBeInstanceOf(SinPermiso);
    expect(doc(db, 'mermas', 'm1')?.['estado']).toBe('solicitada');
    await resolver('r3', 'm1', 'aprobada', SUP2);
    verificarInvariantes(db);
  });

  it('el cajero no resuelve; no se resuelve dos veces; rechazada no mueve stock', async () => {
    await solicitar('m1');
    await expect(resolver('r1', 'm1', 'aprobada', CAJ)).rejects.toBeInstanceOf(SinPermiso);
    await resolver('r2', 'm1', 'rechazada');
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(10);
    await expect(resolver('r3', 'm1', 'aprobada', ADM)).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(resolver('r4', 'm1', 'rechazada', ADM)).rejects.toBeInstanceOf(EstadoInvalido);
    expect(contar(db, 'movimientos')).toBe(3); // solo los tres ingresos
    verificarInvariantes(db);
  });

  it('resolver con la misma operacionId es idempotente; con otra decisión, conflicto', async () => {
    await solicitar('m1');
    await resolver('r1', 'm1', 'aprobada');
    expect((await resolver('r1', 'm1', 'aprobada')).repetida).toBe(true);
    await expect(resolver('r1', 'm1', 'rechazada')).rejects.toBeInstanceOf(OperacionConflicto);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(8);
  });

  it('con serie: las unidades pasan a merma; si una se vendió antes, la aprobación falla', async () => {
    await solicitar('m1', { productoId: 'celular', cantidad: 1, series: ['S2'] });
    await resolver('r1', 'm1', 'aprobada');
    expect(doc(db, 'unidades', 'celular__S2')).toMatchObject({ estado: 'merma', mermaRef: { tipo: 'merma', id: 'm1' } });
    expect(doc(db, 'existencias', 'celular__tienda')?.['series']).toEqual(['S1', 'S3']);
    verificarInvariantes(db);
    await expect(solicitar('m2', { productoId: 'celular', cantidad: 1, series: ['S2'] })).rejects.toBeInstanceOf(SerieNoDisponible);
    await expect(solicitar('m3', { productoId: 'celular', cantidad: 1 })).rejects.toBeInstanceOf(EntradaInvalida);
  });

  it('no se solicita más de lo que hay ni sin motivo', async () => {
    await expect(solicitar('m1', { cantidad: 11 })).rejects.toBeInstanceOf(StockInsuficiente);
    await expect(solicitar('m2', { motivo: '' })).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(resolver('r1', 'inexistente', 'aprobada')).rejects.toThrow(/inexistente/);
  });
});

const abrir = (conteoId: string, por: Autor = SUP, ubicacionId = 'tienda') =>
  db.runTransaction((tx) => abrirConteo(tx, { tenantId: T, operacionId: op('ca'), por, conteoId, ubicacionId }));
const contar1 = (conteoId: string, productoId: string, contado?: number, series?: string[], por: Autor = CAJ) =>
  db.runTransaction((tx) =>
    registrarLineaConteo(tx, {
      tenantId: T,
      operacionId: op('cl'),
      por,
      conteoId,
      productoId,
      ...(contado !== undefined ? { contado } : {}),
      ...(series !== undefined ? { series } : {}),
    }),
  );
const cerrar = (conteoId: string, por: Autor = SUP2) =>
  db.runTransaction((tx) => cerrarConteo(tx, { tenantId: T, operacionId: op('cc'), por, conteoId }));

describe('conteo ciego', () => {
  it('abrir: uno por ubicación, solo sup/adm', async () => {
    await abrir('c1');
    await expect(abrir('c2')).rejects.toThrow(/ya hay un conteo abierto/i);
    await expect(abrir('c3', CAJ, 'deposito-1')).rejects.toBeInstanceOf(SinPermiso);
    await abrir('c4', SUP, 'deposito-1');
  });

  it('registrar guarda el teórico en el servidor y no lo devuelve a quien cuenta', async () => {
    await abrir('c1');
    const r = await contar1('c1', 'lapiz', 9);
    expect(JSON.stringify(r)).not.toContain('10');
    expect(r.resultado).toEqual({ conteoId: 'c1', productoId: 'lapiz', contado: 9 });
    expect(doc(db, 'conteoTeoricos', 'c1__lapiz')).toMatchObject({ cantidad: 10 });
    expect(doc(db, 'conteoLineas', 'c1__lapiz')).toMatchObject({ contado: 9, registradaPor: 'u-caj' });
    expect(doc(db, 'conteoLineas', 'c1__lapiz')?.['cantidad']).toBeUndefined();
  });

  it('cerrar: faltantes → mermas solicitadas, sobrantes → movimiento de conteo, libera la ubicación y firma', async () => {
    await abrir('c1');
    await contar1('c1', 'lapiz', 8); // falta 2
    await contar1('c1', 'goma', 7); // sobran 2
    await contar1('c1', 'celular', undefined, ['S1', 'S3']); // falta S2
    const r = await cerrar('c1');
    expect(r.resultado).toMatchObject({ sobrantes: 2 });
    expect(doc(db, 'mermas', 'c1-lapiz')).toMatchObject({ estado: 'solicitada', cantidad: 2, origen: 'conteo', solicitadaPor: 'u-caj' });
    expect(doc(db, 'mermas', 'c1-celular')).toMatchObject({ estado: 'solicitada', cantidad: 1, series: ['S2'] });
    expect(doc(db, 'existencias', 'goma__tienda')?.['cantidad']).toBe(7);
    expect(db.coleccion(`tenants/${T}/movimientos`).find((m) => m.datos['tipo'] === 'conteo')?.datos).toMatchObject({ delta: 2, productoId: 'goma' });
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(10); // las mermas aún no descuentan
    expect(doc(db, 'conteos', 'c1')).toMatchObject({ estado: 'cerrado', firma: { uid: 'u-sup2', rol: 'sup' } });
    expect(doc(db, 'ubicaciones', 'tienda')?.['conteoAbiertoId']).toBeUndefined();
    verificarInvariantes(db);
    await abrir('c2'); // ya se puede abrir otro
    // el que contó no aprueba su propia merma; otro sup sí.
    await expect(resolver('rm', 'c1-lapiz', 'aprobada', CAJ)).rejects.toBeInstanceOf(SinPermiso);
    await resolver('rm', 'c1-lapiz', 'aprobada', SUP);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(8);
    verificarInvariantes(db);
  });

  it('no registra en conteo cerrado ni cierra dos veces; el cajero no cierra', async () => {
    await abrir('c1');
    await contar1('c1', 'lapiz', 10);
    await expect(cerrar('c1', CAJ)).rejects.toBeInstanceOf(SinPermiso);
    await cerrar('c1');
    await expect(contar1('c1', 'goma', 5)).rejects.toBeInstanceOf(EstadoInvalido);
    await expect(cerrar('c1')).rejects.toBeInstanceOf(EstadoInvalido);
  });

  it('rechaza contado inválido, series de otro almacén y conteo vacío', async () => {
    await abrir('c1');
    await expect(contar1('c1', 'lapiz', -1)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(contar1('c1', 'lapiz', 1.5)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(contar1('c1', 'lapiz')).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(contar1('c1', 'celular', undefined, ['NOEXISTE'])).rejects.toBeInstanceOf(SerieNoDisponible);
    await expect(contar1('c1', 'celular', 2)).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cerrar('c1')).rejects.toBeInstanceOf(EstadoInvalido);
  });

  it('volver a registrar una línea la reemplaza', async () => {
    await abrir('c1');
    await contar1('c1', 'lapiz', 3);
    await contar1('c1', 'lapiz', 10);
    expect(doc(db, 'conteoLineas', 'c1__lapiz')?.['contado']).toBe(10);
    expect(doc(db, 'conteos', 'c1')?.['productos']).toEqual(['lapiz']);
  });
});
