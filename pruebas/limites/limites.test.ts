/* eslint-disable no-restricted-imports -- provisional: importación profunda hasta que el coordinador cablee el index de nucleo; luego pasar a '@plataforma/nucleo' */
import { describe, expect, it } from 'vitest';
import { LimiteDelPlan, PLANES, rutaContador, verificarYReservar } from '../../paquetes/nucleo/src/limites/index.js';
import { DobleDb } from './doble-db.js';

const tenantOk = { plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };

function nuevaDb(uso: Record<string, number> = {}): DobleDb {
  const db = new DobleDb();
  db.poner('tenants/t1', tenantOk);
  if (Object.keys(uso).length > 0) db.poner(rutaContador('t1'), uso);
  return db;
}

describe('límites del plan', () => {
  it('el plan base fija 200 productos, 3 usuarios y 1 caja', () => {
    expect(PLANES.base).toEqual({ productos: 200, usuarios: 3, cajas: 1 });
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

  it('un contador corrupto se trata como cero', async () => {
    const db = nuevaDb({ cajas: -5 });
    expect(await db.runTransaction((tx) => verificarYReservar(tx, 't1', 'cajas'))).toBe(1);
  });
});
