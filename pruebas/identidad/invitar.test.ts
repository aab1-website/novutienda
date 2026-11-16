import { describe, expect, it } from 'vitest';
import {
  activarInvitaciones,
  anularInvitacion,
  asignarRol,
  CADUCIDAD_INVITACION_MS,
  ErrorIdentidad,
  invitarMiembro,
  LimiteDelPlan,
  listarInvitaciones,
  quitarRol,
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
const adm2 = { uid: 'adm2', claims: tok({ t2: 'adm' }, 'password') };
const dueno = { uid: 'dueno', claims: tok({}, 'google.com', { p: true }) };

function montaje(opciones: { usados?: number; admins?: number; fallosClaim?: number; alSetear?: () => Promise<void>; alVerInvitador?: () => void } = {}) {
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
    adm2: vigente({ t2: 'adm' }),
    sinCorreoAuth: { ...pw, emailVerified: false },
  };
  let ahora = 1_000_000;
  let fallosRestantes = opciones.fallosClaim ?? 0;
  const auth: AuthMin = {
    getUser: async (uid) => {
      if (uid === 'adm1') opciones.alVerInvitador?.();
      const u = usuarios[uid];
      if (!u) throw Object.assign(new Error('no existe'), { code: 'auth/user-not-found' });
      return u;
    },
    setCustomUserClaims: async (uid, claims) => {
      if (fallosRestantes > 0) {
        fallosRestantes -= 1;
        await opciones.alSetear?.();
        throw new Error('fallo de Auth');
      }
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
  const sembrarT2 = () => {
    db.poner('tenants/t2', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    db.poner('tenants/t2/contadores/uso', { usuarios: 0 });
    db.poner('tenants/t2/contadores/roles', { adm: 1 });
  };
  return { db, deps, usuarios, sembrarT2, avanzar: (ms: number) => (ahora += ms), uso: () => db.dato('tenants/t1/contadores/uso')?.['usuarios'] };
}

const aud = (db: DobleDb) => db.coleccion('tenants/t1/auditoria').map((a) => a['accion']);

describe('invitarMiembro', () => {
  it('escribe el invitado sin rol, reserva un cupo y audita', async () => {
    const { db, deps, uso } = montaje();
    expect(await invitarMiembro(deps, adm1, 't1', 'n1', 'caj', true)).toEqual({ ok: true, cuentasCaducadas: [] });
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
    for (const x of r) expect(x).toEqual({ ok: true, cuentasCaducadas: [] });
    expect(m.db.dato('tenants/t1/miembros/n2')?.['estado']).toBe('invitado');
    expect(m.db.dato('tenants/t1/miembros/caj1')).toEqual({ rol: 'caj', actualizado: 1, por: 'adm1' });
  });

  it('doble invitación no reserva dos cupos', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    expect(m.uso()).toBe(1);
    expect(aud(m.db)).toEqual(['miembro.invitar']);
  });

  it('reinvitar con otro rol actualiza rolReservado sin otro cupo y audita', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    expect(m.db.dato('tenants/t1/miembros/n1')?.['rolReservado']).toBe('adm');
    expect(m.uso()).toBe(1);
    expect(aud(m.db)).toEqual(['miembro.invitar', 'miembro.invitar']);
    await invitarMiembro(m.deps, dueno, 't1', 'n1', 'sup');
    expect(m.db.dato('tenants/t1/miembros/n1')?.['invitadoPor']).toBe('dueno');
    await expect(invitarMiembro(m.deps, caj1, 't1', 'n1', 'sup')).rejects.toMatchObject({ codigo: 'no-autorizado' });
  });

  it('reinvitar con el mismo rol por otra persona la respalda: cambia invitadoPor, sin cupo nuevo, y audita el anterior', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, dueno, 't1', 'n1', 'caj');
    expect(m.db.dato('tenants/t1/miembros/n1')?.['invitadoPor']).toBe('dueno');
    expect(m.uso()).toBe(1);
    const ultima = m.db.coleccion('tenants/t1/auditoria').at(-1);
    expect(ultima).toMatchObject({ accion: 'miembro.invitar', resumenAntes: { invitadoPor: 'adm1' }, resumenDespues: { invitadoPor: 'dueno' } });
  });

  it('quien ya tiene rol en el claim del comercio, o es propietario, no se invita ni se rebaja', async () => {
    const m = montaje();
    for (const uid of ['caj1', 'dueno']) {
      expect(await invitarMiembro(m.deps, adm1, 't1', uid, 'sup')).toEqual({ ok: true, cuentasCaducadas: [] });
      expect(m.db.dato(`tenants/t1/miembros/${uid}`)).toBeUndefined();
    }
    expect(m.uso()).toBe(0);
    expect(m.usuarios['caj1']?.customClaims).toEqual({ pl: { t: { t1: 'caj' }, v: 1 } });
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
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj', true); // usados 3 (tope)
    m.avanzar(CADUCIDAD_INVITACION_MS + 1);
    const r = await invitarMiembro(m.deps, adm1, 't1', 'n2', 'sup'); // n1 se barre, n2 entra
    expect(r.cuentasCaducadas).toEqual(['n1']);
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
    expect(l.cuentasCaducadas).toEqual([]);
    expect(l.invitaciones.map((i) => i.uid)).toEqual(['n2']);
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
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ activados: ['t1'], sinEfecto: [], fallidos: [] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toMatchObject({ rol: 'sup', estado: 'activo', por: 'adm1' });
    expect(m.usuarios['n1']?.customClaims).toMatchObject({ pl: { t: { t1: 'sup' } } });
    expect(m.uso()).toBe(1);
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    const antes = aud(m.db).length;
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ activados: [], sinEfecto: [], fallidos: [] });
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
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ activados: [], sinEfecto: [], fallidos: [] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
  });

  it('si falla el claim, la invitación se restituye y el contador baja 1', async () => {
    const m = montaje({ fallosClaim: 1, admins: 1 });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r).toEqual({ activados: [], sinEfecto: [], fallidos: [{ tenantId: 't1', codigo: 'error' }] });
    expect(m.db.dato('tenants/t1/miembros/n1')?.['estado']).toBe('invitado');
    expect(m.db.dato('tenants/t1/miembros/n1')).not.toHaveProperty('rol');
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
    expect(m.uso()).toBe(1);
  });

  it('restituir no recrea la invitación si otro proceso quitó al miembro (sin doble liberación)', async () => {
    const m: ReturnType<typeof montaje> = montaje({
      fallosClaim: 1,
      admins: 1,
      alSetear: async () => {
        // otro proceso (fuera de la cola de este) quita al recién activado: borra el espejo y deshace cupo y contador
        m.db.poner('tenants/t1/miembros/n1', undefined);
        m.db.poner('tenants/t1/contadores/uso', { usuarios: 0 });
        m.db.poner('tenants/t1/contadores/roles', { adm: 1 });
      },
    });
    await invitarMiembro(m.deps, dueno, 't1', 'n1', 'adm');
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r.fallidos).toHaveLength(1);
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
  });

  it('claim aplicado pero sin confirmar: error de estado y la membresía activa se conserva', async () => {
    const m = montaje({
      fallosClaim: 1,
      alSetear: async () => {
        m.usuarios['n1']!.customClaims = { pl: { t: { t1: 'caj' }, v: 1 } }; // el claim sí quedó aplicado
      },
    });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r.fallidos).toEqual([{ tenantId: 't1', codigo: 'estado' }]);
    expect(m.db.dato('tenants/t1/miembros/n1')).toMatchObject({ rol: 'caj', estado: 'activo' });
  });

  it('si el rol reservado cambia entre la lectura y la transacción, se activa con el vigente', async () => {
    const m: ReturnType<typeof montaje> = montaje({
      admins: 1,
      alVerInvitador: () => {
        const d = m.db.dato('tenants/t1/miembros/n1');
        if (d?.['rolReservado'] === 'adm') m.db.poner('tenants/t1/miembros/n1', { ...d, rolReservado: 'caj' });
      },
    });
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'adm');
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r.activados).toEqual(['t1']);
    expect(m.db.dato('tenants/t1/miembros/n1')).toMatchObject({ rol: 'caj', estado: 'activo' });
    expect(m.usuarios['n1']?.customClaims).toMatchObject({ pl: { t: { t1: 'caj' } } });
    expect(m.db.dato('tenants/t1/contadores/roles')).toEqual({ adm: 1 });
  });

  it('quien invitó ya no existe: sin efecto, no fallido', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    delete m.usuarios['adm1'];
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ activados: [], sinEfecto: ['t1'], fallidos: [] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
  });

  it('el correo se exige también a Auth: el booleano del llamador no basta', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'sinCorreoAuth', 'caj');
    await expect(activarInvitaciones(m.deps, 'sinCorreoAuth', true)).rejects.toMatchObject({ codigo: 'correo-no-verificado' });
    expect(m.db.dato('tenants/t1/miembros/sinCorreoAuth')?.['estado']).toBe('invitado');
  });

  it('quien invitó ya no es administrador: sin efecto, se borra, libera el cupo y se audita', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    m.usuarios['adm1'] = vigente({ t1: 'sup' }); // degradado
    expect(await activarInvitaciones(m.deps, 'n1', true)).toEqual({ activados: [], sinEfecto: ['t1'], fallidos: [] });
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(0);
    expect(aud(m.db)).toContain('miembro.invitacion-sin-efecto');
    expect(m.usuarios['n1']?.customClaims).toBeUndefined();
  });

  it('el invitado que ya tiene rol en el comercio no se rebaja al activar: la invitación queda sin efecto', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    m.usuarios['n1']!.customClaims = { pl: { t: { t1: 'adm' }, v: 1 } };
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r.sinEfecto).toEqual(['t1']);
    expect(m.usuarios['n1']?.customClaims).toEqual({ pl: { t: { t1: 'adm' }, v: 1 } });
    expect(m.uso()).toBe(0);
  });

  it('varios comercios: el fallo en uno no corta los demás', async () => {
    const m = montaje({ fallosClaim: 1 });
    m.sembrarT2();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, adm2, 't2', 'n1', 'sup'); // misma cuenta, otro comercio
    const r = await activarInvitaciones(m.deps, 'n1', true);
    expect(r.fallidos.map((f) => f.tenantId)).toEqual(['t1']);
    expect(r.activados).toEqual(['t2']);
    expect(m.db.dato('tenants/t1/miembros/n1')?.['estado']).toBe('invitado');
    expect(m.db.dato('tenants/t2/miembros/n1')).toMatchObject({ rol: 'sup', estado: 'activo' });
    // reintento: ahora activa el que faltaba
    expect((await activarInvitaciones(m.deps, 'n1', true)).activados).toEqual(['t1']);
  });

  it('quitarRol sobre una invitación la borra y libera el cupo una vez; asignarRol la convierte sin otro cupo', async () => {
    const m = montaje();
    await invitarMiembro(m.deps, adm1, 't1', 'n1', 'caj');
    await invitarMiembro(m.deps, adm1, 't1', 'n2', 'caj');
    await quitarRol(m.deps, adm1, 't1', 'n1');
    expect(m.db.dato('tenants/t1/miembros/n1')).toBeUndefined();
    expect(m.uso()).toBe(1);
    await asignarRol(m.deps, adm1, 't1', 'n2', 'sup');
    expect(m.db.dato('tenants/t1/miembros/n2')).toMatchObject({ rol: 'sup' });
    expect(m.uso()).toBe(1);
  });

  it('errores tipados', async () => {
    const m = montaje();
    await expect(activarInvitaciones(m.deps, '', true)).rejects.toBeInstanceOf(ErrorIdentidad);
  });
});
