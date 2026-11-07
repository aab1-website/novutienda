// L2-6, sin emulador: el marco de los callables rechaza las acciones de un módulo apagado para el tenant, falla cerrado
// con tenant inexistente y deja pasar las de Central. Se usa `crearEntorno` con un Firestore mínimo en memoria.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { registroPlataforma } from '../../plataforma/registro.js';
import { crearLectorModulos, TTL_MODULOS_MS } from '../../plataforma/coordinador/modulos-activos.js';
import { crearEntorno } from '../../plataforma/funciones/servidor/entorno.js';
import { crearManejador, accion, type TablaAcciones } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { moduloEncendido, porTenant } from '../../plataforma/funciones/servidor/programadas/tenants.js';
import { accion as llamar, crearUsuario, hayEmulador, herramientas, sembrarTenant, TENANT_TODO_ENCENDIDO, type Herramientas } from './ayudas.js';
import { VACIO } from '../../plataforma/funciones/servidor/llamadas/comunes.js';
import { tablasCompuestas } from './tablas.js';

const T = 'tienda-uno';
const mod = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { version: '0.1.0', submodulos: [] }]));
const tenantCon = (...ids: string[]) => ({ ...TENANT_TODO_ENCENDIDO, modulos: mod(...ids) });

/** Firestore mínimo: documentos en memoria y contador de lecturas. */
function firestoreFalso(docs: Record<string, unknown>) {
  const lecturas = { n: 0 };
  const f = {
    doc: (ruta: string) => ({
      get: async () => {
        lecturas.n += 1;
        return { exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] };
      },
    }),
    collection: () => ({ listDocuments: async () => [] }),
  };
  return { f, lecturas, docs };
}

function entornoCon(docs: Record<string, unknown>, ahora: () => number = () => 1_000) {
  const { f, lecturas } = firestoreFalso(docs);
  const claim = construirClaim({ [T]: 'adm', otro: 'adm' }, 1, false);
  if (!claim.ok) throw new Error(claim.error);
  const claims = { uid: 'u1', email_verified: true, firebase: { sign_in_provider: 'password' }, ...claim.valor };
  const auth = { verifyIdToken: async () => claims };
  const e = crearEntorno({ firestore: f as never, auth: auth as never, bucket: {} as never, ahora, env: {} });
  return { e, lecturas };
}

const peticion = (accionNombre: string, tenantId = T): Parameters<ReturnType<typeof crearManejador>>[0] =>
  ({ data: { accion: accionNombre, tenantId, datos: {} }, rawRequest: { headers: { authorization: 'Bearer x' } }, app: {} }) as never;

async function codigoDe(p: Promise<unknown>): Promise<{ code: string; codigo: unknown } | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (error) {
    const h = error as { code?: unknown; details?: { codigo?: unknown } };
    if (typeof h.code !== 'string') throw error; // no es un HttpsError
    return { code: h.code, codigo: h.details?.codigo };
  }
}

const APAGADO = { code: 'permission-denied', codigo: 'modulo-apagado' };

/** Acción de prueba por módulo dueño, con los mismos campos que arma `tablaDeCallable`. */
const tablaDe = (modulo: string, requiereEncendido: boolean): TablaAcciones => ({
  hacer: { ...accion({ esquema: VACIO, ejecutar: async () => ({ hecho: true }) }), roles: ['adm'], propietario: false, modulo, requiereEncendido },
});
const manejar = (e: ReturnType<typeof entornoCon>['e'], t: TablaAcciones) =>
  crearManejador({ modulo: 'x', acciones: t, entorno: () => e, appCheckExigido: () => true });

describe('encendido por tenant en el marco de los callables', () => {
  it('módulo apagado → permission-denied con codigo modulo-apagado; encendido → ejecuta', async () => {
    const apagado = entornoCon({ [`tenants/${T}`]: tenantCon('inventarios') });
    expect(await codigoDe(manejar(apagado.e, tablaDe('pos', true))(peticion('hacer')))).toEqual(APAGADO);
    const encendido = entornoCon({ [`tenants/${T}`]: tenantCon('inventarios', 'recibos', 'pos') });
    expect(await manejar(encendido.e, tablaDe('pos', true))(peticion('hacer'))).toEqual({ hecho: true });
  });

  it('pos sin recibos (dependencia apagada) → módulo pos rechazado', async () => {
    expect(registroPlataforma.listar().find((m) => m.id === 'pos')?.dependeDe).toContain('recibos');
    const sinRecibos = entornoCon({ [`tenants/${T}`]: tenantCon('inventarios', 'pos') });
    expect(await sinRecibos.e.modulosDelTenant(T)).toEqual(['inventarios']);
    expect(await codigoDe(manejar(sinRecibos.e, tablaDe('pos', true))(peticion('hacer')))).toEqual(APAGADO);
    const tenantSinInventarios = entornoCon({ [`tenants/${T}`]: tenantCon('pos') });
    expect(await tenantSinInventarios.e.modulosDelTenant(T)).not.toContain('pos');
    expect(await codigoDe(manejar(tenantSinInventarios.e, tablaDe('pos', true))(peticion('hacer')))).toEqual(APAGADO);
  });

  it('con todo apagado, las acciones reales de módulo se rechazan y las de Central pasan el control de módulo', async () => {
    const { e } = entornoCon({ [`tenants/${T}`]: tenantCon() });
    for (const [callable, tabla] of Object.entries(tablasCompuestas())) {
      const m = manejar(e, tabla);
      for (const [nombre, def] of Object.entries(tabla)) {
        const r = await codigoDe(m(peticion(nombre)));
        if (def.requiereEncendido) expect(r, `${callable}.${nombre}`).toEqual(APAGADO);
        else expect(r, `${callable}.${nombre}`).not.toEqual(APAGADO);
      }
    }
  });

  it('solo las acciones de módulos encendibles dependen del encendido; Central y núcleo no', () => {
    const tablas = tablasCompuestas();
    const gated = Object.values(tablas).flatMap((t) => Object.values(t)).filter((a) => a.requiereEncendido).map((a) => a.modulo);
    expect([...new Set(gated)].sort()).toEqual(['consola', 'inventarios', 'pos', 'recibos'].filter((id) => gated.includes(id)).sort());
    for (const d of ['listarUsuarios', 'buscarUsuarioPorCorreo', 'asignarRol', 'quitarRol', 'modulosActivos']) expect(tablas['consola']?.[d]?.requiereEncendido, d).toBe(false);
    for (const a of Object.values(tablas).flatMap((t) => Object.values(t))) {
      if (['nucleo', 'panel', 'plataforma'].includes(a.modulo)) expect(a.requiereEncendido).toBe(false);
    }
  });

  it('modulosActivos devuelve los efectivos y funciona con todo apagado', async () => {
    const m = (e: ReturnType<typeof entornoCon>['e']) => manejar(e, { modulosActivos: tablasCompuestas()['consola']?.['modulosActivos'] as never });
    expect(await m(entornoCon({ [`tenants/${T}`]: tenantCon() }).e)(peticion('modulosActivos'))).toEqual({ modulos: [] });
    expect(await m(entornoCon({ [`tenants/${T}`]: tenantCon('inventarios', 'recibos', 'pos') }).e)(peticion('modulosActivos'))).toEqual({ modulos: ['inventarios', 'recibos', 'pos'] });
  });

  it('tenant sin documento o con documento inválido → se rechaza (falla cerrado), también en Central', async () => {
    const sin = entornoCon({});
    expect(await codigoDe(manejar(sin.e, tablaDe('pos', true))(peticion('hacer')))).toEqual(APAGADO);
    const modulosActivos = tablasCompuestas()['consola']?.['modulosActivos'] as never;
    expect(await codigoDe(manejar(sin.e, { modulosActivos })(peticion('modulosActivos')))).toEqual(APAGADO);
    const roto = entornoCon({ [`tenants/${T}`]: { plan: 'base' } });
    expect(await codigoDe(manejar(roto.e, tablaDe('pos', true))(peticion('hacer')))).toEqual(APAGADO);
  });

  it('el rol sigue mandando: otro tenant sin rol no llega a leer módulos', async () => {
    const { e, lecturas } = entornoCon({ [`tenants/ajeno`]: tenantCon('pos') });
    const r = await codigoDe(manejar(e, tablaDe('pos', true))(peticion('hacer', 'ajeno')));
    expect(r).toEqual({ code: 'permission-denied', codigo: 'acceso-denegado' });
    expect(lecturas.n).toBe(0);
  });
});

describe('lector de módulos del tenant: cache de 60 s', () => {
  it('lee una vez por ventana, relee al vencer y no cachea los rechazos', async () => {
    let t = 0;
    const docs: Record<string, unknown> = { [`tenants/${T}`]: tenantCon('inventarios', 'recibos', 'pos') };
    const { f, lecturas } = firestoreFalso(docs);
    const leer = crearLectorModulos(f, () => t);
    expect(await leer(T)).toEqual(['inventarios', 'recibos', 'pos']);
    docs[`tenants/${T}`] = tenantCon('inventarios');
    t = TTL_MODULOS_MS - 1;
    expect(await leer(T)).toEqual(['inventarios', 'recibos', 'pos']);
    expect(lecturas.n).toBe(1);
    t = TTL_MODULOS_MS;
    expect(await leer(T)).toEqual(['inventarios']);
    expect(lecturas.n).toBe(2);
    expect(await leer('nuevo')).toBeUndefined();
    docs['tenants/nuevo'] = tenantCon('inventarios');
    expect(await leer('nuevo')).toEqual(['inventarios']);
    expect(await leer('../x')).toBeUndefined();
  });
  it('si la lectura de tenants/{t} lanza, el error se propaga, no se cachea y nada se ejecuta', async () => {
    let falla = true;
    const f = {
      doc: () => ({
        get: async () => {
          if (falla) throw new Error('lectura caída');
          return { exists: true, data: () => tenantCon('inventarios') };
        },
      }),
    };
    const leer = crearLectorModulos(f, () => 0);
    await expect(leer(T)).rejects.toThrow('lectura caída');
    falla = false;
    expect(await leer(T)).toEqual(['inventarios']); // el fallo no dejó nada en la caché
  });

  it('con la lectura caída el marco rechaza y la acción no se ejecuta', async () => {
    const ejecutar = vi.fn(async () => ({ hecho: true }));
    const { e } = entornoCon({});
    const caido = { ...e, modulosDelTenant: async () => { throw new Error('lectura caída'); } } as typeof e;
    const tabla: TablaAcciones = {
      hacer: { ...accion({ esquema: VACIO, ejecutar }), roles: ['adm'], propietario: false, modulo: 'pos', requiereEncendido: true },
    };
    await expect(manejar(caido, tabla)(peticion('hacer'))).rejects.toBeDefined();
    expect(ejecutar).not.toHaveBeenCalled();
  });
});

describe('programadas: porTenant con módulo', () => {
  it('salta los tenants con el módulo apagado', async () => {
    const docs: Record<string, unknown> = { 'tenants/a': tenantCon('consola', 'inventarios'), 'tenants/b': tenantCon('inventarios') };
    const { f } = firestoreFalso(docs);
    const fs = { ...f, collection: () => ({ listDocuments: async () => ['a', 'b'].map((id) => ({ id })) }), getAll: async (...refs: { id: string }[]) => refs.filter((r) => typeof r.id === 'string').map((r) => ({ id: r.id, exists: true })) };
    const e = crearEntorno({ firestore: fs as never, auth: {} as never, bucket: {} as never, ahora: () => 1, env: {} });
    expect(await moduloEncendido(e, 'a', 'consola')).toBe(true);
    expect(await moduloEncendido(e, 'b', 'consola')).toBe(false);
    expect(await moduloEncendido(e, 'zz', 'consola')).toBe(false);
    expect(await porTenant(e, 'prueba', async (t) => t.toUpperCase(), { modulo: 'consola' })).toEqual({ a: 'A' });
    expect(await porTenant(e, 'prueba', async (t) => t.toUpperCase())).toEqual({ a: 'A', b: 'B' });
  });
});

// Con emulador: el callable real (Functions) rechaza por módulo apagado. Un tenant por caso: el lector guarda 60 s por instancia.
describe.skipIf(!hayEmulador)('encendido por tenant (emulador)', () => {
  vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
  const todo = 'enc-todo';
  const sinPos = 'enc-sinpos';
  const nada = 'enc-nada';
  let h: Herramientas;
  const uno = (t: string) => crearUsuario(h, { rol: 'adm', tenant: t });

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, todo);
    await sembrarTenant(h, sinPos);
    await h.firestore.doc(`tenants/${sinPos}`).set({ ...TENANT_TODO_ENCENDIDO, modulos: mod('inventarios', 'recibos', 'consola') });
    await h.firestore.doc(`tenants/${nada}`).set({ ...TENANT_TODO_ENCENDIDO, modulos: {} });
  });

  it('pos apagado → 403 con codigo modulo-apagado; con pos encendido la misma acción responde', async () => {
    const u = await uno(sinPos);
    const r = await llamar('pos', 'cotizaciones', {}, u.token, sinPos);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.error)).toContain('modulo-apagado');
    const ok = await llamar('pos', 'cotizaciones', {}, (await uno(todo)).token, todo);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });

  it('con todo apagado, modulosActivos y usuarios (Central) responden; un módulo se rechaza', async () => {
    const u = await uno(nada);
    const m = await llamar('consola', 'modulosActivos', {}, u.token, nada);
    expect(m.status, JSON.stringify(m.error)).toBe(200);
    expect(m.resultado).toEqual({ modulos: [] });
    expect((await llamar('consola', 'listarUsuarios', {}, u.token, nada)).status).toBe(200);
    expect((await llamar('inventarios', 'series', { productoId: 'x' }, u.token, nada)).status).toBe(403);
    const con = await llamar('consola', 'modulosActivos', {}, (await uno(sinPos)).token, sinPos);
    expect(con.resultado).toEqual({ modulos: ['inventarios', 'recibos', 'consola'] });
  });

  it('tenant sin documento → rechazo', async () => {
    const t = 'enc-fantasma';
    const admFantasma = await crearUsuario(h, { rol: 'adm', tenant: t });
    expect((await llamar('consola', 'modulosActivos', {}, admFantasma.token, t)).status).toBe(403);
  });
});
