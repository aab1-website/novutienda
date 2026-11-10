import { describe, expect, it } from 'vitest';
import { LIMITE_BYTES_CLAIM } from '@novutienda/nucleo';
import {
  asignarRol,
  quitarRol,
  construirClaim,
  ErrorIdentidad,
  esPropietario,
  leerClaim,
  proveedorDe,
  rolEn,
  type AuthMin,
  type DepsIdentidad,
} from '@novutienda/nucleo';
import { LimiteDelPlan } from '@novutienda/nucleo';
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
  emailVerified: boolean;
}

const pw: Usuario = { providerData: [{ providerId: 'password' }], emailVerified: true };
const plDe = (t: Record<string, string>, extra: Record<string, unknown> = {}) => ({ pl: { t, v: 1, ...extra } });
/** Usuario de Auth vigente para un actor (sus claims actuales, que pueden diferir del token). */
const vigente = (t: Record<string, string>, extra: Record<string, unknown> = {}): Usuario => ({
  ...pw,
  customClaims: plDe(t, extra),
});

function montaje(usuarios: Record<string, Usuario>) {
  const db = new DobleDb();
  db.poner('tenants/t1', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  const todos: Record<string, Usuario> = {
    adm1: vigente({ t1: 'adm' }),
    dueno: vigente({}, { p: true }),
    ...usuarios,
  };
  const escritos: { uid: string; claims: Record<string, unknown> }[] = [];
  const revocados: string[] = [];
  const fallos = { set: false, setTrasAplicar: false, authCaidoTrasFallo: false, revocar: false };
  let tuvoFallo = false;
  const auth: AuthMin = {
    getUser: async (uid) => {
      if (fallos.authCaidoTrasFallo && tuvoFallo) throw new Error('Auth no responde');
      const u = todos[uid];
      if (!u) throw new Error('no existe');
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (fallos.set) throw new Error('fallo de Auth');
      escritos.push({ uid, claims });
      const u = todos[uid];
      if (u) u.customClaims = { ...claims };
      if (fallos.setTrasAplicar) {
        tuvoFallo = true;
        throw new Error('fallo de Auth tras aplicar');
      }
    },
    revokeRefreshTokens: async (uid) => {
      if (fallos.revocar) throw new Error('fallo al revocar');
      revocados.push(uid);
    },
  };
  const deps: DepsIdentidad = { auth, db, ahora: () => 1000 };
  return { db, deps, escritos, revocados, fallos, todos };
}

const admT1 = { uid: 'adm1', claims: tok({ t1: 'adm' }, 'password') };
const dueno = { uid: 'dueno', claims: tok({}, 'google.com', { p: true }) };
const auditoria = (db: DobleDb) => db.coleccion('tenants/t1/auditoria');

describe('asignarRol', () => {
  it('el administrador del tenant asigna: escribe espejo, contador, auditoría y claim', async () => {
    const { db, deps, escritos } = montaje({ u1: { ...pw } });
    const claim = await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    expect(claim).toEqual({ pl: { t: { t1: 'caj' }, v: 1 } });
    expect(db.dato('tenants/t1/miembros/u1')).toEqual({ rol: 'caj', actualizado: 1000, por: 'adm1' });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(escritos).toEqual([{ uid: 'u1', claims: claim }]);
    expect(auditoria(db)).toHaveLength(1);
    expect(auditoria(db)[0]).toMatchObject({
      uid: 'adm1',
      rol: 'adm',
      accion: 'miembro.asignar-rol',
      ruta: 'tenants/t1/miembros/u1',
      resumenAntes: { rol: null },
      resumenDespues: { rol: 'caj' },
    });
  });

  it('el propietario con Google asigna, y se conservan otros claims y roles', async () => {
    const { deps, escritos } = montaje({
      u1: { ...pw, customClaims: { otro: 1, pl: { t: { t2: 'sup' }, v: 4, p: true } } },
    });
    const claim = await asignarRol(deps, dueno, 't1', 'u1', 'adm');
    expect(claim).toEqual({ pl: { t: { t2: 'sup', t1: 'adm' }, p: true, v: 5 } });
    expect(escritos[0]?.claims['otro']).toBe(1);
  });

  it('reasignar a un miembro existente no consume otro cupo', async () => {
    const { db, deps } = montaje({ u1: { ...pw } });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    await asignarRol(deps, admT1, 't1', 'u1', 'sup');
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(db.dato('tenants/t1/miembros/u1')?.['rol']).toBe('sup');
    expect(auditoria(db)).toHaveLength(2);
  });

  it('usuario 4: LimiteDelPlan, sin claim ni auditoría', async () => {
    const { db, deps, escritos } = montaje({ u1: { ...pw }, u2: { ...pw }, u3: { ...pw }, u4: { ...pw } });
    for (const u of ['u1', 'u2', 'u3']) await asignarRol(deps, admT1, 't1', u, 'caj');
    await expect(asignarRol(deps, admT1, 't1', 'u4', 'caj')).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(escritos.map((e) => e.uid)).toEqual(['u1', 'u2', 'u3']);
    expect(auditoria(db)).toHaveLength(3);
  });

  it('cuarta alta concurrente: solo entra la tercera', async () => {
    const { db, deps } = montaje({ u1: { ...pw }, u2: { ...pw }, u3: { ...pw }, u4: { ...pw } });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    await asignarRol(deps, admT1, 't1', 'u2', 'caj');
    const r = await Promise.allSettled([
      asignarRol(deps, admT1, 't1', 'u3', 'caj'),
      asignarRol(deps, admT1, 't1', 'u4', 'caj'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 3 });
  });

  const rechazo = async (actor: { uid: string; claims: unknown }, codigo: string, vig?: Usuario) => {
    const { deps, escritos, db, revocados } = montaje({ u1: { ...pw }, ...(vig ? { [actor.uid]: vig } : {}) });
    const e = await asignarRol(deps, actor, 't1', 'u1', 'caj').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorIdentidad);
    expect((e as ErrorIdentidad).codigo).toBe(codigo);
    expect(escritos).toHaveLength(0);
    expect(revocados).toHaveLength(0);
    expect(auditoria(db)).toHaveLength(0);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
  };

  it('administrador de otro tenant: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: tok({ t2: 'adm' }, 'password') }, 'no-autorizado', vigente({ t2: 'adm' }));
  });

  it('sin claim vigente: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: { firebase: { sign_in_provider: 'password' } } }, 'no-autorizado', { ...pw });
  });

  it('actor inexistente en Auth: no autorizado', async () => {
    await rechazo({ uid: 'fantasma', claims: tok({ t1: 'adm' }, 'password') }, 'no-autorizado');
  });

  it('roles que no son adm: no autorizado', async () => {
    for (const rol of ['caj', 'sup'] as const) {
      await rechazo({ uid: 'a', claims: tok({ t1: rol }, 'password') }, 'no-autorizado', vigente({ t1: rol }));
    }
  });

  it('anónimo, aunque traiga claim de adm o p: nunca', async () => {
    await rechazo({ uid: 'a', claims: tok({ t1: 'adm' }, 'anonymous', { p: true }) }, 'anonimo', vigente({ t1: 'adm' }, { p: true }));
  });

  it('administrador con Google o propietario con contraseña: no autorizado', async () => {
    await rechazo({ uid: 'a', claims: tok({ t1: 'adm' }, 'google.com') }, 'no-autorizado', vigente({ t1: 'adm' }));
    await rechazo({ uid: 'a', claims: tok({}, 'password', { p: true }) }, 'no-autorizado', vigente({}, { p: true }));
  });

  it('claim vigente del actor de 1000 bytes o más: no autorizado', async () => {
    const t: Record<string, string> = { t1: 'adm' };
    for (let i = 0; i < 80; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    await rechazo({ uid: 'a', claims: tok(t, 'password') }, 'no-autorizado', vigente(t));
  });

  it('adm degradado con token previo no puede volver a darse adm', async () => {
    const { deps, todos, escritos, db } = montaje({});
    todos['adm1'] = vigente({ t1: 'caj' }); // degradado; su token sigue diciendo adm
    const e = await asignarRol(deps, admT1, 't1', 'adm1', 'adm').catch((x: unknown) => x);
    expect(e).toMatchObject({ codigo: 'no-autorizado' });
    expect(escritos).toHaveLength(0);
    expect(db.dato('tenants/t1/miembros/adm1')).toBeUndefined();
  });

  it('propietario al que se le retiró p con token previo: no autorizado', async () => {
    const { deps, todos } = montaje({ u1: { ...pw } });
    todos['dueno'] = vigente({});
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'no-autorizado' });
  });

  it('entradas inválidas', async () => {
    const { deps } = montaje({ u1: { ...pw } });
    for (const [t, u, r] of [['a/b', 'u1', 'caj'], ['t1', '', 'caj'], ['t1', 'a/b', 'caj'], ['t1', 'u1', 'root']] as const) {
      await expect(asignarRol(deps, dueno, t, u, r as 'caj')).rejects.toMatchObject({ codigo: 'entrada-invalida' });
    }
  });

  it('el destino debe tener correo y contraseña (no anónimo ni solo Google)', async () => {
    const { deps } = montaje({
      u1: { providerData: [], emailVerified: true },
      u2: { providerData: [{ providerId: 'google.com' }], emailVerified: true },
    });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'proveedor' });
    await expect(asignarRol(deps, dueno, 't1', 'u2', 'caj')).rejects.toMatchObject({ codigo: 'proveedor' });
  });

  it('destino con correo sin verificar: se rechaza y no se escribe nada', async () => {
    const { deps, db, escritos } = montaje({ u1: { ...pw, emailVerified: false } });
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'correo-no-verificado' });
    expect(escritos).toHaveLength(0);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
    expect(auditoria(db)).toHaveLength(0);
  });

  it('claim previo del destino corrupto: error de claim', async () => {
    const { deps } = montaje({ u1: { ...pw, customClaims: { pl: { t: 5 } } } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'claim' });
  });

  it('claim resultante de 1000 bytes o más: error de claim, sin escribir', async () => {
    const t: Record<string, string> = {};
    for (let i = 0; i < 40; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    const { deps, escritos, db } = montaje({ u1: { ...pw, customClaims: { pl: { t, v: 1 } } } });
    for (let i = 40; i < 60; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'claim' });
    expect(escritos).toHaveLength(0);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
  });

  it('el tamaño se mide sobre el claim COMPLETO, con las demás claves del usuario', async () => {
    const t: Record<string, string> = {};
    for (let i = 0; i < 25; i++) t[`tenant-numero-${String(i).padStart(3, '0')}`] = 'caj';
    const solo = JSON.stringify({ pl: { t: { ...t, t1: 'caj' }, v: 2 } }).length;
    expect(solo).toBeLessThan(LIMITE_BYTES_CLAIM);
    const ajeno = 'x'.repeat(LIMITE_BYTES_CLAIM - solo + 10);
    const { deps, escritos } = montaje({ u1: { ...pw, customClaims: { otro: ajeno, pl: { t, v: 1 } } } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'claim' });
    expect(escritos).toHaveLength(0);
  });

  it('jerarquía: un adm administra caj y sup, pero no otorga ni degrada adm, ni toca al propietario', async () => {
    const { deps, escritos, todos, db } = montaje({
      u1: { ...pw },
      jefe: { ...pw, customClaims: plDe({ t1: 'adm' }) },
      due: { ...pw, customClaims: plDe({}, { p: true }) },
    });
    db.poner('tenants/t1/miembros/jefe', { rol: 'adm', actualizado: 1, por: 'x' });
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'adm')).rejects.toMatchObject({ codigo: 'jerarquia' });
    await expect(asignarRol(deps, admT1, 't1', 'jefe', 'caj')).rejects.toMatchObject({ codigo: 'jerarquia' });
    await expect(quitarRol(deps, admT1, 't1', 'jefe')).rejects.toMatchObject({ codigo: 'jerarquia' });
    await expect(asignarRol(deps, admT1, 't1', 'due', 'caj')).rejects.toMatchObject({ codigo: 'jerarquia' });
    expect(escritos).toHaveLength(0);
    expect(todos['jefe']?.customClaims).toEqual(plDe({ t1: 'adm' }));
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'sup')).resolves.toBeDefined();
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'caj')).resolves.toBeDefined();
  });

  it('jerarquía: solo el espejo dice adm (claim desfasado): el adm tampoco puede degradarlo', async () => {
    const { deps, db, escritos } = montaje({ jefe: { ...pw } });
    db.poner('tenants/t1/miembros/jefe', { rol: 'adm', actualizado: 1, por: 'x' });
    await expect(asignarRol(deps, admT1, 't1', 'jefe', 'caj')).rejects.toMatchObject({ codigo: 'jerarquia' });
    expect(escritos).toHaveLength(0);
  });

  it('el propietario sí asigna adm', async () => {
    const { deps } = montaje({ u1: { ...pw } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'adm')).resolves.toMatchObject({ pl: { t: { t1: 'adm' } } });
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'caj')).resolves.toMatchObject({ pl: { t: { t1: 'caj' } } });
  });

  it('revoca sesiones cuando el rol baja y no cuando sube o se mantiene', async () => {
    const { deps, revocados } = montaje({ u1: { ...pw } });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    await asignarRol(deps, admT1, 't1', 'u1', 'sup');
    await asignarRol(deps, admT1, 't1', 'u1', 'sup');
    expect(revocados).toEqual([]);
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    expect(revocados).toEqual(['u1']);
  });

  it('carrera de claims entre tenants: el segundo conserva el rol del primero', async () => {
    const { deps, todos, db } = montaje({ u1: { ...pw } });
    db.poner('tenants/t2', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    await Promise.all([asignarRol(deps, dueno, 't1', 'u1', 'caj'), asignarRol(deps, dueno, 't2', 'u1', 'sup')]);
    const pl = todos['u1']?.customClaims?.['pl'] as { t: Record<string, string>; v: number };
    expect(pl.t).toEqual({ t1: 'caj', t2: 'sup' });
    expect(pl.v).toBe(2);
  });

  it('carrera con otro proceso: si la versión cambia entre lectura y escritura, recompone sin perder el rol ajeno', async () => {
    const { deps, todos } = montaje({ u1: { ...pw, customClaims: plDe({ t2: 'sup' }) } });
    const original = deps.auth.setCustomUserClaims;
    let intruso = true;
    const auth: AuthMin = {
      ...deps.auth,
      setCustomUserClaims: async (uid, claims) => {
        if (intruso) {
          // Otro proceso escribe justo antes: su escritura se pierde con el set ciego, y la comprobación lo detecta.
          intruso = false;
          await original(uid, { ...claims, pl: { t: { t2: 'sup', t3: 'caj' }, v: 7 } });
          return;
        }
        await original(uid, claims);
      },
    };
    const claim = await asignarRol({ ...deps, auth }, dueno, 't1', 'u1', 'caj');
    expect(claim.pl.t).toEqual({ t2: 'sup', t3: 'caj', t1: 'caj' });
    expect(claim.pl.v).toBe(8);
    expect(todos['u1']?.customClaims?.['pl']).toEqual(claim.pl);
  });

  it('si falla el seteo del claim, el espejo y el cupo vuelven a como estaban', async () => {
    const { deps, db, fallos, revocados } = montaje({ u1: { ...pw } });
    fallos.set = true;
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'caj')).rejects.toThrow(/fallo de Auth/);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 0 });
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 0 });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-rol', 'miembro.revertir-rol']);
    expect(revocados).toHaveLength(0);
  });

  it('si setCustomUserClaims aplica el claim y luego lanza, conserva el espejo y lanza «estado»', async () => {
    const { deps, db, fallos, todos, revocados } = montaje({ u1: { ...pw } });
    fallos.setTrasAplicar = true;
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'estado' });
    expect(todos['u1']?.customClaims).toMatchObject({ pl: { t: { t1: 'caj' } } });
    expect(db.dato('tenants/t1/miembros/u1')).toMatchObject({ rol: 'caj' });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-rol']);
    expect(revocados).toHaveLength(0);
  });

  it('si el claim falla y Auth no responde al releer, no revierte y lanza «estado»', async () => {
    const { deps, db, fallos } = montaje({ u1: { ...pw } });
    fallos.setTrasAplicar = true;
    fallos.authCaidoTrasFallo = true;
    await expect(asignarRol(deps, admT1, 't1', 'u1', 'caj')).rejects.toMatchObject({ codigo: 'estado' });
    expect(db.dato('tenants/t1/miembros/u1')).toMatchObject({ rol: 'caj' });
    expect(auditoria(db).map((a) => a['accion'])).toEqual(['miembro.asignar-rol']);
  });

  it('si falla el seteo en un miembro existente, se restaura su rol anterior', async () => {
    const { deps, db, fallos } = montaje({ u1: { ...pw } });
    await asignarRol(deps, admT1, 't1', 'u1', 'sup');
    fallos.set = true;
    await expect(asignarRol(deps, dueno, 't1', 'u1', 'adm')).rejects.toThrow(/fallo de Auth/);
    expect(db.dato('tenants/t1/miembros/u1')?.['rol']).toBe('sup');
    expect(db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 0 });
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
  });
});

describe('quitarRol', () => {
  it('borra el espejo, libera el cupo, conserva los demás tenants, revoca y audita', async () => {
    const { deps, db, todos, revocados } = montaje({ u1: { ...pw, customClaims: { otro: 1, ...plDe({ t2: 'sup' }) } } });
    await asignarRol(deps, admT1, 't1', 'u1', 'caj');
    const claim = await quitarRol(deps, admT1, 't1', 'u1');
    expect(claim.pl.t).toEqual({ t2: 'sup' });
    expect(todos['u1']?.customClaims?.['otro']).toBe(1);
    expect(db.dato('tenants/t1/miembros/u1')).toBeUndefined();
    expect(db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 0 });
    expect(revocados).toEqual(['u1']);
    expect(auditoria(db).at(-1)).toMatchObject({
      accion: 'miembro.quitar-rol',
      uid: 'adm1',
      resumenAntes: { rol: 'caj' },
      resumenDespues: { rol: null },
    });
  });

  it('libera el cupo: se puede dar de alta otro usuario después', async () => {
    const m = montaje({ u1: { ...pw }, u2: { ...pw }, u3: { ...pw }, u4: { ...pw } });
    for (const u of ['u1', 'u2', 'u3']) await asignarRol(m.deps, admT1, 't1', u, 'caj');
    await expect(asignarRol(m.deps, admT1, 't1', 'u4', 'caj')).rejects.toBeInstanceOf(LimiteDelPlan);
    await quitarRol(m.deps, admT1, 't1', 'u3');
    await expect(asignarRol(m.deps, admT1, 't1', 'u4', 'caj')).resolves.toBeDefined();
  });

  it('mismos requisitos de autorización: adm degradado, caj, anónimo y otro tenant no pueden', async () => {
    const m = montaje({ u1: { ...pw }, c1: vigente({ t1: 'caj' }) });
    await asignarRol(m.deps, admT1, 't1', 'u1', 'caj');
    m.todos['adm1'] = vigente({ t1: 'caj' });
    await expect(quitarRol(m.deps, admT1, 't1', 'u1')).rejects.toMatchObject({ codigo: 'no-autorizado' });
    await expect(quitarRol(m.deps, { uid: 'c1', claims: tok({ t1: 'caj' }, 'password') }, 't1', 'u1')).rejects.toMatchObject({
      codigo: 'no-autorizado',
    });
    await expect(
      quitarRol(m.deps, { uid: 'adm1', claims: tok({ t1: 'adm' }, 'anonymous') }, 't1', 'u1'),
    ).rejects.toMatchObject({ codigo: 'anonimo' });
    expect(m.db.dato('tenants/t1/miembros/u1')).toBeDefined();
  });

  it('no se puede quitar al último adm; con dos, sí (solo el propietario)', async () => {
    const m = montaje({ a1: { ...pw }, a2: { ...pw } });
    await asignarRol(m.deps, dueno, 't1', 'a1', 'adm');
    await expect(quitarRol(m.deps, dueno, 't1', 'a1')).rejects.toMatchObject({ codigo: 'ultimo-adm' });
    expect(m.db.dato('tenants/t1/miembros/a1')).toBeDefined();
    await asignarRol(m.deps, dueno, 't1', 'a2', 'adm');
    await expect(quitarRol(m.deps, dueno, 't1', 'a2')).resolves.toBeDefined();
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    await expect(quitarRol(m.deps, dueno, 't1', 'a1')).rejects.toMatchObject({ codigo: 'ultimo-adm' });
  });

  it('quitar a quien no es miembro: error, sin escribir', async () => {
    const { deps, escritos, revocados } = montaje({ u1: { ...pw } });
    await expect(quitarRol(deps, admT1, 't1', 'u1')).rejects.toMatchObject({ codigo: 'no-miembro' });
    expect(escritos).toHaveLength(0);
    expect(revocados).toHaveLength(0);
  });

  it('entradas inválidas', async () => {
    const { deps } = montaje({});
    await expect(quitarRol(deps, dueno, 'a/b', 'u1')).rejects.toMatchObject({ codigo: 'entrada-invalida' });
    await expect(quitarRol(deps, dueno, 't1', 'a/b')).rejects.toMatchObject({ codigo: 'entrada-invalida' });
  });

  it('si falla el claim, el espejo y el cupo se restauran', async () => {
    const m = montaje({ u1: { ...pw } });
    await asignarRol(m.deps, admT1, 't1', 'u1', 'caj');
    m.fallos.set = true;
    await expect(quitarRol(m.deps, admT1, 't1', 'u1')).rejects.toThrow(/fallo de Auth/);
    expect(m.db.dato('tenants/t1/miembros/u1')?.['rol']).toBe('caj');
    expect(m.db.dato('tenants/t1/contadores/uso')).toEqual({ usuarios: 1 });
    expect(m.revocados).toHaveLength(0);
  });
});
