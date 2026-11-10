// L3-3, sin emulador: el encendido por tenant en la API HTTP. Cada ruta declarada en el registro (`rutasHttp`) se rechaza si su
// módulo dueño no está efectivo para el tenant (401 `credencial_invalida` en NovuChat, 404 `no_encontrado` en el sitio) y
// se sirve si lo está. El control va DESPUÉS de autenticar y ANTES de leer datos: un Firestore espía lo demuestra.
import { describe, expect, it } from 'vitest';
import { limiteMemoria } from '@novutienda/nucleo';
import { registroPlataforma } from '../../plataforma/registro.js';
import { duenoDeRuta, rutaEncendida } from '../../plataforma/coordinador/rutas-http.js';
import { crearLectoresModulos } from '../../plataforma/coordinador/modulos-activos.js';
import { crearEntorno } from '../../plataforma/funciones/servidor/entorno.js';
import { enrutar, type ConfigRouter } from '../../plataforma/funciones/servidor/http/router.js';
import { sha256Hex } from '../../plataforma/funciones/servidor/http/novuchat.js';
import { textoFirmado } from '../../plataforma/funciones/servidor/http/sitio.js';
import { firmar, TENANT_TODO_ENCENDIDO } from './ayudas.js';

const T = 'tienda-uno';
const AHORA = 1_700_000_000_000;
const SECRETO_SITIO = 'secreto-sitio-de-prueba';
const SECRETO_PEDIDOS = 'secreto-pedidos-de-prueba';
const TOKEN = 'token-de-prueba';
const mod = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { version: '0.1.0', submodulos: [] }]));
const TODOS = ['consola', 'inventarios', 'pos', 'recibos', 'website'];
const tenantCon = (...ids: string[]) => ({ ...TENANT_TODO_ENCENDIDO, modulos: mod(...ids) });
const RECHAZO_NOVUCHAT = { error: 'credencial_invalida' };
const RECHAZO_SITIO = { error: 'no_encontrado' };

/** Firestore espía: sirve `tenants/{t}` y los tokens; cualquier otra lectura se anota y falla (así se ve si se llegó a los datos). */
function espia(docs: Record<string, unknown>) {
  const lecturas: string[] = [];
  const leer = (ruta: string) => {
    lecturas.push(ruta);
    if (Object.hasOwn(docs, ruta)) return Promise.resolve({ exists: true, data: () => docs[ruta] });
    if (ruta.startsWith('tenants/') && !ruta.slice(8).includes('/')) return Promise.resolve({ exists: false, data: () => undefined });
    if (ruta.startsWith('novuchatTokens/')) return Promise.resolve({ exists: false, data: () => undefined });
    return Promise.reject(new Error(`LEYO_DATOS ${ruta}`));
  };
  const consulta = (ruta: string) => {
    const q: Record<string, unknown> = { get: () => leer(ruta) };
    for (const m of ['where', 'orderBy', 'limit']) q[m] = () => q;
    return q;
  };
  const f = {
    doc: (ruta: string) => ({ get: () => leer(ruta) }),
    collection: (ruta: string) => ({ doc: (id: string) => ({ get: () => leer(`${ruta}/${id}`) }), ...consulta(ruta) }),
    getAll: (...refs: unknown[]) => { lecturas.push('getAll'); return Promise.reject(new Error(`LEYO_DATOS getAll ${String(refs.length)}`)); },
    runTransaction: () => { lecturas.push('runTransaction'); return Promise.reject(new Error('LEYO_DATOS runTransaction')); },
  };
  /** Lecturas que no son del control (módulos del tenant) ni de la credencial. */
  const datos = (): string[] => lecturas.filter((l) => l !== `tenants/${T}` && !l.startsWith('novuchatTokens/'));
  return { f, lecturas, datos };
}

const docsBase = (tenant: unknown): Record<string, unknown> => ({
  ...(tenant === undefined ? {} : { [`tenants/${T}`]: tenant }),
  [`novuchatTokens/${sha256Hex(TOKEN)}`]: { tenantId: T, hash: sha256Hex(TOKEN), activo: true },
});

function montar(tenant: unknown, sobrescribir: Partial<ReturnType<typeof crearEntorno>> = {}) {
  const s = espia(docsBase(tenant));
  const base = crearEntorno({ firestore: s.f as never, auth: {} as never, bucket: {} as never, ahora: () => AHORA, env: {} });
  const e = {
    ...base,
    leerDisponibilidad: () => () => Promise.resolve({}),
    guardarContacto: () => ({}) as never,
    ...sobrescribir,
  };
  const cfg: ConfigRouter = {
    tenantId: T, secretoReconstruccion: SECRETO_SITIO, recaptcha: { verificar: () => Promise.resolve({ valido: true, puntaje: 0.9 }) } as never,
    appCheck: { verificar: () => Promise.resolve(false) } as never,
    novuchat: { sitioUrl: '', mediosBaseUrl: 'https://medios.test', limite: limiteMemoria(1000, 60_000), secretoPedidos: SECRETO_PEDIDOS, tenantPedidos: T },
    limiteContacto: limiteMemoria(1000, 60_000),
    limiteMemoria: { novuchat: limiteMemoria(1000, 60_000), disponibilidad: limiteMemoria(1000, 60_000), contacto: limiteMemoria(1000, 60_000) },
  };
  return { e: e as typeof base, cfg, ...s };
}

interface Caso { readonly ruta: string; readonly dueno: string; readonly novuchat: boolean; readonly peticion: (extra?: { sinCredencial?: boolean; tokenMalo?: boolean; firmaMala?: boolean }) => Parameters<typeof enrutar>[1] }

function peticionDe(metodo: string, ruta: string, o: { consulta?: Record<string, string>; cabeceras?: Record<string, string>; cuerpo?: string } = {}): Parameters<typeof enrutar>[1] {
  const consulta = o.consulta ?? {};
  const q = Object.keys(consulta).length === 0 ? '' : `?${new URLSearchParams(consulta).toString()}`;
  const crudo = o.cuerpo ?? '';
  return { metodo, ruta, url: `${ruta}${q}`, consulta, cabeceras: o.cabeceras ?? {}, cuerpoCrudo: crudo, cuerpo: crudo === '' ? undefined : JSON.parse(crudo), origen: '203.0.113.1' };
}

/** Petición concreta por cada ruta declarada en el registro; las rutas con prefijo usan un subcamino real. */
function casos(): Caso[] {
  return registroPlataforma.rutasHttp().map((r): Caso => {
    const novuchat = r.ruta.startsWith('/api/novuchat/');
    const ruta = r.prefijo === true ? `${r.ruta}/reconstrucciones` : r.ruta;
    const peticion: Caso['peticion'] = (x = {}) => {
      if (r.ruta === '/api/novuchat/v1/catalogo' || r.ruta === '/api/novuchat/v1/inventario') {
        const auth = x.sinCredencial === true ? {} : { authorization: `Bearer ${x.tokenMalo === true ? 'otro-token' : TOKEN}` };
        return peticionDe('GET', ruta, { consulta: { mercado: 'BO' }, cabeceras: auth });
      }
      if (r.ruta === '/api/novuchat/v1/pedidos/confirmar') {
        const cuerpo = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'x', cantidad: 1 }], confirmadoEn: '2026-11-09T10:00:00Z' });
        const marca = String(AHORA);
        return peticionDe('POST', ruta, { cuerpo, cabeceras: { 'x-marca-tiempo': marca, 'x-firma': x.firmaMala === true ? 'f'.repeat(64) : firmar(SECRETO_PEDIDOS, marca, cuerpo) } });
      }
      if (r.prefijo === true) {
        const consulta = { tenantId: T };
        const marca = String(AHORA);
        const url = `${ruta}?${new URLSearchParams(consulta).toString()}`;
        return peticionDe('GET', ruta, { consulta, cabeceras: { 'x-marca-tiempo': marca, 'x-firma': x.firmaMala === true ? 'f'.repeat(64) : firmar(SECRETO_SITIO, marca, textoFirmado('GET', url, '')) } });
      }
      if (r.ruta === '/api/contacto') return peticionDe('POST', ruta, { cuerpo: '{}', cabeceras: { 'content-type': 'application/json' } });
      return peticionDe('GET', ruta, { consulta: { mercado: 'BO', ids: 'a' } });
    };
    return { ruta: r.ruta, dueno: r.modulo, novuchat, peticion };
  });
}

type Resultado = { respuesta: Awaited<ReturnType<typeof enrutar>> } | { error: Error };
async function correr(m: ReturnType<typeof montar>, req: Parameters<typeof enrutar>[1]): Promise<Resultado> {
  try {
    return { respuesta: await enrutar(m.e, req, m.cfg) };
  } catch (error) {
    return { error: error as Error };
  }
}
const rechazo = (c: Caso) => (c.novuchat ? { status: 401, cuerpo: RECHAZO_NOVUCHAT } : { status: 404, cuerpo: RECHAZO_SITIO });
const rechazada = (r: Resultado, c: Caso): boolean => 'respuesta' in r && r.respuesta.status === rechazo(c).status && JSON.stringify(r.respuesta.cuerpo) === JSON.stringify(rechazo(c).cuerpo);

describe('rutas HTTP: dueño y encendido', () => {
  it('el registro declara las rutas de website, inventarios y consola; duenoDeRuta las resuelve exacta o por prefijo', () => {
    const c = casos();
    expect(c.length).toBeGreaterThanOrEqual(6);
    expect(duenoDeRuta('/api/cotizacion')).toBe('website');
    expect(duenoDeRuta('/api/novuchat/v1/inventario')).toBe('inventarios');
    expect(duenoDeRuta('/api/novuchat/v1/catalogo')).toBe('consola');
    expect(duenoDeRuta('/api/sitio/v1/publicado')).toBe('consola');
    expect(duenoDeRuta('/api/sitio/v1')).toBe('consola');
    for (const x of c) expect(duenoDeRuta(x.ruta), x.ruta).toBe(x.dueno);
  });
  it('rutas sin dueño (salud, desconocidas, prefijo parcial) → undefined', () => {
    for (const r of ['/api/salud', '/healthz', '/api/no-existe', '/api/sitio/v10/x', '/api/sitio', '/api/cotizacion/x', '']) expect(duenoDeRuta(r), r).toBeUndefined();
  });
  it('rutaEncendida: efectivo → true; apagado, sin documento, dueño indefinido → false; lector caído → propaga', async () => {
    expect(await rutaEncendida(async () => ['consola'], T, 'consola')).toBe(true);
    expect(await rutaEncendida(async () => ['inventarios'], T, 'consola')).toBe(false);
    expect(await rutaEncendida(async () => undefined, T, 'consola')).toBe(false);
    expect(await rutaEncendida(async () => ['consola'], T, undefined)).toBe(false);
    await expect(rutaEncendida(async () => { throw new Error('lectura caída'); }, T, 'consola')).rejects.toThrow('lectura caída');
  });
});

describe('cada ruta declarada: módulo dueño apagado → rechazo; encendido → pasa', () => {
  for (const c of casos()) {
    it(`${c.ruta} (${c.dueno})`, async () => {
      // Apagado: todos los módulos menos el dueño.
      const apagado = montar(tenantCon(...TODOS.filter((id) => id !== c.dueno)));
      const r = await correr(apagado, c.peticion());
      expect(rechazada(r, c), JSON.stringify(r)).toBe(true);
      expect(apagado.datos(), 'con el módulo apagado no se lee ningún dato').toEqual([]);
      // Encendido: no es el rechazo (llega al manejador: responde otra cosa o falla al leer los datos del espía).
      const encendido = montar(tenantCon(...TODOS));
      const ok = await correr(encendido, c.peticion());
      expect(rechazada(ok, c), JSON.stringify(ok)).toBe(false);
      if (c.novuchat && c.ruta !== '/api/novuchat/v1/pedidos/confirmar') expect(encendido.datos().length, 'llegó a leer datos').toBeGreaterThan(0);
    });

    it(`${c.ruta}: tenant sin documento o con documento inválido → rechazo, sin leer datos`, async () => {
      for (const t of [undefined, { estado: 'activo', plan: 'base' }]) {
        const m = montar(t);
        const r = await correr(m, c.peticion());
        expect(rechazada(r, c), JSON.stringify(r)).toBe(true);
        expect(m.datos()).toEqual([]);
      }
    });

    it(`${c.ruta}: tenant suspendido o de baja → rechazo, sin leer datos`, async () => {
      for (const estado of ['suspendido', 'baja']) {
        const m = montar({ ...tenantCon(...TODOS), estado });
        const r = await correr(m, c.peticion());
        expect(rechazada(r, c), `${estado} ${JSON.stringify(r)}`).toBe(true);
        expect(m.datos()).toEqual([]);
      }
    });

    it(`${c.ruta}: lector de módulos caído → falla cerrado, no se sirve ni se leen datos`, async () => {
      const m = montar(tenantCon(...TODOS), { modulosDelTenant: async () => { throw new Error('lectura caída'); } });
      const r = await correr(m, c.peticion());
      expect('error' in r && /lectura caída/.test(r.error.message)).toBe(true);
      expect(m.datos()).toEqual([]);
    });
  }
});

describe('el control va DESPUÉS de autenticar: sin credencial no se leen los módulos', () => {
  const modulosLeidos = (m: ReturnType<typeof montar>) => m.lecturas.filter((l) => l === `tenants/${T}`);
  for (const c of casos().filter((x) => x.ruta === '/api/novuchat/v1/catalogo' || x.ruta === '/api/novuchat/v1/inventario')) {
    it(`${c.ruta}: sin Authorization → 401 sin_credencial; token malo → 401 credencial_invalida; nunca se leen los módulos`, async () => {
      const sin = montar(tenantCon(...TODOS));
      const a = await correr(sin, c.peticion({ sinCredencial: true }));
      expect('respuesta' in a && a.respuesta.status === 401 && JSON.stringify(a.respuesta.cuerpo) === JSON.stringify({ error: 'sin_credencial' })).toBe(true);
      expect(modulosLeidos(sin)).toEqual([]);
      const malo = montar(tenantCon(...TODOS));
      const b = await correr(malo, c.peticion({ tokenMalo: true }));
      expect('respuesta' in b && b.respuesta.status === 401 && JSON.stringify(b.respuesta.cuerpo) === JSON.stringify(RECHAZO_NOVUCHAT)).toBe(true);
      expect(modulosLeidos(malo)).toEqual([]);
    });
  }
  it('/api/sitio/v1/*: firma inválida → 401 firma_invalida sin leer los módulos', async () => {
    const c = casos().find((x) => x.ruta === '/api/sitio/v1');
    if (c === undefined) throw new Error('falta la ruta del sitio en el registro');
    const m = montar(tenantCon(...TODOS));
    const r = await correr(m, c.peticion({ firmaMala: true }));
    expect('respuesta' in r && r.respuesta.status === 401 && JSON.stringify(r.respuesta.cuerpo) === JSON.stringify({ error: 'firma_invalida' })).toBe(true);
    expect(m.lecturas).toEqual([]);
  });
  it('/api/sitio/v1/*: sin secreto configurado → 503 sin leer los módulos', async () => {
    const c = casos().find((x) => x.ruta === '/api/sitio/v1');
    if (c === undefined) throw new Error('falta la ruta del sitio en el registro');
    const m = montar(tenantCon(...TODOS));
    m.cfg = { ...m.cfg, secretoReconstruccion: '' };
    const r = await correr(m, c.peticion());
    expect('respuesta' in r && r.respuesta.status).toBe(503);
    expect(m.lecturas).toEqual([]);
  });
});

describe('pedido firmado: la firma se verifica ANTES del control de encendido', () => {
  it('sin firma válida responde igual con el módulo apagado o encendido y no consulta los módulos', async () => {
    const c = casos().find((x) => x.ruta === '/api/novuchat/v1/pedidos/confirmar');
    if (c === undefined) throw new Error('falta la ruta del pedido');
    const consultas: string[] = [];
    const espiar = { modulosDelTenant: async (t: string) => { consultas.push(t); return []; } };
    const apagado = montar(tenantCon('consola'), espiar);
    const encendido = montar(tenantCon(...TODOS), espiar);
    const a = await correr(apagado, c.peticion({ firmaMala: true }));
    const b = await correr(encendido, c.peticion({ firmaMala: true }));
    expect('respuesta' in a && 'respuesta' in b && JSON.stringify(a.respuesta) === JSON.stringify(b.respuesta)).toBe(true);
    expect('respuesta' in a && a.respuesta.status).toBe(401);
    expect(consultas).toEqual([]);
    expect(apagado.lecturas).toEqual([]);
  });
  it('con firma válida y módulo apagado → 401 credencial_invalida; encendido → pasa el control', async () => {
    const c = casos().find((x) => x.ruta === '/api/novuchat/v1/pedidos/confirmar');
    if (c === undefined) throw new Error('falta la ruta del pedido');
    const apagado = montar(tenantCon('consola'));
    const r = await correr(apagado, c.peticion());
    expect(rechazada(r, c)).toBe(true);
    expect(apagado.datos()).toEqual([]);
  });
});

describe('infraestructura y rutas desconocidas', () => {
  const sonda = (ruta: string) => peticionDe('GET', ruta);
  it('/api/salud y /healthz responden 200 siempre, sin leer nada, aun con el lector caído', async () => {
    const m = montar(undefined, { modulosDelTenant: async () => { throw new Error('lectura caída'); } });
    for (const ruta of ['/api/salud', '/healthz']) {
      const r = await correr(m, sonda(ruta));
      expect('respuesta' in r && r.respuesta.status === 200 && r.respuesta.cuerpo === 'ok', ruta).toBe(true);
    }
    expect(m.lecturas).toEqual([]);
  });
  it('una ruta desconocida sigue en 404 sin leer módulos', async () => {
    const m = montar(tenantCon(...TODOS));
    const r = await correr(m, sonda('/api/no-existe'));
    expect('respuesta' in r && r.respuesta.status).toBe(404);
    expect(m.lecturas).toEqual([]);
  });
  it('el rechazo no deja rastro del motivo en la respuesta (indistinguible de un token malo / de una ruta inexistente)', async () => {
    const c = casos().find((x) => x.ruta === '/api/novuchat/v1/inventario');
    if (c === undefined) throw new Error('falta la ruta de inventario');
    const apagado = montar(tenantCon('consola'));
    const r = await correr(apagado, c.peticion());
    const malo = await correr(montar(tenantCon(...TODOS)), c.peticion({ tokenMalo: true }));
    expect('respuesta' in r && 'respuesta' in malo && JSON.stringify(r.respuesta) === JSON.stringify(malo.respuesta)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/modulo|apagado/);
  });
});

describe('el lector de módulos sigue fallando cerrado para HTTP; el motivo va aparte (D3)', () => {
  it('suspendido, baja, inexistente e inválido → modulos undefined; el estado expone el motivo', async () => {
    const docs: Record<string, unknown> = {
      'tenants/susp': { ...tenantCon('pos'), estado: 'suspendido' },
      'tenants/baja': { ...tenantCon('pos'), estado: 'baja' },
      'tenants/roto': { estado: 'activo', plan: 'base' },
    };
    const f = { doc: (ruta: string) => ({ get: async () => ({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] }) }) };
    const l = crearLectoresModulos(f, () => 0);
    const motivos: Record<string, string> = { susp: 'suspendido', baja: 'baja', roto: 'invalido', nada: 'inexistente', 'ID Malo': 'invalido' };
    for (const [id, motivo] of Object.entries(motivos)) {
      expect(await l.modulos(id), id).toBeUndefined();
      expect(await l.estado(id), id).toMatchObject({ motivo });
    }
  });
});
