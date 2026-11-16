import { describe, expect, it } from 'vitest';
import {
  activarInvitaciones,
  anularInvitacion,
  CADUCIDAD_INVITACION_MS,
  ErrorIdentidad,
  invitarMiembro,
  LimiteDelPlan,
  listarInvitaciones,
  reenviarInvitacion,
  type AuthMin,
  type DepsInvitar,
} from '@novutienda/nucleo';
import { DobleDb } from '../limites/doble-db.js';

interface Usuario {
  customClaims?: Record<string, unknown>;
  providerData: { providerId: string }[];
  emailVerified: boolean;
}
const pw: Usuario = { providerData: [{ providerId: 'password' }], emailVerified: true };
const vigente = (t: Record<string, string>, extra: Record<string, unknown> = {}): Usuario => ({
  ...pw,
  customClaims: { pl: { t, v: 1, ...extra } },
});
const tok = (t: Record<string, string>, proveedor: string, extra: Record<string, unknown> = {}) => ({
  uid: 'x',
  firebase: { sign_in_provider: proveedor },
  pl: { t, v: 1, ...extra },
});

const adm1 = { uid: 'adm1', claims: tok({ t1: 'adm' }, 'password') };
const sup1 = { uid: 'sup1', claims: tok({ t1: 'sup' }, 'password') };
const caj1 = { uid: 'caj1', claims: tok({ t1: 'caj' }, 'password') };
const dueno = { uid: 'dueno', claims: tok({}, 'google.com', { p: true }) };

function montaje(opciones: { usados?: number; admins?: number; falloClaim?: boolean } = {}) {
  const db = new DobleDb();
  db.poner('tenants/t1', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  db.poner('tenants/t1/contadores/uso', { usuarios: opciones.usados ?? 0 });
  db.poner('tenants/t1/contadores/roles', { adm: opciones.admins ?? 1 });
  const usuarios: Record<string, Usuario> = {
    adm1: vigente({ t1: 'adm' }),
    sup1: vigente({ t1: 'sup' }),
    caj1: vigente({ t1: 'caj' }),
    dueno: vigente({}, { p: true }),
    n1: { ...pw },
    n2: { ...pw },
    n3: { ...pw },
    sinVerificar: { ...pw, emailVerified: false },
  };
  let ahora = 1_000_000;
  const auth: AuthMin = {
    getUser: async (uid) => {
      const u = usuarios[uid];
      if (!u) throw new Error('no existe');
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (opciones.falloClaim) throw new Error('fallo de Auth');
      const u = usuarios[uid];
      if (u) u.customClaims = { ...claims };
    },
    revokeRefreshTokens: async () => undefined,
  };
  const deps: DepsInvitar = {
    auth,
    db,
    ahora: () => ahora,
    indice: {
      invitadosDe: async (t) =>
        [...db.docs]
          .filter(([r, d]) => r.startsWith(`tenants/${t}/miembros/`) && d.datos?.['estado'] === 'invitado')
          .map(([r]) => r.split('/')[3] ?? ''),
      tenantsDe: async (uid) =>
        [...db.docs]
          .filter(([r, d]) => /^tenants\/[^/]+\/miembros\//.test(r) && r.endsWith(`/${uid}`) && d.datos?.['estado'] === 'invitado')
          .map(([r]) => r.split('/')[1] ?? ''),
    },
  };
  return { db, deps, usuarios, avanzar: (ms: number) => (ahora += ms), uso: () => db.dato('tenants/t1/contadores/uso')?.['usuarios'] };
}

const aud = (db: DobleDb) => db.coleccion('tenants/t1/auditoria').map((a) => a['accion']);

describe('invitarMiembro', () => {
  it('escribe el invitado sin rol, reserva un cupo y audita', async () => {
    const { db, deps, uso } = montaje();
    expect(await invitarMiembro(deps, adm1, 't1', 'n1', 'caj', true)).toEqual({ ok: true });
    const d = db.dato('tenants/t1/miembros/n1');
    expect(d).toEqual({
      estado: 'invitado',
      uid: 'n1',
      rolReservado: 'caj',
      invitadoPor: 'adm1',
      invitadoEnMs: 1_000_000,
      venceEnMs: 1_000_000 + CADUCIDAD_INVITACION_MS,
      cuentaCreada: true,
    });
    expect(d).not.toHaveProperty('rol');
    expect(uso()).toBe(1);
    expect(aud(db)).toEqual(['miembro.invitar']);
  });

  it('cupo lleno: LimiteDelPlan y no escribe nada', async () => {
    const { db, deps } = montaje({ usados: 3 });
    await expect(invitarMiembro(deps, adm1, 't1', 'n1', 'caj')).rejects.toBeInstanceOf(LimiteDelPlan);
    expect(db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(aud(db)).toEqual([]);
  });

  it('jerarquía: el administrador invita caj, sup y adm; el propietario también; sup y caj no', async () => {
    const { db, deps } = montaje({ usados: 0 });
    for (const [uid, rol] of [['n1', 'caj'], ['n2', 'sup'], ['n3', 'adm']] as const) {
      await invitarMiembro(deps, adm1, 't1', uid, rol);
      expect(db.dato(`tenants/t1/miembros/${uid}`)?.['rolReservado']).toBe(rol);
    }
    const otra = montaje();
    await invitarMiembro(otra.deps, dueno, 't1', 'n1', 'adm');
    expect(otra.db.dato('tenants/t1/miembros/n1')?.['rolReservado']).toBe('adm');
    for (const actor of [sup1, caj1]) {
      const m = montaje();
      await expect(invitarMiembro(m.deps, actor, 't1', 'n1', 'caj')).rejects.toMatchObject({ codigo: 'no-autorizado' });
      expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
      expect(m.uso()).toBe(0);
    }
  });

  it('respuesta uniforme: nueva, repetida, miembro activo y cuenta de otro comercio responden igual', async () => {
    const m = montaje();
    m.db.poner('tenants/t1/miembros/caj1', { rol: 'caj', actualizado: 1, por: 'adm1' });
    m.db.poner('tenants/otro/miembros/n2', { rol: 'sup', actualizado: 1, por: 'x' });
    const r = [
      await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj'),
      await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj'),
      await invitarMiembro(m.deps, adm1, 't1', 'caj1', 'sup'),
      await invitarMiembro(m.deps, adm1, 't1', 'n2', 'sup'),
    ];
    for (const x of r) expect(x).toEqual({ ok: true });
    expect(m.db.dato('tenants/t1/miembros/n2')?.['estado']).toBe('invitado');
    expect(m.db.dato('tenants/t1/miembros/caj1')).toEqual({ rol: 'caj', actualizado: 1, por: 'adm1' });
  });

  it('doble invitación no reserva dos cupos', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    expect(m.uso()).toBe(1);
    expect(m.db.dato('tenants/t1/miembros/n1')?.['rolReservado']).toBe('caj');
    expect(aud(m.db)).toEqual(['miembro.invitar']);
  });

  it('el invitado no cuenta como administrador ni como rol', async () => {
    const m = montaje({ admins: 1 });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(m.db.dato('tenants/t1/miembros/n1')?.['rol']).toBeUndefined();
    expect(m.usuarios['n1']?.customClaims).toBeUndefined();
  });

  it('invitación vencida: se barre al invitar y libera el cupo', async () => {
    const m = montaje({ usados: 2 });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj'); // usados 3 (tope)
    m.avanzar(CADUCIDAD_INVITACION_MS + 1);
    await invitarMiembro(m.deps, adm1, 't1', 'n2', 'sup'); // n1 se barre, n2 entra
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(3);
    expect(aud(m.db)).toContain('miembro.invitacion-vencida');
  });
});

describe('listar, anular y reenviar', () => {
  it('listar barre las vencidas y devuelve solo las vigentes', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    m.avanzar(CADUCIDAD_INVITACION_MS - 10);
    await invitarMiembro(m.deps, adm1, 't1', 'n2', 'sup');
    m.avanzar(20); // n1 vencida, n2 vigente
    const l = await listarInvitaciones(m.deps, adm1, 't1');
    expect(l.map((i) => i.uid)).toEqual(['n2']);
    expect(m.uso()).toBe(1);
  });

  it('anular borra, libera el cupo, audita y devuelve cuentaCreada', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj', true);
    await invitarMiembro(m.deps, adm1, 't1', 'n2', 'caj', false);
    expect(await anularInvitacion(m.deps, adm1, 't1', 'n1')).toEqual({ cuentaCreada: true });
    expect(await anularInvitacion(m.deps, adm1, 't1', 'n2')).toEqual({ cuentaCreada: false });
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
    expect(aud(m.db)).toContain('miembro.anular-invitacion');
    await expect(anularInvitacion(m.deps, adm1, 't1', 'n1')).rejects.toMatchObject({ codigo: 'no-miembro' });
  });

  it('anular no toca a un miembro activo', async () => {
    const m = montaje();
    m.db.poner('tenants/t1/miembros/caj1', { rol: 'caj', actualizado: 1, por: 'adm1' });
    await expect(anularInvitacion(m.deps, adm1, 't1', 'caj1')).rejects.toMatchObject({ codigo: 'estado' });
  });

  it('reenviar extiende la caducidad', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    m.avanzar(3 * 24 * 60 * 60 * 1000);
    const r = await reenviarInvitacion(m.deps, adm1, 't1', 'n1');
    expect(r.venceEnMs).toBe(1_000_000 + 3 * 24 * 60 * 60 * 1000 + CADUCIDAD_INVITACION_MS);
    expect(m.db.dato('tenants/t1/miembros/n1')?.['venceEnMs']).toBe(r.venceEnMs);
    expect(m.uso()).toBe(1);
  });
});

describe('activarInvitaciones', () => {
  it('pone rol y estado activo, escribe el claim, audita y es idempotente', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'sup');
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ tenants: ['t1'] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toMatchObject({ rol: 'sup', estado: 'activo', por: 'adm1' });
    expect(m.usuarios['n1']?.customClaims).toMatchObject({ pl: { t: { t1: 'sup' } } });
    expect(m.uso()).toBe(1);
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    const antes = aud(m.db).length;
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ tenants: [] });
    expect(aud(m.db)).toHaveLength(antes);
    expect(aud(m.db)).toContain('miembro.activar');
  });

  it('un administrador invitado suma al contador de administradores al activar', async () => {
    const m = montaje({ admins: 1 });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    await activarInvitaciones(m.deps, 'n1', true);
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 2 });
  });

  it('sin correo verificado: correo-no-verificado y la invitación sigue', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'sinVerificar', 'caj');
    await expect(activarInvitaciones(m.deps, 'sinVerificar', false)).rejects.toMatchObject({ codigo: 'correo-no-verificado' });
    expect(m.db.dato('tenants/t1/miembros/sinVerificar')?.['estado']).toBe('invitado');
  });

  it('invitación vencida: no activa, se barre y libera el cupo', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    m.avanzar(CADUCIDAD_INVITACION_MS + 1);
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ tenants: [] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
  });

  it('si falla el claim, la invitación se restituye', async () => {
    const m = montaje({ falloClaim: true, admins: 1 });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    await expect(activarInvitaciones(m.deps, 'n1', true)).rejects.toThrow('fallo de Auth');
    expect(m.db.dato('tenants/t1/miembros/n1')?.['estado']).toBe('invitado');
    expect(m.db.dato('tenants/t1/miembros/n1')).not.toHaveProperty('rol');
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
  });

  it('errores tipados', async () => {
    const m = montaje();
    await expect(activarInvitaciones(m.deps, '', true)).rejects.toBeInstanceOf(ErrorIdentidad);
  });
});
