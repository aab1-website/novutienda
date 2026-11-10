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
  if (conTenant) db.poner('tenants/t1', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  const fallos = { set: false, setTrasAplicar: false, authCaidoTrasFallo: false, getUser: false };
  const escritos: string[] = [];
  const auth: AuthMin = {
    getUser: async (uid) => {
      const u = usuarios[uid];
      if (!u) throw new Error('no existe');
      if (fallos.getUser) throw new Error('Auth caído');
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (fallos.set) throw new Error('fallo de Auth');
      escritos.push(uid);
      const u = usuarios[uid];
      if (u) u.customClaims = { ...claims };
      if (fallos.setTrasAplicar) {
        if (fallos.authCaidoTrasFallo) fallos.getUser = true;
        throw new Error('fallo tras aplicar');
      }
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

  it('si setCustomUserClaims aplica el claim y luego lanza, conserva el espejo y lanza «estado»', async () => {
    const { db, deps, fallos, usuarios } = montaje({ u1: pw() });
    fallos.setTrasAplicar = true;
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'u1', 'operador'), 'estado');
    expect(usuarios['u1']?.customClaims).toMatchObject({ pl: { t: { t1: 'adm' } } });
    expect(db.dato('tenants/t1/miembros/u1')).toMatchObject({ rol: 'adm' });
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-primer-adm']);
  });

  it('si el claim falla y Auth no responde al releer, no revierte y lanza «estado»', async () => {
    const { db, deps, fallos } = montaje({ u1: pw() });
    fallos.setTrasAplicar = true;
    fallos.authCaidoTrasFallo = true;
    await rechaza(asignarPrimerAdministrador(deps, 't1', 'u1', 'operador'), 'estado');
    expect(db.dato('tenants/t1/miembros/u1')).toMatchObject({ rol: 'adm' });
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-primer-adm']);
  });

  it('dos llamadas concurrentes con distinto uid: exactamente un éxito y adm=1', async () => {
    const { db, deps } = montaje({ u1: pw(), u2: pw() });
    const r = await Promise.allSettled([
      asignarPrimerAdministrador(deps, 't1', 'u1', 'operador'),
      asignarPrimerAdministrador(deps, 't1', 'u2', 'operador'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazo = r.find((x) => x.status === 'rejected');
    expect((rechazo as PromiseRejectedResult).reason).toBeInstanceOf(ErrorIdentidad);
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect([db.dato('tenants/t1/miembros/u1'), db.dato('tenants/t1/miembros/u2')].filter((m) => m !== undefined)).toHaveLength(1);
  });

  it.each(['sup', 'caj'] as const)('un miembro previo %s promovido no reserva otro cupo: contador en 1', async (rolPrevio) => {
    const { db, deps } = montaje({ u1: pw() });
    db.poner('tenants/t1/miembros/u1', { rol: rolPrevio, actualizado: 1, por: 'x' });
    db.poner('tenants/t1/contadores/uso', { usuarios: 1 });
    await asignarPrimerAdministrador(deps, 't1', 'u1', 'operador');
    expect(db.dato('tenants/t1/miembros/u1')).toMatchObject({ rol: 'adm' });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(auditoria(db)[0]).toMatchObject({ resumenAntes: { rol: rolPrevio } });
  });

  it('rechaza un operador con caracteres fuera de ^[a-z0-9:._@-]{1,128}$', async () => {
    const { db, deps, escritos } = montaje({ u1: pw() });
    for (const op of ['Operador', 'a b', 'a/b', 'x'.repeat(129), 'ñ', 'a\nb']) {
      await rechaza(asignarPrimerAdministrador(deps, 't1', 'u1', op), 'entrada-invalida');
    }
    await asignarPrimerAdministrador(deps, 't1', 'u1', 'op.er_a:1@x-y'); // válido
    expect(escritos).toEqual(['u1']);
    expect(auditoria(db)).toHaveLength(1);
  });
});
