// Invitar personas desde el panel (U-01), lado servidor de Central: acciones de `llamadas/usuarios.ts` con dobles (sin emulador).
import { describe, expect, it } from 'vitest';
import { limiteMemoria, type AuthMin } from '@novutienda/nucleo';
import { accionesUsuarios, manejadorActivarInvitaciones, MAXIMO_INVITACIONES_POR_HORA, VENTANA_INVITACIONES_MS } from '../../plataforma/funciones/servidor/llamadas/usuarios.js';
import type { Contexto } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import type { Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { DobleDb } from '../limites/doble-db.js';

interface Cuenta {
  uid: string;
  email: string;
  emailVerified: boolean;
  disabled: boolean;
  providerData: { providerId: string }[];
  customClaims?: Record<string, unknown>;
  metadata: { creationTime?: string; lastSignInTime?: string };
}

const tok = (t: Record<string, string>, proveedor = 'password') => ({ uid: 'x', firebase: { sign_in_provider: proveedor }, pl: { t, v: 1 } });
const CREACION = 'Mon, 16 Nov 2026 15:00:00 GMT';
const pw = { providerData: [{ providerId: 'password' }], emailVerified: true, disabled: false, metadata: {} };

function montaje(opciones: { usados?: number } = {}) {
  const db = new DobleDb();
  db.poner('tenants/t1', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  db.poner('tenants/t1/contadores/uso', { usuarios: opciones.usados ?? 0 });
  db.poner('tenants/t1/contadores/roles', { adm: 1 });
  db.poner('tenants/t1/miembros/adm1', { rol: 'adm', estado: 'activo' });
  db.poner('tenants/t2', { plan: 'base', estado: 'activo', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  db.poner('tenants/t2/contadores/uso', { usuarios: 1 });
  db.poner('tenants/t2/contadores/roles', { adm: 1 });
  const cuentas = new Map<string, Cuenta>();
  const poner = (uid: string, extra: Partial<Cuenta> = {}): Cuenta => {
    const c: Cuenta = { uid, email: `${uid}@ejemplo.test`, ...pw, ...extra };
    cuentas.set(uid, c);
    return c;
  };
  poner('adm1', { customClaims: { pl: { t: { t1: 'adm' }, v: 1 } } });
  poner('sup1', { customClaims: { pl: { t: { t1: 'sup' }, v: 1 } } });
  poner('caj1', { customClaims: { pl: { t: { t1: 'caj' }, v: 1 } } });
  poner('otro', { email: 'otro@ejemplo.test', customClaims: { pl: { t: { t2: 'adm' }, v: 1 } } });
  poner('libre', { email: 'libre@ejemplo.test' });
  poner('google', { email: 'google@ejemplo.test', providerData: [{ providerId: 'google.com' }] });
  let ahora = 10_000_000;
  let secuencia = 0;
  const falta = () => Object.assign(new Error('no existe'), { code: 'auth/user-not-found' });
  const registro: string[] = [];
  const auth = {
    getUserByEmail: async (correo: string) => {
      const c = [...cuentas.values()].find((x) => x.email === correo);
      if (!c) throw falta();
      return c;
    },
    getUser: async (uid: string) => {
      const c = cuentas.get(uid);
      if (!c) throw falta();
      return c;
    },
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map((i) => cuentas.get(i.uid)).filter((c): c is Cuenta => c !== undefined) }),
    createUser: async (p: { email: string; password: string; emailVerified: boolean }) => {
      registro.push(`crear:${p.password.length}:${String(p.emailVerified)}`);
      const uid = `nuevo${String((secuencia += 1))}`;
      return poner(uid, { email: p.email, emailVerified: p.emailVerified, providerData: [{ providerId: 'password' }], metadata: { creationTime: CREACION, lastSignInTime: CREACION } }); // como Auth: sin uso, el último ingreso es la creación
    },
    deleteUser: async (uid: string) => {
      cuentas.delete(uid);
      registro.push('borrar');
    },
    verifyIdToken: async (t: string) => {
      const c = cuentas.get(t);
      if (!c) throw new Error('token');
      return { uid: c.uid, email_verified: c.emailVerified, firebase: { sign_in_provider: 'password' }, pl: { t: {}, v: 1 } };
    },
  };
  const authMin: AuthMin = {
    getUser: async (uid) => auth.getUser(uid),
    setCustomUserClaims: async (uid, claims) => {
      const c = cuentas.get(uid);
      if (c) c.customClaims = { ...claims };
    },
    revokeRefreshTokens: async () => undefined,
  };
  const indice = {
    invitadosDe: async (t: string) =>
      [...db.docs].filter(([r, d]) => r.startsWith(`tenants/${t}/miembros/`) && d.datos?.['estado'] === 'invitado').map(([r]) => r.split('/')[3] ?? ''),
    tenantsDe: async (uid: string) =>
      [...db.docs].filter(([r, d]) => /^tenants\/[^/]+\/miembros\//.test(r) && r.endsWith(`/${uid}`) && d.datos?.['estado'] === 'invitado').map(([r]) => r.split('/')[1] ?? ''),
  };
  const firestore = {
    collection: (ruta: string) => ({
      get: async () => ({
        docs: [...db.docs].filter(([r, d]) => r.startsWith(`${ruta}/`) && d.datos !== undefined).map(([r, d]) => ({ id: r.split('/').pop() ?? '', data: () => d.datos })),
      }),
    }),
    doc: (ruta: string) => ({ get: async () => ({ exists: db.dato(ruta) !== undefined, data: () => db.dato(ruta) }) }),
  };
  const e = {
    auth, authMin, db, firestore, ahora: () => ahora, indiceInvitaciones: indice,
    limiteInvitaciones: limiteMemoria(MAXIMO_INVITACIONES_POR_HORA, VENTANA_INVITACIONES_MS),
  } as unknown as Entorno;
  const como = (uid: string, rol: 'adm' | 'sup' | 'caj', tenantId = 't1'): Contexto =>
    ({ e, tenantId, rol, sesion: {} as never, actor: { uid, claims: tok({ [tenantId]: rol }) } }) as Contexto;
  const llamar = async (c: Contexto, nombre: string, datos: unknown): Promise<unknown> => (accionesUsuarios[nombre] as { ejecutar(c: Contexto, d: unknown): Promise<unknown> }).ejecutar(c, datos);
  return { db, e, cuentas, poner, registro, como, llamar, avanzar: (ms: number) => (ahora += ms), uso: () => db.dato('tenants/t1/contadores/uso')?.['usuarios'] };
}

const UNIFORME = { ok: true, mensaje: 'Invitación enviada' };

describe('invitarUsuario', () => {
  it('el administrador invita a una cuenta nueva: se crea con clave aleatoria sin verificar, y la respuesta es la uniforme', async () => {
    const m = montaje();
    expect(await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: ' Nueva@Ejemplo.test ', rol: 'sup' })).toEqual(UNIFORME);
    const c = [...m.cuentas.values()].find((x) => x.email === 'nueva@ejemplo.test');
    expect(c).toMatchObject({ emailVerified: false });
    expect(m.registro[0]).toMatch(/^crear:4\d:false$/); // 32 bytes en base64url: 43 caracteres
    expect(m.db.dato(`tenants/t1/miembros/${c?.uid ?? ''}`)).toMatchObject({ estado: 'invitado', rolReservado: 'sup', invitadoPor: 'adm1', cuentaCreada: true });
    expect(m.uso()).toBe(1);
  });

  it('invita a una cuenta existente (de otro comercio también) sin crearla, y también a administradores', async () => {
    const m = montaje();
    expect(await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'adm' })).toEqual(UNIFORME);
    expect(await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'otro@ejemplo.test', rol: 'caj' })).toEqual(UNIFORME);
    expect(m.registro).toEqual([]);
    expect(m.db.dato('tenants/t1/miembros/libre')).toMatchObject({ estado: 'invitado', rolReservado: 'adm', cuentaCreada: false });
    expect(m.db.dato('tenants/t1/miembros/otro')).toMatchObject({ estado: 'invitado', rolReservado: 'caj' });
    expect(m.cuentas.get('otro')?.customClaims).toEqual({ pl: { t: { t2: 'adm' }, v: 1 } }); // la invitación no toca el claim
  });

  it('supervisor y cajero no invitan (lo impone el núcleo)', async () => {
    const m = montaje();
    for (const [uid, rol] of [['sup1', 'sup'], ['caj1', 'caj']] as const) {
      await expect(m.llamar(m.como(uid, rol), 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'caj' })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    }
    expect(m.db.dato('tenants/t1/miembros/libre')).toBeUndefined();
  });

  it('la respuesta es idéntica para cuenta nueva, existente, de otro comercio, ya miembro y sin contraseña', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    const r: unknown[] = [];
    for (const correo of ['nadie@ejemplo.test', 'libre@ejemplo.test', 'otro@ejemplo.test', 'caj1@ejemplo.test', 'google@ejemplo.test']) {
      r.push(await m.llamar(c, 'invitarUsuario', { correo, rol: 'caj' }));
    }
    expect(new Set(r.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(r[0]).toEqual(UNIFORME);
    expect(m.db.dato('tenants/t1/miembros/google')).toBeUndefined(); // sin proveedor de contraseña: no se invita
    expect(m.db.dato('tenants/t1/miembros/caj1')).toBeUndefined(); // ya miembro: sin cambios
  });

  it('valida la entrada: correo inválido, rol fuera de la lista y campos extra', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    for (const d of [{ correo: 'no-es-correo', rol: 'caj' }, { correo: 'a@ejemplo.test', rol: 'dueno' }, { correo: 'a@ejemplo.test', rol: 'caj', uid: 'adm1' }, {}]) {
      await expect(m.llamar(c, 'invitarUsuario', d)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
  });

  it('límite de tasa: la sexta invitación del comercio en una hora se rechaza (y no antes)', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    for (let i = 0; i < 5; i++) await m.llamar(c, 'invitarUsuario', { correo: `lote${String(i)}@ejemplo.test`, rol: 'caj' }).catch(() => undefined);
    await expect(m.llamar(c, 'invitarUsuario', { correo: 'lote9@ejemplo.test', rol: 'caj' })).rejects.toMatchObject({ code: 'resource-exhausted', details: { codigo: 'limite-invitaciones' } });
    await expect(m.llamar(c, 'reenviarInvitacion', { uid: 'libre' })).rejects.toMatchObject({ code: 'resource-exhausted' }); // los reenvíos cuentan igual
  });

  it('cupo lleno: error del plan, sin invitación y sin dejar cuenta huérfana', async () => {
    const m = montaje({ usados: 3 });
    await expect(m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'nueva@ejemplo.test', rol: 'caj' })).rejects.toMatchObject({ name: 'LimiteDelPlan' });
    expect([...m.cuentas.values()].some((x) => x.email === 'nueva@ejemplo.test')).toBe(false);
    expect(m.registro).toEqual(['crear:43:false', 'borrar']);
  });
});

describe('anularInvitacion y cuentas caducadas', () => {
  it('anular libera el cupo y borra la cuenta SOLO si la creó la invitación y nunca inició sesión', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    await m.llamar(c, 'invitarUsuario', { correo: 'nueva@ejemplo.test', rol: 'caj' });
    await m.llamar(c, 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'caj' });
    expect(m.uso()).toBe(2);
    await m.llamar(c, 'anularInvitacion', { uid: 'nuevo1' });
    await m.llamar(c, 'anularInvitacion', { uid: 'libre' });
    expect(m.uso()).toBe(0);
    expect(m.cuentas.has('nuevo1')).toBe(false); // la creó la invitación
    expect(m.cuentas.has('libre')).toBe(true); // ya existía
  });

  it('no borra la cuenta si inició sesión, tiene otra membresía o tiene otra invitación', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    for (const [correo, estado] of [['a@ejemplo.test', 'sesion'], ['b@ejemplo.test', 'rol'], ['c@ejemplo.test', 'invitacion']] as const) {
      await m.llamar(c, 'invitarUsuario', { correo, rol: 'caj' });
      const cuenta = [...m.cuentas.values()].find((x) => x.email === correo);
      if (cuenta === undefined) throw new Error('no se creó');
      if (estado === 'sesion') cuenta.metadata = { creationTime: CREACION, lastSignInTime: 'Mon, 16 Nov 2026 16:00:00 GMT' };
      if (estado === 'rol') cuenta.customClaims = { pl: { t: { t2: 'caj' }, v: 1 } };
      if (estado === 'invitacion') m.db.poner(`tenants/t2/miembros/${cuenta.uid}`, { estado: 'invitado', uid: cuenta.uid, rolReservado: 'caj', invitadoPor: 'otro', invitadoEnMs: 1, venceEnMs: 99_999_999_999, cuentaCreada: false });
      await m.llamar(c, 'anularInvitacion', { uid: cuenta.uid });
      expect(m.cuentas.has(cuenta.uid), estado).toBe(true);
    }
    expect(m.registro.filter((x) => x === 'borrar')).toEqual([]);
  });

  it('una invitación vencida se barre al listar y su cuenta creada se borra; la de una cuenta existente se conserva', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    await m.llamar(c, 'invitarUsuario', { correo: 'nueva@ejemplo.test', rol: 'caj' });
    await m.llamar(c, 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'sup' });
    m.avanzar(8 * 24 * 60 * 60 * 1000);
    const r = (await m.llamar(c, 'listarUsuarios', {})) as { usuarios: { uid: string }[] };
    expect(r.usuarios.map((u) => u.uid)).toEqual(['adm1']);
    expect(m.cuentas.has('nuevo1')).toBe(false);
    expect(m.cuentas.has('libre')).toBe(true);
    expect(m.uso()).toBe(0);
  });

  it('solo el administrador anula o reenvía; una invitación que no existe da el mismo error', async () => {
    const m = montaje();
    await expect(m.llamar(m.como('sup1', 'sup'), 'anularInvitacion', { uid: 'libre' })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    await expect(m.llamar(m.como('adm1', 'adm'), 'anularInvitacion', { uid: 'nadie' })).rejects.toMatchObject({ codigo: 'no-miembro' });
    await expect(m.llamar(m.como('adm1', 'adm'), 'reenviarInvitacion', { uid: 'nadie' })).rejects.toMatchObject({ codigo: 'no-miembro' });
  });

  it('reenviar extiende 7 días el vencimiento', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    await m.llamar(c, 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'caj' });
    m.avanzar(3 * 24 * 60 * 60 * 1000);
    const r = (await m.llamar(c, 'reenviarInvitacion', { uid: 'libre' })) as { venceEnMs: number; mensaje: string };
    expect(r.mensaje).toBe('Invitación enviada');
    expect(r.venceEnMs).toBe(10_000_000 + 3 * 24 * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000);
  });
});

describe('listarUsuarios y buscarUsuarioPorCorreo', () => {
  it('el administrador ve las invitaciones con estado, rol reservado y vencimiento, sin datos de verificación', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    await m.llamar(c, 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'sup' });
    const r = (await m.llamar(c, 'listarUsuarios', {})) as { usuarios: Record<string, unknown>[] };
    expect(r.usuarios).toEqual([
      expect.objectContaining({ uid: 'adm1', rol: 'adm' }),
      { uid: 'libre', estado: 'invitado', rolReservado: 'sup', venceEnMs: 10_000_000 + 7 * 24 * 60 * 60 * 1000, correo: 'libre@ejemplo.test' },
    ]);
  });

  it('un supervisor no ve invitaciones', async () => {
    const m = montaje();
    await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'libre@ejemplo.test', rol: 'sup' });
    const r = (await m.llamar(m.como('sup1', 'sup'), 'listarUsuarios', {})) as { usuarios: { uid: string }[] };
    expect(r.usuarios.map((u) => u.uid)).toEqual(['adm1']);
  });

  it('buscarUsuarioPorCorreo no trata a un solo-invitado como miembro: no revela verificación ni contraseña', async () => {
    const m = montaje();
    await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'otro@ejemplo.test', rol: 'caj' }); // cuenta de otro comercio, invitada aquí
    await expect(m.llamar(m.como('adm1', 'adm'), 'buscarUsuarioPorCorreo', { correo: 'otro@ejemplo.test' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(m.llamar(m.como('adm1', 'adm'), 'buscarUsuarioPorCorreo', { correo: 'nadie@ejemplo.test' })).rejects.toMatchObject({ code: 'not-found' });
    // Un miembro activo sí se encuentra.
    expect(await m.llamar(m.como('adm1', 'adm'), 'buscarUsuarioPorCorreo', { correo: 'caj1@ejemplo.test' })).toMatchObject({ uid: 'caj1' });
  });
});

type Pedido = Parameters<ReturnType<typeof manejadorActivarInvitaciones>>[0];

describe('activarInvitaciones (callable sin tenant ni rol)', () => {
  const pedido = (token: string | undefined, conApp = true, cuerpo: unknown = {}): Pedido =>
    ({ data: cuerpo, app: conApp ? {} : undefined, rawRequest: { headers: token === undefined ? {} : { authorization: `Bearer ${token}` } } }) as unknown as Pedido;
  const manejador = (m: ReturnType<typeof montaje>, appCheck = true) => manejadorActivarInvitaciones({ entorno: () => m.e, appCheckExigido: () => appCheck });

  async function conInvitacion() {
    const m = montaje();
    await m.llamar(m.como('adm1', 'adm'), 'invitarUsuario', { correo: 'nueva@ejemplo.test', rol: 'sup' });
    const cuenta = m.cuentas.get('nuevo1');
    if (cuenta === undefined) throw new Error('sin cuenta');
    return { m, cuenta };
  }

  it('con el correo verificado activa el rol reservado; el uid sale del token, no del cuerpo', async () => {
    const { m, cuenta } = await conInvitacion();
    cuenta.emailVerified = true; // la persona fijó su contraseña con el enlace
    const r = await manejador(m)(pedido('nuevo1', true, { uid: 'adm1', tenantId: 't2' }));
    expect(r).toEqual({ activadas: 1, sinEfecto: 0, fallidas: 0 });
    expect(m.db.dato('tenants/t1/miembros/nuevo1')).toMatchObject({ rol: 'sup', estado: 'activo' });
    expect(cuenta.customClaims).toMatchObject({ pl: { t: { t1: 'sup' } } });
    expect(await manejador(m)(pedido('nuevo1'))).toEqual({ activadas: 0, sinEfecto: 0, fallidas: 0 }); // idempotente
  });

  it('correo sin verificar: error tipado correo-no-verificado y no se activa nada', async () => {
    const { m } = await conInvitacion();
    await expect(manejador(m)(pedido('nuevo1'))).rejects.toMatchObject({ code: 'failed-precondition', details: { codigo: 'correo-no-verificado' } });
    expect(m.db.dato('tenants/t1/miembros/nuevo1')).toMatchObject({ estado: 'invitado' });
  });

  it('exige App Check, token válido y proveedor de contraseña', async () => {
    const { m, cuenta } = await conInvitacion();
    cuenta.emailVerified = true;
    await expect(manejador(m)(pedido('nuevo1', false))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(manejador(m)(pedido(undefined))).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(manejador(m)(pedido('desconocido'))).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(m.db.dato('tenants/t1/miembros/nuevo1')).toMatchObject({ estado: 'invitado' });
    await expect(manejador(m, false)(pedido('nuevo1', false))).resolves.toMatchObject({ activadas: 1 }); // sin exigencia (desarrollo)
  });

  it('límite de tasa propio por persona: la 11.ª activación en una hora se rechaza', async () => {
    const { m } = await conInvitacion();
    (m.e as unknown as { limiteActivaciones: unknown }).limiteActivaciones = limiteMemoria(10, 3_600_000);
    for (let i = 0; i < 10; i++) await manejador(m)(pedido('nuevo1')).catch(() => undefined);
    await expect(manejador(m)(pedido('nuevo1'))).rejects.toMatchObject({ code: 'resource-exhausted', details: { codigo: 'limite-activaciones' } });
  });
});

describe('borrado de cuentas de invitación (carreras)', () => {
  it('si entre la primera lectura y el borrado llega otra invitación, no se borra', async () => {
    const m = montaje();
    const c = m.como('adm1', 'adm');
    await m.llamar(c, 'invitarUsuario', { correo: 'nueva@ejemplo.test', rol: 'caj' });
    const indice = (m.e as unknown as { indiceInvitaciones: { tenantsDe(uid: string): Promise<string[]> } }).indiceInvitaciones;
    const original = indice.tenantsDe.bind(indice);
    let lecturas = 0;
    indice.tenantsDe = async (uid) => {
      const r = await original(uid);
      lecturas += 1;
      if (lecturas === 1) m.db.poner(`tenants/t2/miembros/${uid}`, { estado: 'invitado', uid, rolReservado: 'caj', invitadoPor: 'otro', invitadoEnMs: 1, venceEnMs: 99_999_999_999, cuentaCreada: false });
      return r;
    };
    await m.llamar(c, 'anularInvitacion', { uid: 'nuevo1' });
    expect(m.cuentas.has('nuevo1')).toBe(true);
    expect(lecturas).toBe(2); // volvió a leer justo antes de borrar
  });
});
