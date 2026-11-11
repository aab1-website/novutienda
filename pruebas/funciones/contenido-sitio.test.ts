// scripts/contenido-sitio.mjs contra un servidor HTTP local que verifica la firma con el núcleo.
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcularFirma, verificarFirma } from '@novutienda/nucleo/servidor';
import { calcularFirmaLocal, cambiarEstado, ejecutar, generarContenido, idsValidos, leerDisponibilidad, normalizarUrl, pedirFirmado, trabajoPendiente } from '../../scripts/contenido-sitio.mjs';

// Valores de prueba sin aspecto de clave (gitleaks): armados en ejecución.
const SECRETO = 's'.repeat(24);
const OTRO = 'o'.repeat(24);
const TENANT = 'tienda-a';
let servidor: Server;
let url = '';
let modo: { estado?: number; pendientes?: unknown; productos?: number; sinFirmaValida?: boolean; redirigir?: boolean; disponibilidadEstado?: number; repetido?: boolean } = {};
const peticiones: { metodo: string; ruta: string; cuerpo: string }[] = [];

const leer = (req: IncomingMessage) => new Promise<string>((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => ok(t)); });

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const cuerpo = await leer(req);
    const ruta = req.url ?? '';
    const responder = (estado: number, json: unknown) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
    peticiones.push({ metodo: req.method ?? '', ruta, cuerpo });
    if (ruta.startsWith('/api/sitio/v1/destino')) return responder(200, { trabajos: [{ id: 'destino' }] });
    if (modo.redirigir) { res.writeHead(302, { Location: '/api/sitio/v1/destino' }); return res.end(); }
    if (ruta.startsWith('/api/disponibilidad')) {
      if (modo.disponibilidadEstado !== undefined) return responder(modo.disponibilidadEstado, {});
      const ids = new URL(ruta, 'http://x').searchParams.get('ids')!.split(',');
      return responder(200, { disponibilidad: Object.fromEntries(ids.map((i, n) => [i, n % 2 === 0 ? 'disponible' : 'agotado'])) });
    }
    const v = verificarFirma({
      secreto: SECRETO, marcaTiempo: String(req.headers['x-marca-tiempo']), firma: String(req.headers['x-firma']),
      cuerpo: `${req.method}\n${ruta}\n${cuerpo}`, ahoraMs: Date.now(),
    });
    if (!v.ok || modo.sinFirmaValida) return responder(401, { error: 'firma' });
    if (modo.estado !== undefined) return responder(modo.estado, { repetido: modo.repetido === true });
    if (ruta.startsWith('/api/sitio/v1/reconstrucciones?')) return responder(200, modo.pendientes ?? { trabajos: [{ id: 'job-1' }, { id: 'job-2' }] });
    if (ruta.endsWith('/estado')) return responder(200, { repetido: false });
    if (ruta.startsWith('/api/sitio/v1/publicado')) {
      const documentos: Record<string, unknown> = { 'config__sitio': {} };
      for (let i = 0; i < (modo.productos ?? 3); i++) documentos[`producto__p${i}`] = { nombre: `Producto-privado-${i}` };
      return responder(200, { documentos });
    }
    return responder(404, {});
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const dir = servidor.address();
  url = `http://127.0.0.1:${typeof dir === 'object' && dir !== null ? dir.port : 0}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
beforeEach(() => { modo = {}; peticiones.length = 0; });

// El script exige https; para el servidor local se inyecta un fetch que reescribe el origen a http://127.0.0.1.
const ORIGEN = 'https://sitio.example.com';
const fetchLocal = ((entrada: string, init?: RequestInit) => fetch(String(entrada).replace(ORIGEN, url), init)) as typeof fetch;
const deps = { calcularFirma, mapear: (respuesta: unknown, _n: unknown, entorno: unknown) => {
  const publicado = respuesta as { documentos: Record<string, unknown> };
  const e = entorno as { disponibilidad: Record<string, boolean> };
  const productos = Object.keys(publicado.documentos).filter((k) => k.startsWith('producto__')).map((k) => k.slice(10));
  if (productos.length > 200) throw new Error('productos: demasiados');
  return { productos, disponibilidad: e.disponibilidad };
} };
const base = { tenant: TENANT, url: ORIGEN, secreto: SECRETO, calcularFirma, fetchFn: fetchLocal };
// Sin calcularFirma: usa la firma local de node:crypto.
const baseLocal = { tenant: TENANT, url: ORIGEN, secreto: SECRETO, fetchFn: fetchLocal };
const env = { SITIO_RECONSTRUCCION_SECRETO: SECRETO, MEDIOS_BASE_URL: 'https://medios.example.com/', SITIO_NEGOCIO: '{"nombre":"N"}' };
const args = ['--tenant', TENANT, '--url', ORIGEN];

describe('firma local y petición segura', () => {
  it('calcularFirmaLocal es idéntica a calcularFirma del núcleo', () => {
    for (const [marca, cuerpo] of [['1700000000000', 'GET\n/api/x?a=1\n'], ['1', 'POST\n/y\n{"a":"ñ"}'], ['', '']] as const) {
      expect(calcularFirmaLocal(SECRETO, marca, cuerpo)).toBe(calcularFirma(SECRETO, marca, cuerpo));
    }
    expect(() => calcularFirmaLocal('', '1', 'x')).toThrow('falta SITIO_RECONSTRUCCION_SECRETO');
  });
  it('sin calcularFirma inyectada, el servidor igual verifica la firma con el núcleo', async () => {
    expect((await pedirFirmado({ ...baseLocal, metodo: 'GET', ruta: '/api/sitio/v1/reconstrucciones?x=1' })).estado).toBe(200);
    expect(await trabajoPendiente(baseLocal)).toBe('job-1');
    expect((await ejecutar(['pendiente', ...args], env, { mapear: deps.mapear }, fetchLocal)).codigo).toBe(0);
  });
  it('pendiente y estado no cargan el registro ni usan el mapeo; solo generar lo carga', async () => {
    const mapear = () => { throw new Error('mapear no debía usarse'); };
    const conMapeo = { mapear };
    expect(await ejecutar(['pendiente', ...args], env, conMapeo, fetchLocal)).toEqual({ codigo: 0, salida: 'job-1' });
    expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, conMapeo, fetchLocal)).codigo).toBe(0);
    // Sin deps tampoco se carga nada: pendiente solo usa la red y la firma local.
    expect((await ejecutar(['pendiente', ...args], env, undefined, fetchLocal)).codigo).toBe(0);
  });
  it('una respuesta 3xx falla y no se sigue la redirección', async () => {
    modo.redirigir = true;
    await expect(pedirFirmado({ ...base, metodo: 'GET', ruta: '/api/sitio/v1/reconstrucciones?x=1' })).rejects.toThrow('no se pudo contactar al sitio');
    expect(peticiones.map((p) => p.ruta)).toEqual(['/api/sitio/v1/reconstrucciones?x=1']);
    const r = await ejecutar(['pendiente', ...args], env, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(peticiones.some((p) => p.ruta.startsWith('/api/sitio/v1/destino'))).toBe(false);
  });
  it('toda petición lleva redirect «error» y un AbortSignal con tiempo máximo', async () => {
    const vistos: RequestInit[] = [];
    const espia = ((entrada: string, init?: RequestInit) => { vistos.push(init ?? {}); return fetchLocal(entrada, init); }) as typeof fetch;
    await pedirFirmado({ ...base, fetchFn: espia, metodo: 'GET', ruta: '/api/sitio/v1/reconstrucciones?x=1' });
    await leerDisponibilidad({ url: ORIGEN, ids: ['p-uno'], fetchFn: espia });
    expect(vistos).toHaveLength(2);
    for (const init of vistos) {
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(false);
    }
  });
  it('http://localhost y 127.0.0.1 solo se admiten con NODE_ENV=test', async () => {
    expect(() => normalizarUrl('http://127.0.0.1:8080')).toThrow('--url debe ser https sin ruta');
    expect(() => normalizarUrl('http://localhost')).toThrow('debe ser https');
    expect(normalizarUrl('http://127.0.0.1:8080/', true)).toBe('http://127.0.0.1:8080');
    expect(normalizarUrl('https://sitio.example.com/')).toBe(ORIGEN);
    expect(normalizarUrl('https://medios.example.com/bucket-stg/', false, 'MEDIOS_BASE_URL', true)).toBe('https://medios.example.com/bucket-stg');
    expect(() => normalizarUrl('https://medios.example.com/b?x=1', false, 'MEDIOS_BASE_URL', true)).toThrow('MEDIOS_BASE_URL debe ser https');
    expect(() => normalizarUrl('https://u@medios.example.com/b', false, 'MEDIOS_BASE_URL', true)).toThrow('debe ser https');
    expect(() => normalizarUrl('https://medios.example.com/b')).toThrow('sin ruta');
    const r = await ejecutar(['pendiente', '--tenant', TENANT, '--url', 'http://127.0.0.1:9'], { ...env, NODE_ENV: 'production' }, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(peticiones).toHaveLength(0);
  });
  it('idsValidos descarta lo que la disponibilidad pública no acepta', () => {
    expect(idsValidos(['p-uno', 'MAL ID', 'a', '-x', 'p'.repeat(61), 'ok-2'])).toEqual(['p-uno', 'ok-2']);
  });
  it('un fallo inesperado informa solo nombre y código, nunca el mensaje', async () => {
    const falla = () => { throw Object.assign(new TypeError(`detalle ${SECRETO}`), { code: 'ERR_PRUEBA' }); };
    const r = await ejecutar(['pendiente', ...args], env, { calcularFirma: falla, mapear: deps.mapear }, fetchLocal);
    expect(r).toEqual({ codigo: 1, error: 'error inesperado (TypeError ERR_PRUEBA)' });
    const sinCodigo = await ejecutar(['pendiente', ...args], env, { calcularFirma: () => { throw new RangeError(SECRETO); }, mapear: deps.mapear }, fetchLocal);
    expect(sinCodigo.error).toBe('error inesperado (RangeError)');
  });
});

describe('pedirFirmado y pendiente', () => {
  it('firma bien: 200 y el servidor verifica con calcularFirma', async () => {
    const r = await pedirFirmado({ ...base, metodo: 'GET', ruta: '/api/sitio/v1/reconstrucciones?x=1' });
    expect(r.estado).toBe(200);
  });
  it('secreto equivocado: 401', async () => {
    const r = await pedirFirmado({ ...base, secreto: OTRO, metodo: 'GET', ruta: '/api/sitio/v1/publicado' });
    expect(r.estado).toBe(401);
  });
  it('trabajoPendiente devuelve el primero, o null', async () => {
    expect(await trabajoPendiente(base)).toBe('job-1');
    modo.pendientes = { trabajos: [] };
    expect(await trabajoPendiente(base)).toBeNull();
    expect(peticiones[0]?.ruta).toContain(`estado=pendiente&tenantId=${TENANT}`);
  });
  it('ejecutar pendiente: imprime el id; sin trabajos no imprime nada', async () => {
    expect(await ejecutar(['pendiente', ...args], env, deps, fetchLocal)).toEqual({ codigo: 0, salida: 'job-1' });
    modo.pendientes = {};
    expect(await ejecutar(['pendiente', ...args], env, deps, fetchLocal)).toEqual({ codigo: 0, salida: undefined });
  });
  it('401 del sitio con secreto distinto: código 1 sin revelar el secreto', async () => {
    const r = await ejecutar(['pendiente', ...args], { ...env, SITIO_RECONSTRUCCION_SECRETO: 'z'.repeat(24) }, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('401');
    expect(JSON.stringify(r)).not.toContain('z'.repeat(24));
  });
  it('error de red: código 1 con motivo', async () => {
    const r = await ejecutar(['pendiente', ...args], env, deps, (() => Promise.reject(new Error(`boom ${SECRETO}`))) as typeof fetch);
    expect(r.codigo).toBe(1);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });
});

describe('cambiarEstado', () => {
  it('200: cambiado, con cuerpo firmado', async () => {
    expect(await cambiarEstado(base, 'job-1', 'en_curso')).toBe('cambiado');
    expect(JSON.parse(peticiones[0]!.cuerpo)).toEqual({ tenantId: TENANT, estado: 'en_curso' });
    expect(peticiones[0]!.metodo).toBe('POST');
  });
  it('409 -> código 3; 404 -> código 4', async () => {
    modo.estado = 409;
    expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal)).codigo).toBe(3);
    modo.estado = 404;
    expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal)).codigo).toBe(4);
  });
  it('503 -> código 1 con el motivo; repetido se informa', async () => {
    modo.estado = 503;
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('503');
    modo = { estado: 200, repetido: true };
    expect(await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal)).toEqual({ codigo: 0, salida: 'estado repetido' });
    modo = { estado: 200 };
    expect(await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal)).toEqual({ codigo: 0, salida: 'estado cambiado' });
  });
  it('500 -> código 1; 401 -> código 1', async () => {
    modo.estado = 500;
    expect((await ejecutar(['estado', 'job-1', 'fallida', ...args], env, deps, fetchLocal)).codigo).toBe(1);
    modo = { sinFirmaValida: true };
    expect((await ejecutar(['estado', 'job-1', 'fallida', ...args], env, deps, fetchLocal)).codigo).toBe(1);
  });
  it('id o estado inválidos no llegan a la red', async () => {
    expect((await ejecutar(['estado', '../x', 'completada', ...args], env, deps, fetchLocal)).codigo).toBe(1);
    expect((await ejecutar(['estado', 'job-1', 'rara', ...args], env, deps, fetchLocal)).codigo).toBe(1);
    expect(peticiones).toHaveLength(0);
  });
});

describe('validación de argumentos y entorno', () => {
  it('tenant inválido, url inválida, secreto ausente y subcomando desconocido', async () => {
    const mal = 'TENANT-MALO';
    const t = await ejecutar(['pendiente', '--tenant', mal, '--url', ORIGEN], env, deps, fetchLocal);
    expect(t.codigo).toBe(1);
    expect(t.error).not.toContain(mal);
    const u = await ejecutar(['pendiente', '--tenant', TENANT, '--url', 'http://sitio.example.com/ruta-privada'], env, deps, fetchLocal);
    expect(u.codigo).toBe(1);
    expect(u.error).not.toContain('ruta-privada');
    expect((await ejecutar(['pendiente', ...args], {}, deps, fetchLocal)).codigo).toBe(1);
    expect((await ejecutar(['otro', ...args], env, deps, fetchLocal)).codigo).toBe(2);
    expect(peticiones).toHaveLength(0);
  });
});

describe('generar', () => {
  let dir = '';
  // Abre una sola vez: modo y contenido salen del mismo descriptor (sin comprobar y luego usar la ruta).
  const leerConModo = (ruta: string): { modo: number; texto: string } => {
    const fd = openSync(ruta, 'r');
    try { return { modo: fstatSync(fd).mode & 0o777, texto: readFileSync(fd, 'utf8') }; } finally { closeSync(fd); }
  };
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'contenido-sitio-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('escribe el contenido validado, pide disponibilidad en lotes de 50 e imprime solo conteos', async () => {
    modo.productos = 120;
    const salida = join(dir, 'sub', 'contenido.json');
    const r = await ejecutar(['generar', '--salida', salida, ...args], env, deps, fetchLocal);
    expect(r).toEqual({ codigo: 0, salida: 'contenido generado: 120 productos' }); // el lote exige código 0
    const leido = leerConModo(salida);
    expect(leido.modo).toBe(0o600);
    const escrito = JSON.parse(leido.texto) as { productos: string[]; disponibilidad: Record<string, boolean> };
    expect(escrito.productos).toHaveLength(120);
    expect(escrito.disponibilidad.p0).toBe(true);
    expect(escrito.disponibilidad.p1).toBe(false);
    expect(peticiones.filter((p) => p.ruta.startsWith('/api/disponibilidad'))).toHaveLength(3);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    expect(JSON.stringify(r)).not.toContain('Producto-privado');
  });
  it('si el mapeo rechaza el contenido, no se escribe la salida y el error no trae valores', async () => {
    modo.productos = 201;
    const salida = join(dir, 'malo.json');
    const r = await ejecutar(['generar', '--salida', salida, ...args], env, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(r.error).toBe('generar: el contenido publicado no es válido (0 errores)');
    expect(r.error).not.toContain('demasiados'); // el mensaje original del mapeo (e.message) no se propaga
    expect(existsSync(salida)).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });
  it('errores del mapeo: solo conteo y rutas con ids de producto, sección y categoría enmascarados', async () => {
    const privado = 'p-privado';
    const mapear = () => { throw Object.assign(new Error(`mensaje con ${privado}`), { errores: [`documentos.producto__${privado}.marca: falta`, `documentos.seccion__${privado}.titulo: mal`, `config.categorias.${privado}.nombre: vacío`, 7] }); };
    const salida = join(dir, 'enmascarado.json');
    const r = await ejecutar(['generar', '--salida', salida, ...args], env, { calcularFirma, mapear }, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('(3 errores)');
    expect(r.error).toContain('documentos.producto__*.marca');
    expect(r.error).toContain('documentos.seccion__*.titulo');
    expect(r.error).toContain('config.categorias.*.nombre');
    expect(r.error).not.toContain(privado);
    expect(existsSync(salida)).toBe(false);
  });
  it('disponibilidad 500 o 429 falla con el estado y sin escribir', async () => {
    for (const estado of [500, 429]) {
      modo = { disponibilidadEstado: estado };
      const salida = join(dir, `disp-${estado}.json`);
      const r = await ejecutar(['generar', '--salida', salida, ...args], env, deps, fetchLocal);
      expect(r.codigo).toBe(1);
      expect(r.error).toContain(String(estado));
      expect(existsSync(salida)).toBe(false);
    }
  });
  it('ids inválidos: no se consultan, se avisa solo el conteo y se reemplaza un archivo previo con modo 0600', async () => {
    modo.productos = 2;
    const salida = join(dir, 'previo.json');
    writeFileSync(salida, 'viejo', { mode: 0o644 });
    const publicadoMalo = ((entrada: string, init?: RequestInit) => entrada.includes('/publicado')
      ? Promise.resolve(new Response(JSON.stringify({ documentos: { 'producto__p0': {}, 'producto__MAL ID': {} } }), { status: 200 }))
      : fetchLocal(entrada, init)) as typeof fetch;
    const r = await ejecutar(['generar', '--salida', salida, ...args], env, deps, publicadoMalo);
    expect(r).toEqual({ codigo: 0, salida: 'contenido generado: 1 productos (aviso: 1 ids de producto inválidos sin consultar)' });
    const releido = leerConModo(salida);
    expect(releido.modo).toBe(0o600);
    expect(releido.texto).not.toContain('viejo');
    const consultados = peticiones.filter((p) => p.ruta.startsWith('/api/disponibilidad')).map((p) => p.ruta).join();
    expect(consultados).not.toContain('MAL');
  });
  it('generarContenido devuelve el conteo de ids inválidos', async () => {
    const fetchMalo = ((entrada: string) => Promise.resolve(new Response(JSON.stringify(entrada.includes('/publicado') ? { documentos: { 'producto__p0': {}, 'producto__X': {}, 'producto__MAL ID': {} } } : { disponibilidad: {} }), { status: 200 }))) as typeof fetch;
    const r = await generarContenido({ tenant: TENANT, url: ORIGEN, secreto: SECRETO, env, mapear: () => ({}), fetchFn: fetchMalo });
    expect(r).toMatchObject({ productos: 1, invalidos: 2 });
  });
  it('falta --salida (2), MEDIOS_BASE_URL no https y SITIO_NEGOCIO inválido (1)', async () => {
    expect((await ejecutar(['generar', ...args], env, deps, fetchLocal)).codigo).toBe(2);
    const salida = join(dir, 'x.json');
    expect((await ejecutar(['generar', '--salida', salida, ...args], { ...env, MEDIOS_BASE_URL: 'http://medios' }, deps, fetchLocal)).codigo).toBe(1);
    expect((await ejecutar(['generar', '--salida', salida, ...args], { ...env, SITIO_NEGOCIO: 'no-json' }, deps, fetchLocal)).codigo).toBe(1);
    expect(existsSync(salida)).toBe(false);
  });
  it('401 al leer publicado: código 1 sin escribir', async () => {
    const salida = join(dir, 'y.json');
    const r = await ejecutar(['generar', '--salida', salida, ...args], { ...env, SITIO_RECONSTRUCCION_SECRETO: OTRO }, deps, fetchLocal);
    expect(r.codigo).toBe(1);
    expect(existsSync(salida)).toBe(false);
  });
  it('generarContenido pasa el entorno al mapeo (App Check solo si están las cuatro variables)', async () => {
    let visto: { appCheck: unknown; origenMedios: string; baseMedios: string; origen: string } | undefined;
    const mapear = (_p: unknown, _n: unknown, e: unknown) => { visto = e as typeof visto; return {}; };
    const llamar = (extra: Record<string, string>) => generarContenido({ tenant: TENANT, url: ORIGEN, secreto: SECRETO, env: { ...env, ...extra }, calcularFirma, mapear, fetchFn: fetchLocal });
    await llamar({});
    expect(visto?.appCheck).toBeNull();
    expect(visto?.origenMedios).toBe('https://medios.example.com');
    // Base con ruta (bucket): el origen va sin ruta (CSP y validación) y la base completa arma las url de las fotos.
    await llamar({ MEDIOS_BASE_URL: 'https://medios.example.com/bucket-stg/' });
    expect(visto?.origenMedios).toBe('https://medios.example.com');
    expect(visto?.baseMedios).toBe('https://medios.example.com/bucket-stg');
    await llamar({ VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: 'k', VITE_FIREBASE_API_KEY: 'a', VITE_FIREBASE_APP_ID: 'i', VITE_FIREBASE_PROJECT_ID: 'p' });
    expect(visto?.appCheck).toEqual({ claveSitio: 'k', apiKey: 'a', appId: 'i', projectId: 'p' });
  });
});
