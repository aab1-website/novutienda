import { describe, expect, it } from 'vitest';
import { asignarPrimerAdministrador, asignarRol, ErrorIdentidad, LimiteDelPlan, type AuthMin, type DepsIdentidad } from '@novutienda/nucleo';
import { DobleDb } from '../limites/doble-db.js';

interface Usuario {
  customClaims?: Record<string, unknown>;
  providerData: { providerId: string }[];
  emailVerified: boolean;
}
const pw = (): Usuario => ({ providerData: [{ providerId: 'password' }], emailVerified: true });

function montaje(usuarios: Record<string, Usuario>, conTenant = true) {
  const db = new DobleDb();
  if (conTenant) db.poner('tenants/t1', { plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  const fallos = { set: false };
  const escritos: string[] = [];
  const auth: AuthMin = {
    getUser: async (uid) => {
      const u = usuarios[uid];
      if (!u) throw new Error('no existe');
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (fallos.set) throw new Error('fallo de Auth');
      escritos.push(uid);
      const u = usuarios[uid];
      if (u) u.customClaims = { ...claims };
    },
    revokeRefreshTokens: async () => undefined,
  };
  const deps: DepsIdentidad = { auth, db, ahora: () => 1000 };
  return { db, deps, fallos, escritos, usuarios };
}
const auditoria = (db: DobleDb) => db.coleccion('tenants/t1/auditoria');
const rechaza = async (p: Promise<unknown>, codigo: string) => {
  const e = await p.then(
    () => undefined,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErrorIdentidad);
  expect((e as ErrorIdentidad).codigo).toBe(codigo);
};

describe('asignarPrimerAdministrador', () => {
  it('asigna con 0 adm: espejo, contadores, auditoría y claim coherentes', async () => {
    const { db, deps } = montaje({ u1: pw() });
    const claim = await asignarPrimerAdministrador(deps, 't1', 'u1', 'operador');
    expect(claim).toEqual({ pl: { t: { t1: 'adm' }, v: 1 } });
    expect(db.dato('tenants/t1/miembros/u1')).toEqual({ rol: 'adm', actualizado: 1000, por: 'operador' });
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(auditoria(db)).toHaveLength(1);
    expect(auditoria(db)[0]).toMatchObject({
      uid: 'operador',
      accion: 'miembro.asignar-primer-adm',
      ruta: 'tenants/t1/miembros/u1',
      resumenAntes: { rol: null },
      resumenDespues: { rol: 'adm' },
    });
  });

  it('rechaza con 1 adm, sin escrituras nuevas', async () => {
    const { db, deps, escritos } = montaje({ u1: pw(), u2: pw() });
    await asignarPrimerAdministrador(deps, 't1', 'u1', 'operador');
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'u2', 'operador'), 'estado');
    expect(db.dato('tenants/t1/miembros/u2')).toBeUndefined();
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(escritos).toEqual(['u1']);
    expect(auditoria(db)).toHaveLength(1);
  });

  it('rechaza correo sin verificar y proveedor distinto de password', async () => {
    const { db, deps } = montaje({
      sinVerificar: { ...pw(), emailVerified: false },
      google: { providerData: [{ providerId: 'google.com' }], emailVerified: true },
    });
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'sinVerificar', 'operador'), 'correo-no-verificado');
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'google', 'operador'), 'proveedor');
    expect(db.dato('tenants/t1/contadores/roles')).toBeUndefined();
    expect(auditoria(db)).toHaveLength(0);
  });

  it('rechaza un tenant inexistente', async () => {
    const { db, deps } = montaje({ u1: pw() }, false);
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'u1', 'operador'), 'estado');
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
  });

  it('revierte el espejo, contadores y cupo si falla el claim', async () => {
    const { db, deps, fallos } = montaje({ u1: pw() });
    fallos.set = true;
    await expect(asignarPrimerAdministrador(deps, 't1', 'u1', 'operador')).rejects.toThrow('fallo de Auth');
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 0 });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 0 });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-primer-adm', 'miembro.revertir-rol']);
    fallos.set = false;
    await asignarPrimerAdministrador(deps, 't1', 'u1', 'operador'); // reintento posible
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
  });

  it('respeta el cupo de 3 usuarios', async () => {
    const { db, deps, escritos } = montaje({ u1: pw(), a: pw(), b: pw(), c: pw() });
    db.poner('tenants/t1/contadores/uso', { usuarios: 3 });
    await expect(asignarPrimerAdministrador(deps, 't1', 'u1', 'operador')).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(escritos).toEqual([]);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
    expect(db.dato('tenants/t1/contadores/roles')).toBeUndefined();
    expect(auditoria(db)).toHaveLength(0);
  });

  it('el primer adm queda como adm del tenant: puede asignar a otros hasta llenar el cupo', async () => {
    const { db, deps } = montaje({ u1: pw(), a: pw(), b: pw(), c: pw() });
    await asignarPrimerAdministrador(deps, 't1', 'u1', 'operador');
    const adm = { uid: 'u1', claims: { firebase: { sign_in_provider: 'password' } } };
    await asignarRol(deps, adm, 't1', 'a', 'sup');
    await asignarRol(deps, adm, 't1', 'b', 'caj');
    await expect(asignarRol(deps, adm, 't1', 'c', 'caj')).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 3 });
  });

  it('entradas inválidas', async () => {
    const { deps } = montaje({});
    await rechaza(asignarPrimerAdministrador(deps, 'T 1/x', 'u1', 'op'), 'entrada-invalida');
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'a/b', 'op'), 'entrada-invalida');
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'u1', ''), 'entrada-invalida');
  });
});
