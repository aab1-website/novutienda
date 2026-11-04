import { describe, expect, it } from 'vitest';
import {
  abrirCaja,
  cerrarCaja,
  ContadorCorrupto,
  LimiteDelPlan,
  liberar,
  PLANES,
  rutaContador,
  verificarYReservar,
} from '@plataforma/nucleo';
import { DobleDb } from './doble-db.js';

const tenantOk = { plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };

function nuevaDb(uso: Record<string, number> = {}): DobleDb {
  const db = new DobleDb();
  db.poner('tenants/t1', tenantOk);
  if (Object.keys(uso).length > 0) db.poner(rutaContador('t1'), uso);
  return db;
}

describe('límites del plan', () => {
  it('el plan base fija 200 productos, 3 usuarios, 1 caja activa y 3 almacenes', () => {
    expect(PLANES.base).toEqual({ productos: 200, usuarios: 3, cajas: 1, almacenes: 3 });
  });

  it('reserva y cuenta hasta el tope', async () => {
    const db = nuevaDb({ usuarios: 2 });
    expect(await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'usuarios'))).toBe(3);
    expect(db.dato(rutaContador('t1'))).toEqual({ usuarios: 3 });
  });

  it('usuario 4 lanza LimiteDelPlan', async () => {
    const db = nuevaDb({ usuarios: 3 });
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'usuarios'))).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(db.dato(rutaContador('t1'))).toEqual({ usuarios: 3 });
  });

  it('producto 201 lanza LimiteDelPlan', async () => {
    const db = nuevaDb({ productos: 200 });
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'productos'))).rejects.toThrow(/productos/);
  });

  it('segunda caja lanza LimiteDelPlan y la primera entra', async () => {
    const db = nuevaDb();
    await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'));
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'))).rejects.toBeInstanceOf(LimiteDelPlan);
  });

  it('dos altas concurrentes en 199 productos: entra una', async () => {
    const db = nuevaDb({ productos: 199 });
    const alta = (): Promise<number> => db.runTransaction((tx) => verificarYReservar(tx, 't1', 'productos'));
    const r = await Promise.allSettled([alta(), alta()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected');
    expect(rechazo?.status === 'rejected' && rechazo.reason).toBeInstanceOf(LimiteDelPlan);
    expect(db.dato(rutaContador('t1'))).toEqual({ productos: 200 });
    expect(db.reintentos).toBeGreaterThan(0);
  });

  it('los contadores de claves distintas no se pisan', async () => {
    const db = nuevaDb({ usuarios: 1 });
    await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'));
    expect(db.dato(rutaContador('t1'))).toEqual({ usuarios: 1, cajas: 1 });
  });

  it('rechaza tenant inexistente, inválido o con id que altera la ruta', async () => {
    const db = new DobleDb();
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'))).rejects.toThrow(/inexistente/);
    db.poner('tenants/t1', { plan: 'oro' });
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'))).rejects.toThrow(/inválido/);
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 'a/b', 'cajas'))).rejects.toThrow(/tenantId/);
  });

  it.each([[-5], ['3'], [1.5], [Number.NaN], [null], [{}]])('contador corrupto %j: error tipado, nunca cero', async (valor) => {
    const db = nuevaDb({ cajas: valor as number });
    const e = await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContadorCorrupto);
    expect((e as ContadorCorrupto).clave).toBe('cajas');
    expect(db.dato(rutaContador('t1'))).toEqual({ cajas: valor });
  });

  it('almacenes: el cuarto lanza LimiteDelPlan', async () => {
    const db = nuevaDb({ almacenes: 2 });
    await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'almacenes'));
    await expect(db.runTransaction((tx) => verificarYReservar(tx, 't1', 'almacenes'))).rejects.toBeInstanceOf(LimiteDelPlan);
  });
});

describe('liberar', () => {
  it('decrementa productos y usuarios', async () => {
    const db = nuevaDb({ productos: 5, usuarios: 2 });
    expect(await db.runTransaction((tx) => liberar(tx, 't1', 'productos'))).toBe(4);
    expect(await db.runTransaction((tx) => liberar(tx, 't1', 'usuarios'))).toBe(1);
    expect(db.dato(rutaContador('t1'))).toEqual({ productos: 4, usuarios: 1 });
  });

  it('nunca baja de 0, con contador en 0 o ausente', async () => {
    const db = nuevaDb({ usuarios: 0 });
    expect(await db.runTransaction((tx) => liberar(tx, 't1', 'usuarios'))).toBe(0);
    expect(await db.runTransaction((tx) => liberar(tx, 't1', 'productos'))).toBe(0);
    expect(db.dato(rutaContador('t1'))).toEqual({ usuarios: 0, productos: 0 });
  });

  it.each([[-1], ['2'], [0.5]])('contador corrupto %j: lanza, no escribe', async (valor) => {
    const db = nuevaDb({ productos: valor as number });
    await expect(db.runTransaction((tx) => liberar(tx, 't1', 'productos'))).rejects.toBeInstanceOf(ContadorCorrupto);
    expect(db.dato(rutaContador('t1'))).toEqual({ productos: valor });
  });

  it('rechaza un tenantId que altera la ruta', async () => {
    const db = nuevaDb();
    await expect(db.runTransaction((tx) => liberar(tx, 'a/b', 'productos'))).rejects.toThrow(/tenantId/);
  });
});

describe('cajas: 1 caja ACTIVA por turno', () => {
  it('abrir, cerrar y volver a abrir', async () => {
    const db = nuevaDb();
    await db.runTransaction((tx) => abrirCaja(tx, 't1'));
    await expect(db.runTransaction((tx) => abrirCaja(tx, 't1'))).rejects.toBeInstanceOf(LimiteDelPlan);
    await db.runTransaction((tx) => cerrarCaja(tx, 't1'));
    expect(await db.runTransaction((tx) => abrirCaja(tx, 't1'))).toBe(1);
  });

  it('dos aperturas simultáneas: solo una entra', async () => {
    const db = nuevaDb();
    const r = await Promise.allSettled([
      db.runTransaction((tx) => abrirCaja(tx, 't1')),
      db.runTransaction((tx) => abrirCaja(tx, 't1')),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected');
    expect(rechazo?.status === 'rejected' && rechazo.reason).toBeInstanceOf(LimiteDelPlan);
    expect(db.dato(rutaContador('t1'))).toEqual({ cajas: 1 });
  });

  it('cerrar sin caja abierta no deja el contador negativo', async () => {
    const db = nuevaDb();
    expect(await db.runTransaction((tx) => cerrarCaja(tx, 't1'))).toBe(0);
  });
});
