import { describe, expect, it } from 'vitest';
import { LIMITE_BYTES_CLAIM } from '@plataforma/nucleo';
import {
  asignarRol,
  construirClaim,
  ErrorIdentidad,
  esPropietario,
  leerClaim,
  proveedorDe,
  rolEn,
  type AuthMin,
  type DepsIdentidad,
} from '@plataforma/nucleo';
import { LimiteDelPlan } from '@plataforma/nucleo';
import { DobleDb } from '../limites/doble-db.js';

const tok = (t: Record<string, string>, proveedor: string, extra: Record<string, unknown> = {}) => ({
  uid: 'x',
  firebase: { sign_in_provider: proveedor },
  pl: { t, v: 1, ...extra },
});

describe('claim y rolEn', () => {
  it('construye un claim válido y lo lee', () => {
    const c = construirClaim({ t1: 'adm' }, 2, true);
    expect(c.ok && c.valor).toEqual({ pl: { t: { t1: 'adm' }, p: true, v: 2 } });
    expect(construirClaim({ t1: 'caj' }, 1).ok).toBe(true);
    expect(leerClaim({ iss: 'x', pl: { t: { t1: 'sup' }, v: 1 } }).ok).toBe(true);
  });

  it('devuelve el rol del tenant correcto', () => {
    expect(rolEn(tok({ t1: 'sup' }, 'password'), 't1')).toBe('sup');
  });

  it('rol de otro tenant: vacío', () => {
    expect(rolEn(tok({ t2: 'adm' }, 'password'), 't1')).toBe('');
  });

  it('sin claim o claim mal formado: vacío', () => {
    expect(rolEn({}, 't1')).toBe('');
    expect(rolEn(null, 't1')).toBe('');
    expect(rolEn({ pl: { t: { t1: 'root' }, v: 1 } }, 't1')).toBe('');
    expect(leerClaim(undefined).ok).toBe(false);
  });

  it('anónimo: vacío aunque traiga claim', () => {
    expect(rolEn(tok({ t1: 'adm' }, 'anonymous'), 't1')).toBe('');
  });

  it('tenant heredado del prototipo no cuenta', () => {
    expect(rolEn(tok({}, 'password'), 'toString')).toBe('');
    expect(rolEn(tok({}, 'password'), '__proto__')).toBe('');
  });

  it('claim de 1000 bytes o más: se rechaza al construir y al leer', () => {
    const roles: Record<string, 'caj'> = {};
    for (let i = 0; i < 80; i++) roles[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    expect(JSON.stringify({ pl: { t: roles, v: 1 } }).length).toBeGreaterThanOrEqual(LIMITE_BYTES_CLAIM);
    expect(construirClaim(roles, 1).ok).toBe(false);
    expect(rolEn({ pl: { t: roles, v: 1 } }, 'tenant-numero-000')).toBe('');
  });

  it('proveedorDe y esPropietario', () => {
    expect(proveedorDe(null)).toBe('');
    expect(proveedorDe({ firebase: 3 })).toBe('');
    expect(esPropietario(tok({}, 'google.com', { p: true }))).toBe(true);
    expect(esPropietario(tok({}, 'password', { p: true }))).toBe(false);
    expect(esPropietario(tok({}, 'google.com'))).toBe(false);
    expect(esPropietario(tok({}, 'anonymous', { p: true }))).toBe(false);
  });
});

interface Usuario {
  customClaims?: Record<string, unknown>;
  providerData: { providerId: string }[];
}

function montaje(usuarios: Record<string, Usuario>) {
  const db = new DobleDb();
  db.poner('tenants/t1', { plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  const escritos: { uid: string; claims: Record<string, unknown> }[] = [];
  const auth: AuthMin = {
    getUser: async (uid) => {
      const u = usuarios[uid];
      if (!u) throw new Error('no existe');
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      escritos.push({ uid, claims });
    },
  };
  const deps: DepsIdentidad = { auth, db, ahora: () => 1000 };
  return { db, deps, escritos };
}

const pw = { providerData: [{ providerId: 'password' }] };
const admT1 = { uid: 'adm1', claims: tok({ t1: 'adm' }, 'password') };
const dueno = { uid: 'dueno', claims: tok({}, 'google.com', { p: true }) };

describe('asignarRol', () => {
  it('el administrador del tenant asigna: escribe espejo, contador y claim', async () => {
    const { db, deps, escritos } = montaje({ u1: pw });
    const claim = await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    expect(claim).toEqual({ pl: { t: { t1: 'caj' }, v: 1 } });
    expect(db.dato('tenants/t1/miembros/u1')).toEqual({ rol: 'caj', actualizado: 1000, por: 'adm1' });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(escritos).toEqual([{ uid: 'u1', claims: claim }]);
  });

  it('el propietario con Google asigna, y se conservan otros claims y roles', async () => {
    const { deps, escritos } = montaje({
      u1: { providerData: pw.providerData, customClaims: { otro: 1, pl: { t: { t2: 'sup' }, v: 4, p: true } } },
    });
    const claim = await asignarRol(deps, dueno, 't1', 'u1', 'adm');
    expect(claim).toEqual({ pl: { t: { t2: 'sup', t1: 'adm' }, p: true, v: 5 } });
    expect(escritos[0]?.claims['otro']).toBe(1);
  });

  it('reasignar a un miembro existente no consume otro cupo', async () => {
    const { db, deps } = montaje({ u1: pw });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    await asignarRol(deps, admT1, 't1', 'u1', 'sup');
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(db.dato('tenants/t1/miembros/u1')?.['rol']).toBe('sup');
  });

  it('usuario 4: LimiteDelPlan y no se toca el claim', async () => {
    const { deps, escritos } = montaje({ u1: pw, u2: pw, u3: pw, u4: pw });
    for (const u of ['u1', 'u2', 'u3']) await asignarRol(deps, admT1, 't1', u, 'caj');
    await expect(asignarRol(deps, admT1, 't1', 'u4', 'caj')).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(escritos.map((e) => e.uid)).toEqual(['u1', 'u2', 'u3']);
  });

  it('cuarto alta concurrente: solo entra el tercero', async () => {
    const { db, deps } = montaje({ u1: pw, u2: pw, u3: pw, u4: pw });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    await asignarRol(deps, admT1, 't1', 'u2', 'caj');
    const r = await Promise.allSettled([
      asignarRol(deps, admT1, 't1', 'u3', 'caj'),
      asignarRol(deps, admT1, 't1', 'u4', 'caj'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 3 });
  });

  const rechazo = async (actor: { uid: string; claims: unknown }, codigo: string, tenant = 't1') => {
    const { deps, escritos, db } = montaje({ u1: pw });
    const e = await asignarRol(deps, actor, tenant, 'u1', 'caj').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorIdentidad);
    expect((e as ErrorIdentidad).codigo).toBe(codigo);
    expect(escritos).toHaveLength(0);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
  };

  it('administrador de otro tenant: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: tok({ t2: 'adm' }, 'password') }, 'no-autorizado');
  });

  it('sin claim: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: { firebase: { sign_in_provider: 'password' } } }, 'no-autorizado');
  });

  it('roles que no son adm: no autorizado', async () => {
    for (const rol of ['caj', 'sup', 'dir'] as const) {
      await rechazo({ uid: 'a', claims: tok({ t1: rol }, 'password') }, 'no-autorizado');
    }
  });

  it('anónimo, aunque traiga claim de adm o p: nunca', async () => {
    await rechazo({ uid: 'a', claims: tok({ t1: 'adm' }, 'anonymous', { p: true }) }, 'anonimo');
  });

  it('administrador con Google o propietario con contraseña: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: tok({ t1: 'adm' }, 'google.com') }, 'no-autorizado');
    await rechazo({ uid: 'a', claims: tok({}, 'password', { p: true }) }, 'no-autorizado');
  });

  it('claim del actor de 1000 bytes o más: no autorizado', async () => {
    const t: Record<string, string> = { t1: 'adm' };
    for (let i = 0; i < 80; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    await rechazo({ uid: 'a', claims: tok(t, 'password') }, 'no-autorizado');
  });

  it('entradas inválidas', async () => {
    const { deps } = montaje({ u1: pw });
    for (const [t, u, r] of [['a/b', 'u1', 'caj'], ['t1', '', 'caj'], ['t1', 'a/b', 'caj'], ['t1', 'u1', 'root']] as const) {
      await expect(asignarRol(deps, dueno, t, u, r as 'caj')).rejects.toMatchObject({ codigo: 'entrada-invalida' });
    }
  });

  it('el destino debe tener correo y contraseña (no anónimo ni solo Google)', async () => {
    const { deps } = montaje({ u1: { providerData: [] }, u2: { providerData: [{ providerId: 'google.com' }] } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'proveedor' });
    await expect(asignarRol(deps, dueno, 't1', 'u2', 'caj')).rejects.toMatchObject({ codigo: 'proveedor' });
  });

  it('claim previo del destino corrupto: error de claim', async () => {
    const { deps } = montaje({ u1: { providerData: pw.providerData, customClaims: { pl: { t: 5 } } } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'claim' });
  });

  it('claim resultante de 1000 bytes o más: error de claim', async () => {
    const t: Record<string, string> = {};
    for (let i = 0; i < 40; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    const { deps, escritos } = montaje({ u1: { providerData: pw.providerData, customClaims: { pl: { t, v: 1 } } } });
    const mas = { ...t };
    for (let i = 40; i < 60; i++) mas[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    const u = await deps.auth.getUser('u1');
    Object.assign(u.customClaims?.['pl'] as { t: object }, { t: mas });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'claim' });
    expect(escritos).toHaveLength(0);
  });
});
