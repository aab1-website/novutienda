// Mapeo host -> tenant (`plataforma/operador/dominio.ts`) y guardia de tokens (`plataforma/operador/token.ts`) con dobles en memoria.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { hayEmulador, herramientas, unico } from './ayudas.js';
import type { EstadoTenant, TransaccionIdentidad } from '@novutienda/nucleo';
import { construirDominio, esHostValido, gestionarDominio, type BaseDatosDominio } from '../../plataforma/operador/dominio.js';
import { exigirTenantOperativo } from '../../plataforma/operador/token.js';
import { DobleDb } from '../limites/doble-db.js';

const A = 'tenant-a';
const B = 'tenant-b';
const HOST = 'ejemplo.test';
const RUTA = `dominios/${HOST}`;

function montaje(tenants: Readonly<Record<string, EstadoTenant | 'raro'>> = { [A]: 'activo', [B]: 'activo' }) {
  const doble = new DobleDb();
  for (const [t, estado] of Object.entries(tenants)) doble.poner(`tenants/${t}`, { plan: 'base', estado });
  const db: BaseDatosDominio = {
    runTransaction: (fn) =>
      doble.runTransaction((tx: TransaccionIdentidad) =>
        fn({
          get: tx.get.bind(tx) as never,
          update: (ruta, datos) => tx.set(ruta, { ...(doble.dato(ruta) ?? {}), ...datos }),
          delete: tx.delete.bind(tx),
          create: tx.create.bind(tx),
          nuevoId: tx.nuevoId.bind(tx),
          marcaTiempoServidor: tx.marcaTiempoServidor.bind(tx),
        }),
      ),
  };
  type Extra = Partial<Omit<Parameters<typeof gestionarDominio>[0], 'tenantId'>> & { tenantId?: string | undefined };
  const correr = (extra: Extra = {}) => {
    const { tenantId = 'tenant-a', ...resto } = extra;
    const base = { host: HOST, db, operador: 'script', aplicar: true, ...resto };
    return gestionarDominio('tenantId' in extra && extra.tenantId === undefined ? base : { ...base, tenantId });
  };
  return { doble, correr };
}

describe('esHostValido', () => {
  it.each(['ejemplo.test', 'www.ejemplo.test', 'a-b.c1.ejemplo.test', 'xn--ej-9ma.test'])('acepta %s', (h) => {
    expect(esHostValido(h)).toBe(true);
  });
  it.each([
    '', 'Ejemplo.test', 'https://ejemplo.test', 'ejemplo.test:8080', 'ejemplo.test/ruta', 'ejemplo.test?x=1', 'ejemplo test', 'localhost',
    '-a.test', 'a-.test', 'a..test', '.ejemplo.test', 'ejemplo.test.', '192.168.0.1', 'a_b.test', `${'a'.repeat(64)}.test`, `${'a.'.repeat(130)}test`,
  ])('rechaza %j', (h) => {
    expect(esHostValido(h)).toBe(false);
  });
  it('rechaza lo que no es texto', () => {
    expect(esHostValido(undefined)).toBe(false);
    expect(esHostValido(5)).toBe(false);
  });
});

describe('construirDominio', () => {
  it('arma { tenantId, creado, actualizado }', () => {
    expect(construirDominio(A, 'M')).toEqual({ tenantId: A, creado: 'M', actualizado: 'M' });
    expect(() => construirDominio('A B', 'M')).toThrow(/identificador/);
  });
});

describe('gestionarDominio', () => {
  it('asigna: escribe el documento y audita', async () => {
    const m = montaje();
    const r = await m.correr();
    expect(r.aplicado).toBe(true);
    expect(m.doble.dato(RUTA)).toEqual({ tenantId: A, creado: 'MARCA', actualizado: 'MARCA' });
    expect(m.doble.coleccion(`tenants/${A}/auditoria`)).toEqual([expect.objectContaining({ accion: 'dominio.asignar', uid: 'operador:script' })]);
  });

  it('sin aplicar solo informa: no escribe ni audita', async () => {
    const m = montaje();
    const r = await m.correr({ aplicar: false });
    expect(r).toMatchObject({ aplicado: false, diferencias: ['host: sin asignar -> tenant indicado'] });
    expect(m.doble.dato(RUTA)).toBeUndefined();
    expect(m.doble.coleccion(`tenants/${A}/auditoria`)).toEqual([]);
  });

  it('repetir la asignación al mismo tenant no hace nada', async () => {
    const m = montaje();
    await m.correr();
    const r = await m.correr();
    expect(r).toEqual({ aplicado: false, diferencias: [] });
    expect(m.doble.coleccion(`tenants/${A}/auditoria`)).toHaveLength(1);
  });

  it('un host de otro tenant se rechaza sin reasignar, también en verificación', async () => {
    const m = montaje();
    await m.correr();
    await expect(m.correr({ tenantId: B })).rejects.toThrow(/--reasignar/);
    await expect(m.correr({ tenantId: B, aplicar: false })).rejects.toThrow(/--reasignar/);
    expect(m.doble.dato(RUTA)).toMatchObject({ tenantId: A });
  });

  it('con reasignar mueve el host, conserva `creado` y audita en ambos tenants', async () => {
    const m = montaje();
    await m.correr();
    m.doble.poner(RUTA, { tenantId: A, creado: 'ORIGINAL', actualizado: 'ORIGINAL' });
    const r = await m.correr({ tenantId: B, reasignar: true });
    expect(r.aplicado).toBe(true);
    expect(m.doble.dato(RUTA)).toEqual({ tenantId: B, creado: 'ORIGINAL', actualizado: 'MARCA' });
    expect(m.doble.coleccion(`tenants/${A}/auditoria`).at(-1)).toMatchObject({ accion: 'dominio.reasignar' });
    expect(m.doble.coleccion(`tenants/${B}/auditoria`)).toEqual([expect.objectContaining({ accion: 'dominio.reasignar' })]);
  });

  it('el tenant debe existir y estar activo o suspendido; la baja y los estados raros se rechazan', async () => {
    const m = montaje({ [A]: 'suspendido', [B]: 'baja', 'tenant-c': 'raro' });
    await expect(m.correr({ tenantId: 'tenant-x' })).rejects.toThrow(/no existe/);
    await expect(m.correr({ tenantId: B })).rejects.toThrow(/de baja/);
    await expect(m.correr({ tenantId: 'tenant-c' })).rejects.toThrow(/estado válido/);
    await expect(m.correr()).resolves.toMatchObject({ aplicado: true }); // suspendido se admite
    expect(m.doble.dato(RUTA)).toMatchObject({ tenantId: A });
  });

  it('rechaza host o tenant inválidos y banderas incompatibles; no escribe nada', async () => {
    const m = montaje();
    await expect(m.correr({ host: 'https://ejemplo.test' })).rejects.toThrow(/host/);
    await expect(m.correr({ tenantId: 'A B' })).rejects.toThrow(/identificador/);
    await expect(m.correr({ tenantId: undefined })).rejects.toThrow(/--tenant/);
    await expect(m.correr({ eliminar: true, reasignar: true })).rejects.toThrow(/excluyentes/);
    expect(m.doble.docs.has(RUTA)).toBe(false);
  });

  it('un mapeo existente corrupto no se pisa', async () => {
    const m = montaje();
    m.doble.poner(RUTA, { tenantId: 5 });
    await expect(m.correr()).rejects.toThrow(/inválido/);
  });

  it('elimina: borra el documento y audita; exige que exista y, si se indica, el dueño', async () => {
    const m = montaje();
    await expect(m.correr({ eliminar: true, tenantId: undefined })).rejects.toThrow(/no está asignado/);
    await m.correr();
    await expect(m.correr({ eliminar: true, tenantId: B })).rejects.toThrow(/otro tenant/);
    const sinAplicar = await m.correr({ eliminar: true, tenantId: undefined, aplicar: false });
    expect(sinAplicar.aplicado).toBe(false);
    expect(m.doble.dato(RUTA)).toBeDefined();
    const r = await m.correr({ eliminar: true, tenantId: A });
    expect(r.aplicado).toBe(true);
    expect(m.doble.dato(RUTA)).toBeUndefined();
    expect(m.doble.coleccion(`tenants/${A}/auditoria`).at(-1)).toMatchObject({ accion: 'dominio.eliminar' });
  });

  it('los mensajes de auditoría y de diferencias no llevan el host ni el id del tenant', async () => {
    const m = montaje();
    const r = await m.correr();
    expect(JSON.stringify(r)).not.toContain(HOST);
    expect(JSON.stringify(r)).not.toContain(A);
  });

  it('la auditoría no guarda el host', async () => {
    const m = montaje();
    await m.correr();
    await m.correr({ tenantId: B, reasignar: true });
    await m.correr({ eliminar: true, tenantId: B });
    const auditoria = [...m.doble.docs].filter(([r]) => r.includes('/auditoria/')).map(([, d]) => JSON.stringify(d.datos));
    expect(auditoria.length).toBeGreaterThanOrEqual(4);
    for (const a of auditoria) expect(a).not.toContain(HOST);
  });
});

describe('exigirTenantOperativo (guardia de token-novuchat)', () => {
  const leer = (doc?: Record<string, unknown>) => () => Promise.resolve({ existe: doc !== undefined, data: () => doc });
  it('acepta un tenant activo', async () => {
    await expect(exigirTenantOperativo(A, leer({ estado: 'activo' }))).resolves.toBeUndefined();
  });
  it.each([
    [undefined, /no existe/],
    [{ estado: 'suspendido' }, /no está activo/],
    [{ estado: 'baja' }, /no está activo/],
    [{ plan: 'base' }, /estado válido/],
    [{ estado: 'raro' }, /estado válido/],
  ])('rechaza %j', async (doc, mensaje) => {
    await expect(exigirTenantOperativo(A, leer(doc))).rejects.toThrow(mensaje);
  });
  it('rechaza un id inválido sin leer', async () => {
    await expect(exigirTenantOperativo('A B', () => Promise.reject(new Error('leyó')))).rejects.toThrow(/identificador/);
  });
});

describe('scripts/dominio-tenant.mjs: guardias previas a tocar la nube', () => {
  const correr = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('node', ['scripts/dominio-tenant.mjs', ...args], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', ...env } });
  it('sin entorno de operador falla antes de conectar', () => {
    const r = correr(['--host', HOST, '--tenant', A, '--proyecto', 'demo-x']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('GOOGLE_CLOUD_PROJECT');
  });
  it('rechaza producción sin confirmación explícita y banderas incompatibles', () => {
    const prod = { GOOGLE_CLOUD_PROJECT: 'proyecto-prod', NOVUTIENDA_AMBIENTE: 'produccion', GCP_PROJECT_ID_PROD: 'proyecto-prod' };
    expect(correr(['--host', HOST, '--tenant', A, '--proyecto', 'proyecto-prod', '--aplicar'], prod).stderr).toContain('--confirmar-produccion');
    expect(correr(['--host', HOST, '--tenant', A, '--proyecto', 'x', '--aplicar', '--verificar']).stderr).toContain('uso:');
    expect(correr(['--host', HOST, '--proyecto', 'x']).stderr).toContain('uso:');
  });
});

describe.skipIf(!hayEmulador)('scripts/dominio-tenant.mjs contra el emulador', () => {
  const correr = (args: string[]) =>
    spawnSync('node', ['scripts/dominio-tenant.mjs', ...args, '--proyecto', 'demo-pruebas'], {
      encoding: 'utf8',
      env: { ...process.env, GOOGLE_CLOUD_PROJECT: 'demo-pruebas', NOVUTIENDA_AMBIENTE: 'emulador' },
    });

  it('asigna, rechaza sin --reasignar con un mensaje útil y sin identificadores', async () => {
    const h = herramientas();
    const a = unico('dom-a').toLowerCase();
    const b = unico('dom-b').toLowerCase();
    const host = `${unico('h').toLowerCase()}.ejemplo.test`;
    for (const t of [a, b]) await h.firestore.doc(`tenants/${t}`).set({ estado: 'activo' });
    const verificar = correr(['--host', host, '--tenant', a]);
    expect(verificar.status, verificar.stderr).toBe(0);
    expect((await h.firestore.doc(`dominios/${host}`).get()).exists).toBe(false);
    const aplicar = correr(['--host', host, '--tenant', a, '--aplicar']);
    expect(aplicar.status, aplicar.stderr).toBe(0);
    expect((await h.firestore.doc(`dominios/${host}`).get()).data()).toMatchObject({ tenantId: a });
    const rechazo = correr(['--host', host, '--tenant', b, '--aplicar']);
    expect(rechazo.status).toBe(1);
    expect(rechazo.stderr).toContain('--reasignar');
    expect(rechazo.stderr).not.toContain('error de Firebase');
    for (const x of [host, a, b, 'demo-pruebas']) expect(rechazo.stdout + rechazo.stderr).not.toContain(x);
    expect((await h.firestore.doc(`dominios/${host}`).get()).data()).toMatchObject({ tenantId: a });
    const mover = correr(['--host', host, '--tenant', b, '--aplicar', '--reasignar']);
    expect(mover.status, mover.stderr).toBe(0);
    const quitar = correr(['--host', host, '--eliminar', '--aplicar']);
    expect(quitar.status, quitar.stderr).toBe(0);
    expect((await h.firestore.doc(`dominios/${host}`).get()).exists).toBe(false);
  });
});
