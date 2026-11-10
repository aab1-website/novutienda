// El tenant de las rutas públicas sale del host (sin emulador, entorno doble): cada host a su tenant, lista cerrada, y
// el control de estado del tenant (suspendido o de baja: 404 en el sitio, 401 en el pedido firmado).
import { describe, expect, it, vi } from 'vitest';
import { limiteMemoria } from '@novutienda/nucleo';
import { crearLectorDominios } from '../../plataforma/coordinador/dominios.js';
import { crearLectoresModulos } from '../../plataforma/coordinador/modulos-activos.js';
import { enrutar, type ConfigRouter } from '../../plataforma/funciones/servidor/http/router.js';
import { sha256Hex } from '../../plataforma/funciones/servidor/http/novuchat.js';
import { firmar, TENANT_TODO_ENCENDIDO } from './ayudas.js';

// El logger de `firebase-functions` toma `console.warn` al cargarse: se intercepta antes de los imports (hoisted) para leer sus avisos.
const avisos = vi.hoisted(() => {
  const lista: string[] = [];
  console.warn = (...a: unknown[]): void => { lista.push(a.map(String).join(' ')); };
  return lista;
});

const A = 'tienda-a';
const B = 'tienda-b';
const HOST_A = 'tienda-a.test';
const HOST_B = 'tienda-b.test';
const AHORA = 1_700_000_000_000;
const SECRETO = 'secreto-pedidos-de-prueba';
const TOKEN = 'token-de-prueba';

function montar(docs: Record<string, unknown>, o: { hosts?: number; hostsGlobal?: number } = {}) {
  const lecturas: string[] = [];
  const contactos: { tenantId: string; operacionId: string }[] = [];
  const disponibilidad: string[] = [];
  const cotizaciones: string[] = [];
  const firestore = {
    doc: (ruta: string) => ({
      get: () => {
        lecturas.push(ruta);
        return Promise.resolve({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] });
      },
    }),
  };
  const modulos = crearLectoresModulos(firestore, () => AHORA);
  const e = {
    ahora: () => AHORA,
    tenantDelHost: crearLectorDominios(firestore, () => AHORA),
    modulosDelTenant: modulos.modulos,
    estadoModulosDelTenant: modulos.estado,
    firestore,
    almacenCotizaciones: { leer: (ruta: string) => { cotizaciones.push(ruta); return Promise.resolve(null); } },
    leerDisponibilidad: (t: string) => () => { disponibilidad.push(t); return Promise.resolve({}); },
    guardarContacto: (t: string) => ({ guardar: (c: { operacionId: string }) => { contactos.push({ tenantId: t, operacionId: c.operacionId }); return Promise.resolve('creado' as const); } }),
    db: {},
  } as never;
  const cfg: ConfigRouter = {
    secretoReconstruccion: '',
    recaptcha: { verificar: () => Promise.resolve({ valido: true, puntaje: 0.9 }) },
    appCheck: { verificar: () => Promise.resolve(true) },
    novuchat: { sitioUrl: '', mediosBaseUrl: 'https://medios.test', limite: limiteMemoria(1000, 60_000), secretoPedidos: SECRETO },
    limiteContacto: limiteMemoria(1000, 60_000),
    limiteMemoria: { novuchat: limiteMemoria(1000, 60_000), disponibilidad: limiteMemoria(1000, 60_000), contacto: limiteMemoria(1000, 60_000), hosts: limiteMemoria(o.hosts ?? 1000, 60_000), hostsGlobal: limiteMemoria(o.hostsGlobal ?? 1000, 60_000) },
  };
  return { e, cfg, lecturas, contactos, disponibilidad, cotizaciones };
}

const base = (): Record<string, unknown> => ({
  [`tenants/${A}`]: TENANT_TODO_ENCENDIDO,
  [`tenants/${B}`]: TENANT_TODO_ENCENDIDO,
  [`dominios/${HOST_A}`]: { tenantId: A },
  [`dominios/${HOST_B}`]: { tenantId: B },
});

const peticion = (metodo: string, ruta: string, host: string | undefined, o: { cuerpo?: string; cabeceras?: Record<string, string>; consulta?: Record<string, string> } = {}) => {
  const crudo = o.cuerpo ?? '';
  return {
    metodo, ruta, url: ruta, consulta: o.consulta ?? { mercado: 'BO', ids: 'tv-1' }, cuerpoCrudo: crudo, cuerpo: crudo === '' ? undefined : (JSON.parse(crudo) as unknown), origen: '203.0.113.1',
    cabeceras: { ...(host === undefined ? {} : { 'x-forwarded-host': host }), ...o.cabeceras },
  };
};
const contacto = (host: string | undefined, id = 'envio-0123456789abcdef') =>
  peticion('POST', '/api/contacto', host, {
    cuerpo: JSON.stringify({ envioId: id, nombre: 'Ana Pérez', correo: 'ana@ejemplo.test', mensaje: 'Quisiera una cotización', aceptaPrivacidad: true, recaptchaToken: 'x'.repeat(30) }),
    cabeceras: { 'content-type': 'application/json', 'x-firebase-appcheck': 't' },
  });
const pedido = (host: string | undefined) => {
  const cuerpo = JSON.stringify({ pedidoId: 'p1', items: [{ productoId: 'x', cantidad: 1 }], confirmadoEn: '2026-11-09T10:00:00Z' });
  const marca = String(AHORA);
  return peticion('POST', '/api/novuchat/v1/pedidos/confirmar', host, { cuerpo, cabeceras: { 'x-marca-tiempo': marca, 'x-firma': firmar(SECRETO, marca, cuerpo) } });
};

describe('tenant por host en las rutas públicas', () => {
  it('cada host llega a su tenant en cotización, disponibilidad y contacto', async () => {
    const m = montar(base());
    for (const [host, t] of [[HOST_A, A], [HOST_B, B]] as const) {
      await enrutar(m.e, peticion('GET', '/api/cotizacion', host, { consulta: { mercado: 'BO' } }), m.cfg);
      expect((await enrutar(m.e, peticion('GET', '/api/disponibilidad', host), m.cfg)).status).toBe(200);
      expect((await enrutar(m.e, contacto(host, `envio-${t}-0123456789abc`), m.cfg)).status).toBe(200);
      expect(m.cotizaciones.at(-1)).toContain(`tenants/${t}/`);
      expect(m.disponibilidad.at(-1)).toBe(t);
      expect(m.contactos.at(-1)).toMatchObject({ tenantId: t });
    }
    // El contacto de B se escribió en B y nada en A.
    expect(m.contactos.filter((c) => c.tenantId === A)).toHaveLength(1);
    expect(m.contactos.filter((c) => c.tenantId === B)).toHaveLength(1);
  });

  it('pedido firmado: el host fija el tenant (B sin inventarios: 401; A: llega a confirmar)', async () => {
    const m = montar(base());
    // Sin módulo inventarios en B: 401 (D2 = A) aunque la firma sea válida; con él, la ruta llega a confirmar el pedido (no 404).
    const sinInv = montar({ ...base(), [`tenants/${B}`]: { ...TENANT_TODO_ENCENDIDO, modulos: { website: { version: '0.1.0', submodulos: [] } } } });
    expect((await enrutar(sinInv.e, pedido(HOST_B), sinInv.cfg)).status).toBe(401);
    expect((await enrutar(sinInv.e, pedido(HOST_B), sinInv.cfg)).cuerpo).toEqual({ error: 'credencial_invalida' });
    expect((await enrutar(m.e, pedido(HOST_A), m.cfg)).status).not.toBe(404);
  });

  it('host desconocido, sin cabecera, con lista o inválido: 404 en las cuatro rutas', async () => {
    const m = montar(base());
    for (const host of ['no-mapeado.test', undefined, 'tienda-a.test, tienda-b.test', 'localhost']) {
      for (const p of [peticion('GET', '/api/cotizacion', host), peticion('GET', '/api/disponibilidad', host), contacto(host), pedido(host)]) {
        const r = await enrutar(m.e, p, m.cfg);
        expect([p.ruta, r.status]).toEqual([p.ruta, 404]);
        expect(r.cuerpo).toEqual({ error: 'no_encontrado' });
      }
    }
    expect(m.contactos).toEqual([]);
  });

  it('solo cuenta x-forwarded-host: la cabecera host no sirve', async () => {
    const m = montar(base());
    const p = { ...peticion('GET', '/api/disponibilidad', undefined), cabeceras: { host: HOST_A } };
    expect((await enrutar(m.e, p, m.cfg)).status).toBe(404);
  });

  it('tenant suspendido o dado de baja: 404 en el sitio y 401 en el pedido', async () => {
    for (const estado of ['suspendido', 'baja']) {
      const m = montar({ ...base(), [`tenants/${B}`]: { ...TENANT_TODO_ENCENDIDO, estado } });
      for (const p of [peticion('GET', '/api/cotizacion', HOST_B), peticion('GET', '/api/disponibilidad', HOST_B), contacto(HOST_B)]) {
        expect([estado, (await enrutar(m.e, p, m.cfg)).status]).toEqual([estado, 404]);
      }
      const r = await enrutar(m.e, pedido(HOST_B), m.cfg);
      expect([estado, r.status, r.cuerpo]).toEqual([estado, 401, { error: 'credencial_invalida' }]);
      expect(m.contactos).toEqual([]);
    }
  });

  it('host mapeado a un tenant inexistente: 404', async () => {
    const m = montar({ ...base(), 'dominios/fantasma.test': { tenantId: 'no-existe' } });
    expect((await enrutar(m.e, peticion('GET', '/api/disponibilidad', 'fantasma.test'), m.cfg)).status).toBe(404);
    expect((await enrutar(m.e, pedido('fantasma.test'), m.cfg)).status).toBe(401);
  });

  it('un host fuera de caché pasa por el límite por origen (429); el que está en caché no lo gasta', async () => {
    const m = montar(base(), { hosts: 2 });
    expect((await enrutar(m.e, peticion('GET', '/api/disponibilidad', 'uno.test'), m.cfg)).status).toBe(404);
    expect((await enrutar(m.e, peticion('GET', '/api/disponibilidad', 'dos.test'), m.cfg)).status).toBe(404);
    const limitado = await enrutar(m.e, peticion('GET', '/api/disponibilidad', 'tres.test'), m.cfg);
    expect(limitado.status).toBe(429);
    expect(m.lecturas.filter((l) => l.startsWith('dominios/'))).toEqual(['dominios/uno.test', 'dominios/dos.test']);
    // Un host ya cacheado (aunque sea negativo) responde sin gastar el límite.
    expect((await enrutar(m.e, peticion('GET', '/api/disponibilidad', 'uno.test'), m.cfg)).status).toBe(404);
  });

  it('el límite global de hosts (clave fija) responde 429 aunque cambie el origen', async () => {
    const m = montar(base(), { hostsGlobal: 2 });
    const desde = (host: string, origen: string) => ({ ...peticion('GET', '/api/disponibilidad', host), origen });
    expect((await enrutar(m.e, desde('uno.test', 'o1'), m.cfg)).status).toBe(404);
    expect((await enrutar(m.e, desde('dos.test', 'o2'), m.cfg)).status).toBe(404);
    expect((await enrutar(m.e, desde('tres.test', 'o3'), m.cfg)).status).toBe(429);
    expect(m.lecturas.filter((l) => l.startsWith('dominios/'))).toEqual(['dominios/uno.test', 'dominios/dos.test']);
  });

  it('el log de rechazo lleva todos los nombres de cabeceras, ordenados y sin valores', async () => {
    avisos.length = 0;
    const m = montar(base());
    const p = peticion('GET', '/api/disponibilidad', undefined, { cabeceras: { 'x-zeta': 'valor-secreto', accept: 'a' } });
    await enrutar(m.e, p, m.cfg);
    const texto = avisos.join('\n');
    expect(texto).toContain('host-invalido');
    expect(texto).toContain(JSON.stringify(Object.keys(p.cabeceras).sort()));
    expect(texto).not.toContain('valor-secreto');
  });

  it('el catálogo y el inventario siguen por token, sin host', async () => {
    const m = montar({ ...base(), [`novuchatTokens/${sha256Hex(TOKEN)}`]: { tenantId: A, hash: sha256Hex(TOKEN), activo: true } });
    const r = await enrutar(m.e, peticion('GET', '/api/novuchat/v1/inventario', undefined, { cabeceras: { authorization: `Bearer ${TOKEN}` } }), m.cfg).catch((x: unknown) => x);
    // Con el token válido pasa la autenticación y el control de módulo: no es un 401/404 de host (puede fallar después, al leer datos del doble).
    expect(r instanceof Error || (r as { status: number }).status !== 404).toBe(true);
    expect(m.lecturas.some((l) => l.startsWith('dominios/'))).toBe(false);
  });
});
