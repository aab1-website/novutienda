// Asignación de plan (`plataforma/operador/plan.ts` y `scripts/plan-tenant.mjs`): dobles en memoria, sin red ni emulador.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { asignarPlan, type BaseDatosPlan, type TransaccionPlan } from '../../plataforma/operador/plan.js';
import { DobleDb } from '../limites/doble-db.js';

const T = 'demo-x';
const RUTA = `tenants/${T}`;

function montaje(plan?: string, sinTenant = false) {
  const doble = new DobleDb();
  if (!sinTenant) doble.poner(RUTA, { estado: 'activo', ...(plan === undefined ? {} : { plan }) });
  const db: BaseDatosPlan = {
    runTransaction: (fn) =>
      doble.runTransaction((tx: TransaccionIdentidad) =>
        fn({
          get: tx.get.bind(tx) as unknown as TransaccionPlan['get'],
          update: (ruta, datos) => tx.set(ruta, { ...(doble.dato(ruta) ?? {}), ...datos }),
          create: tx.create.bind(tx),
          nuevoId: tx.nuevoId.bind(tx),
          marcaTiempoServidor: tx.marcaTiempoServidor.bind(tx),
        }),
      ),
  };
  const correr = (p: string, extra: Partial<Parameters<typeof asignarPlan>[0]> = {}) =>
    asignarPlan({ tenantId: T, plan: p, ambiente: 'staging', db, operador: 'script', aplicar: true, ...extra });
  return { doble, correr };
}

describe('asignarPlan', () => {
  it('asigna pruebas: escribe el plan, conserva el resto y audita', async () => {
    const m = montaje('base');
    expect(await m.correr('pruebas')).toMatchObject({ de: 'base', a: 'pruebas', aplicado: true, diferencias: ['plan: base -> pruebas'] });
    expect(m.doble.dato(RUTA)).toMatchObject({ plan: 'pruebas', estado: 'activo' });
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([
      expect.objectContaining({ accion: 'tenant.plan', uid: 'operador:script', resumenAntes: { plan: 'base' }, resumenDespues: { plan: 'pruebas' } }),
    ]);
  });

  it('vuelve a base', async () => {
    const m = montaje('pruebas');
    expect(await m.correr('base')).toMatchObject({ de: 'pruebas', a: 'base', aplicado: true });
    expect(m.doble.dato(RUTA)).toMatchObject({ plan: 'base' });
  });

  it('al bajar de pruebas a base avisa si los usuarios superan el tope nuevo, sin identificadores', async () => {
    const m = montaje('pruebas');
    m.doble.poner(`${RUTA}/contadores/uso`, { usuarios: 7 });
    const r = await m.correr('base');
    expect(r.diferencias).toEqual(['plan: pruebas -> base', 'aviso: usuarios actuales 7 > tope 3']);
    expect(r.diferencias.join(' ')).not.toContain(T);
    const m2 = montaje('pruebas');
    m2.doble.poner(`${RUTA}/contadores/uso`, { usuarios: 3 });
    expect((await m2.correr('base')).diferencias).toEqual(['plan: pruebas -> base']);
  });

  it('sin aplicar solo informa: no escribe ni audita', async () => {
    const m = montaje('base');
    expect(await m.correr('pruebas', { aplicar: false })).toMatchObject({ aplicado: false, diferencias: ['plan: base -> pruebas'] });
    expect(m.doble.dato(RUTA)).toMatchObject({ plan: 'base' });
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([]);
  });

  it('si ya tiene el plan no escribe', async () => {
    const m = montaje('pruebas');
    expect(await m.correr('pruebas')).toMatchObject({ aplicado: false, diferencias: [] });
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([]);
  });

  it('rechaza planes no asignables, tenants inexistentes o inválidos y planes actuales desconocidos', async () => {
    await expect(montaje('base').correr('multimercado')).rejects.toThrow(/no asignable/);
    await expect(montaje('base').correr('otro')).rejects.toThrow(/no asignable/);
    await expect(montaje(undefined, true).correr('pruebas')).rejects.toThrow(/no existe/);
    await expect(montaje(undefined).correr('pruebas')).rejects.toThrow(/plan válido/);
    await expect(montaje('raro').correr('pruebas')).rejects.toThrow(/plan válido/);
    await expect(montaje('base').correr('pruebas', { tenantId: 'a/b' })).rejects.toThrow(/identificador/);
  });

  it('pruebas solo se asigna en staging o emulador; base no depende del ambiente', async () => {
    await expect(montaje('base').correr('pruebas', { ambiente: 'produccion' })).rejects.toThrow(/solo se asigna en staging/);
    expect((await montaje('base').correr('pruebas', { ambiente: 'emulador' })).aplicado).toBe(true);
    expect((await montaje('pruebas').correr('base', { ambiente: 'produccion' })).aplicado).toBe(true);
  });

  it('los mensajes de error no incluyen el id del tenant', async () => {
    const e = await montaje('base').correr('multimercado').then(() => new Error('no falló'), (x: unknown) => x as Error);
    expect(e.message).not.toContain(T);
  });
});

describe('scripts/plan-tenant.mjs: guardia de entorno', () => {
  const script = resolve(import.meta.dirname, '../../scripts/plan-tenant.mjs');
  const correr = (env: Record<string, string>, extra: string[] = ['--proyecto', 'proyecto-stg']) => {
    const r = spawnSync(process.execPath, [script, T, ...extra, '--plan', 'pruebas'], {
      env: { PATH: process.env['PATH'] ?? '', ...env },
      encoding: 'utf8',
    });
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
  };

  it('rechaza producción, ambientes desconocidos y staging sin GCP_PROJECT_ID_STAGING', () => {
    const stg = { GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'staging', GCP_PROJECT_ID_STAGING: 'proyecto-stg' };
    const prod = correr({ ...stg, GCP_PROJECT_ID_PROD: 'proyecto-stg' });
    expect(prod.codigo).toBe(1);
    expect(prod.salida).toMatch(/producción/);
    expect(prod.salida).not.toContain('proyecto-stg');
    expect(correr({ ...stg, NOVUTIENDA_AMBIENTE: 'produccion' }).salida).toMatch(/NOVUTIENDA_AMBIENTE/);
    const sin = correr({ GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'staging' });
    expect(sin.codigo).toBe(1);
    expect(sin.salida).toMatch(/GCP_PROJECT_ID_STAGING/);
  });

  it('exige --proyecto y un plan válido', () => {
    expect(correr({ GOOGLE_CLOUD_PROJECT: 'proyecto-stg', NOVUTIENDA_AMBIENTE: 'staging' }, []).salida).toMatch(/--proyecto/);
    const r = spawnSync(process.execPath, [script, T, '--plan', 'multimercado'], { env: { PATH: process.env['PATH'] ?? '' }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(`${r.stderr}`).toMatch(/uso:/);
  });
});
