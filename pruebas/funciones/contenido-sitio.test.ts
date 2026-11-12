// scripts/contenido-sitio.mjs contra un servidor HTTP local que verifica la firma con el núcleo.
import { closeSync, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcularFirma, verificarFirma } from '@novutienda/nucleo/servidor';
import { calcularFirmaLocal, cambiarEstado, cerrarRezagados, ejecutar, generarContenido, idsValidos, leerDisponibilidad, normalizarUrl, pedirFirmado, trabajoPendiente } from '../../scripts/contenido-sitio.mjs';

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
beforeEach(() => { modo = {}; peticiones.length = 0; esperas.length = 0; avisos.length = 0; });

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
// Las esperas de reintento no duermen en las pruebas; se registran para comprobarlas.
const esperas: number[] = [];
const avisos: string[] = [];
const red = { esperar: async (ms: number) => { esperas.push(ms); }, avisar: (m: string) => { avisos.push(m); } };
const base = { tenant: TENANT, url: ORIGEN, secreto: SECRETO, calcularFirma, fetchFn: fetchLocal, ...red };
// Sin calcularFirma: usa la firma local de node:crypto.
const baseLocal = { tenant: TENANT, url: ORIGEN, secreto: SECRETO, fetchFn: fetchLocal, ...red };
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
    expect(esperas).toEqual([]);
    const r = await ejecutar(['pendiente', ...args], env, deps, fetchLocal, red);
    expect(r.codigo).toBe(1);
    expect(peticiones.some((p) => p.ruta.startsWith('/api/sitio/v1/destino'))).toBe(false);
  });
  it('toda petición lleva redirect «manual» y un AbortSignal con tiempo máximo', async () => {
    const vistos: RequestInit[] = [];
    const espia = ((entrada: string, init?: RequestInit) => { vistos.push(init ?? {}); return fetchLocal(entrada, init); }) as typeof fetch;
    await pedirFirmado({ ...base, fetchFn: espia, metodo: 'GET', ruta: '/api/sitio/v1/reconstrucciones?x=1' });
    await leerDisponibilidad({ url: ORIGEN, ids: ['p-uno'], fetchFn: espia });
    expect(vistos).toHaveLength(2);
    for (const init of vistos) {
      expect(init.redirect).toBe('manual');
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
    const r = await ejecutar(['pendiente', ...args], env, deps, (() => Promise.reject(new Error(`boom ${SECRETO}`))) as typeof fetch, red);
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
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal, red);
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

describe('reintentos y rezagados', () => {
  const estadoDe = (r: { codigo: number }) => r.codigo;
  it('502 dos veces y luego 200: código 0 con 3 peticiones, cada una con marca y firma válidas', async () => {
    let n = 0;
    const flaky = ((entrada: string, init?: RequestInit) => (++n <= 2 ? Promise.resolve(new Response('{}', { status: 502 })) : fetchLocal(entrada, init))) as typeof fetch;
    const vistos: RequestInit[] = [];
    const espia = ((entrada: string, init?: RequestInit) => { vistos.push(init ?? {}); return flaky(entrada, init); }) as typeof fetch;
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, espia, red);
    expect(estadoDe(r)).toBe(0);
    expect(vistos).toHaveLength(3);
    expect(peticiones).toHaveLength(1); // la tercera llegó al servidor, que la verificó (si no, habría dado 401)
    expect(esperas).toEqual([2000, 5000]);
    expect(avisos).toEqual(['reintento 1 de 3', 'reintento 2 de 3']);
    for (const init of vistos) {
      const h = init.headers as Record<string, string>;
      expect(Math.abs(Date.now() - Number(h['X-Marca-Tiempo']))).toBeLessThan(5 * 60_000);
      expect(h['X-Firma']).toBe(calcularFirma(SECRETO, h['X-Marca-Tiempo']!, `POST\n/api/sitio/v1/reconstrucciones/job-1/estado\n${init.body as string}`));
    }
  });
  it('502 siempre: código 1 tras 4 peticiones, con las tres esperas', async () => {
    modo.estado = 502;
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal, red);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('502');
    expect(peticiones).toHaveLength(4);
    expect(esperas).toEqual([2000, 5000, 10000]);
  });
  it('503 y 504 también se reintentan', async () => {
    for (const estado of [503, 504]) {
      peticiones.length = 0;
      modo.estado = estado;
      expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal, red)).codigo).toBe(1);
      expect(peticiones).toHaveLength(4);
    }
  });
  it('pendiente no reintenta: 502 hace una sola petición, sin esperas', async () => {
    modo.estado = 502;
    const r = await ejecutar(['pendiente', ...args], env, deps, fetchLocal, red);
    expect(r.codigo).toBe(1);
    expect(peticiones).toHaveLength(1);
    expect(esperas).toEqual([]);
  });
  it('la petición del POST aplicada pero con 502 al script: el reintento recibe «repetido» y da código 0, nunca 3', async () => {
    let n = 0;
    const respuestaPerdida = (async (entrada: string, init?: RequestInit) => {
      if (++n === 1) {
        await fetchLocal(entrada, init); // el servidor la aplica
        return new Response('{}', { status: 502 }); // pero el script solo ve el 502
      }
      return new Response(JSON.stringify({ repetido: true }), { status: 200 });
    }) as typeof fetch;
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, respuestaPerdida, red);
    expect(r).toEqual({ codigo: 0, salida: 'estado repetido' });
    expect(n).toBe(2);
    expect(peticiones).toHaveLength(1);
  });
  it('cerrarRezagados cuenta como fallo los en_curso que quedan sin ver tras las 10 rondas', async () => {
    let k = 0;
    const siempreNuevos = ((entrada: string, init?: RequestInit) => (entrada.includes('estado=en_curso')
      ? Promise.resolve(new Response(JSON.stringify({ trabajos: [{ id: `n-${k++}` }] }), { status: 200 }))
      : fetchLocal(entrada, init))) as typeof fetch;
    const r = await cerrarRezagados({ ...base, fetchFn: siempreNuevos });
    expect(r.cerrados).toBe(10);
    expect(r.fallos).toBe(1);
    const cli = await ejecutar(['rezagados', ...args], env, deps, siempreNuevos, red);
    expect(cli.codigo).toBe(1);
    expect(cli.salida).toBe('rezagados cerrados: 10');
  });
  it('409, 404, 400, 401 y 500 no se reintentan', async () => {
    for (const [estado, codigo] of [[409, 3], [404, 4], [400, 1], [500, 1]] as const) {
      peticiones.length = 0;
      modo.estado = estado;
      expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal, red)).codigo).toBe(codigo);
      expect(peticiones).toHaveLength(1);
    }
    peticiones.length = 0;
    modo = { sinFirmaValida: true };
    expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, fetchLocal, red)).codigo).toBe(1);
    expect(peticiones).toHaveLength(1);
    expect(esperas).toEqual([]);
  });
  it('error de red: reintenta 4 veces y falla sin revelar valores; si se recupera, sale bien', async () => {
    let llamadas = 0;
    const caido = (() => { llamadas++; return Promise.reject(new Error(`boom ${SECRETO}`)); }) as typeof fetch;
    const r = await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, caido, red);
    expect(r.codigo).toBe(1);
    expect(llamadas).toBe(4);
    expect(JSON.stringify(r) + avisos.join()).not.toContain(SECRETO);
    let k = 0;
    const sePuso = ((entrada: string, init?: RequestInit) => (++k === 1 ? Promise.reject(new Error('red')) : fetchLocal(entrada, init))) as typeof fetch;
    expect((await ejecutar(['estado', 'job-1', 'completada', ...args], env, deps, sePuso, red)).codigo).toBe(0);
  });
  it('rezagados cierra los trabajos en_curso, ordena la consulta y no imprime ids', async () => {
    modo.pendientes = { trabajos: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }] };
    // El servidor de prueba devuelve siempre la misma lista: tras cerrar, los ids ya vistos no se repiten.
    const r = await ejecutar(['rezagados', ...args], env, deps, fetchLocal, red);
    expect(r).toEqual({ codigo: 0, salida: 'rezagados cerrados: 3' });
    expect(peticiones[0]!.ruta).toBe(`/api/sitio/v1/reconstrucciones?estado=en_curso&tenantId=${TENANT}`);
    const posts = peticiones.filter((p) => p.metodo === 'POST');
    expect(posts.map((p) => JSON.parse(p.cuerpo).estado)).toEqual(['completada', 'completada', 'completada']);
    expect(JSON.stringify(r)).not.toMatch(/old-/);
  });
  it('rezagados respeta --excepto', async () => {
    modo.pendientes = { trabajos: [{ id: 'old-1' }, { id: 'actual' }, { id: 'old-2' }] };
    const r = await ejecutar(['rezagados', '--excepto', 'actual', ...args], env, deps, fetchLocal, red);
    expect(r).toEqual({ codigo: 0, salida: 'rezagados cerrados: 2' });
    const rutas = peticiones.filter((p) => p.metodo === 'POST').map((p) => p.ruta);
    expect(rutas.some((x) => x.includes('/actual/'))).toBe(false);
    expect(rutas).toHaveLength(2);
  });
  it('rezagados tolera un 409 o 404 intermedio; otro fallo da código 1 al final sin detener a los demás', async () => {
    modo.pendientes = { trabajos: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'a-3' }, { id: 'a-4' }] };
    const respuestas: Record<string, number> = { 'a-2': 409, 'a-3': 404, 'a-4': 500 };
    const conErrores = ((entrada: string, init?: RequestInit) => {
      const m = /reconstrucciones\/([^/]+)\/estado/.exec(entrada);
      const status = m ? respuestas[m[1]!] : undefined;
      return status !== undefined ? Promise.resolve(new Response('{}', { status })) : fetchLocal(entrada, init);
    }) as typeof fetch;
    const r = await ejecutar(['rezagados', ...args], env, deps, conErrores, red);
    expect(r.codigo).toBe(1);
    expect(r.salida).toBe('rezagados cerrados: 1');
    expect(JSON.stringify(r)).not.toMatch(/a-\d/);
    const soloTolerados = await ejecutar(['rezagados', '--excepto', 'a-4', ...args], env, deps, conErrores, red);
    expect(soloTolerados).toEqual({ codigo: 0, salida: 'rezagados cerrados: 1' });
  });
  it('rezagados sin trabajos: 0; --excepto inválido: código 2; cerrarRezagados vuelve a consultar al llegar al límite del servidor', async () => {
    modo.pendientes = { trabajos: [] };
    expect(await ejecutar(['rezagados', ...args], env, deps, fetchLocal, red)).toEqual({ codigo: 0, salida: 'rezagados cerrados: 0' });
    expect((await ejecutar(['rezagados', '--excepto', '../x', ...args], env, deps, fetchLocal, red)).codigo).toBe(2);
    let ronda = 0;
    const porRondas = ((entrada: string, init?: RequestInit) => {
      if (entrada.includes('estado=en_curso')) return Promise.resolve(new Response(JSON.stringify({ trabajos: ronda++ === 0 ? [{ id: 'r-1' }] : ronda === 2 ? [{ id: 'r-1' }, { id: 'r-2' }] : [] }), { status: 200 }));
      return fetchLocal(entrada, init);
    }) as typeof fetch;
    expect((await cerrarRezagados({ ...base, fetchFn: porRondas })).cerrados).toBe(2);
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
    expect(r).toEqual({ codigo: 0, salida: 'contenido generado: 120 productos\nadvertencias del mapeo: 0' }); // el lote exige código 0
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
    expect(r).toEqual({ codigo: 0, salida: 'contenido generado: 1 productos (aviso: 1 ids de producto inválidos sin consultar)\nadvertencias del mapeo: 0' });
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
  it('las advertencias del mapeo se cuentan e imprimen solo como rutas con ids enmascarados; el código sigue en 0', async () => {
    const privado = 'sec-privada';
    const mapear = (_p: unknown, _n: unknown, _e: unknown, adv?: string[]) => {
      adv?.push(`documentos.seccion__${privado}.bloques[0].items[2].enlace: enlace descartado (x)`, 'documentos.carrusel__cielo.items[0].enlace: enlace descartado (x)');
      return { productos: [], disponibilidad: {} };
    };
    const salida = join(dir, 'adv.json');
    const r = await ejecutar(['generar', '--salida', salida, ...args], env, { calcularFirma, mapear }, fetchLocal);
    expect(r.codigo).toBe(0);
    expect(r.salida).toBe('contenido generado: 3 productos\nadvertencias del mapeo: 2\n  documentos.seccion__*.bloques[0].items[2].enlace\n  documentos.carrusel__cielo.items[0].enlace');
    expect(JSON.stringify(r)).not.toContain(privado);
    const g = await generarContenido({ tenant: TENANT, url: ORIGEN, secreto: SECRETO, env, calcularFirma, mapear, fetchFn: fetchLocal });
    expect(g.advertencias).toHaveLength(2);
  });
});
