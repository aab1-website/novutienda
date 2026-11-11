// scripts/contenido-sitio.mjs contra un servidor HTTP local que verifica la firma con `verificarFirma` del núcleo (texto firmado
// exacto del contrato de docs/produccion/reconstruccion-sitio.md). Todo inventado: dominios .invalid, nombres ficticios.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { verificarFirma } from '@novutienda/nucleo/servidor';
import { contenidoEjemplo, validarContenido } from '@novutienda/website';

const SECRETO = 'secreto-de-prueba-0123456789abcdef';
const TENANT = 'tienda-ejemplo';
const MEDIOS = 'https://medios.ejemplo.invalid';

interface Visto { metodo: string; url: string; cuerpo: string; firmaOk: boolean }
let visto: Visto[] = [];
let responder: (v: Visto) => { estado: number; json: unknown } = () => ({ estado: 200, json: {} });
let servidor: Server;
let base = '';
let tmp = '';

const foto = (ruta: string) => ({
  tipo: 'foto', alt: 'Foto de ejemplo', ancho: 2000, alto: 1000,
  versiones: [480, 960, 1600].map((lado) => ({ clase: 'imagen', lado, formato: 'webp', ruta: `${ruta}/${lado}.webp` })),
});
const prod = (id: string) => ({
  id, slug: id, nombre: `Producto ${id}`, categoria: 'aire-acondicionado', marca: 'Marca Ejemplo', descripcion: 'Descripción de ejemplo.',
  garantia: '12 meses', medios: [foto(`m/${id}`)], seo: {}, precioUSD: { bo: 100, ar: 120 },
});
const publicado = (ids: string[]) => ({
  redondeo: { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } },
  documentos: {
    sitio: { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {}, version: 1 },
    estado: { version: 1, secciones: [] },
    ...Object.fromEntries(ids.map((id) => [`producto__${id}`, prod(id)])),
  },
});
const negocio = {
  nombre: 'Tienda de Ejemplo', lema: 'Lema de ejemplo', logo: null, whatsappTienda: null, telefono: null, correo: null,
  direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
  portada: contenidoEjemplo.portada, beneficios: contenidoEjemplo.beneficios, identidad: { ...contenidoEjemplo.identidad, foto: null },
  textoPrivacidad: ['Texto de privacidad de ejemplo.'], categorias: {}, destacados: [],
};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'contenido-sitio-'));
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const trozos: Buffer[] = [];
    req.on('data', (t: Buffer) => trozos.push(t));
    req.on('end', () => {
      const cuerpo = Buffer.concat(trozos).toString('utf8');
      const metodo = req.method ?? '';
      const url = req.url ?? '';
      const firmado = url.startsWith('/api/sitio/v1/');
      const r = verificarFirma({
        secreto: SECRETO, marcaTiempo: String(req.headers['x-marca-tiempo'] ?? ''), firma: String(req.headers['x-firma'] ?? ''),
        cuerpo: `${metodo}\n${url}\n${cuerpo}`, ahoraMs: Date.now(),
      });
      const v: Visto = { metodo, url, cuerpo, firmaOk: r.ok };
      visto.push(v);
      const sal = firmado && !r.ok ? { estado: 401, json: { error: 'firma_invalida' } } : responder(v);
      res.writeHead(sal.estado, { 'Content-Type': 'application/json' }).end(JSON.stringify(sal.json));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => {
  servidor.close();
  rmSync(tmp, { recursive: true, force: true });
});
afterEach(() => {
  visto = [];
  responder = () => ({ estado: 200, json: {} });
});

function correr(args: string[], env: Record<string, string> = {}): Promise<{ codigo: number; out: string; err: string }> {
  return new Promise((ok) => {
    const entorno: Record<string, string> = {
      PATH: process.env['PATH'] ?? '', NODE_ENV: 'test', SITIO_URL: base, TENANT_ID: TENANT, SITIO_RECONSTRUCCION_SECRETO: SECRETO,
      MEDIOS_BASE_URL: MEDIOS, SITIO_NEGOCIO: JSON.stringify(negocio), ...env,
    };
    const p = spawn(process.execPath, ['scripts/contenido-sitio.mjs', ...args], { env: entorno, cwd: process.cwd() });
    let out = '';
    let err = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    p.on('close', (codigo) => ok({ codigo: codigo ?? -1, out, err }));
  });
}
const sinSecreto = (r: { out: string; err: string }) => {
  expect(r.out + r.err).not.toContain(SECRETO);
  expect(r.out + r.err).not.toMatch(/[0-9a-f]{64}/);
};

describe('contenido-sitio pendiente', () => {
  it('imprime el id del más antiguo con la petición firmada del contrato', async () => {
    responder = () => ({ estado: 200, json: { trabajos: [{ id: 'rec-publicacion-v3-202611100700', estado: 'pendiente' }, { id: 'rec-otro', estado: 'pendiente' }] } });
    const r = await correr(['pendiente']);
    expect(r.codigo).toBe(0);
    expect(r.out.trim()).toBe('rec-publicacion-v3-202611100700');
    expect(visto).toHaveLength(1);
    expect(visto[0]).toMatchObject({ metodo: 'GET', url: `/api/sitio/v1/reconstrucciones?tenantId=${TENANT}&estado=pendiente`, cuerpo: '', firmaOk: true });
    sinSecreto(r);
  });

  it('sin trabajos no imprime nada', async () => {
    responder = () => ({ estado: 200, json: { trabajos: [] } });
    const r = await correr(['pendiente']);
    expect(r.codigo).toBe(0);
    expect(r.out).toBe('');
  });

  it('401 por secreto equivocado sale con error y sin filtrar secretos', async () => {
    const r = await correr(['pendiente'], { SITIO_RECONSTRUCCION_SECRETO: 'otro-secreto-distinto-123456' });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain('401');
    sinSecreto(r);
    expect(r.out + r.err).not.toContain('otro-secreto-distinto-123456');
  });
});

describe('contenido-sitio estado', () => {
  it('POST firmado con el cuerpo exacto', async () => {
    responder = () => ({ estado: 200, json: { id: 'rec-a', estado: 'en_curso' } });
    const r = await correr(['estado', 'rec-a', 'en_curso']);
    expect(r.codigo).toBe(0);
    expect(visto[0]).toMatchObject({
      metodo: 'POST', url: '/api/sitio/v1/reconstrucciones/rec-a/estado', cuerpo: JSON.stringify({ tenantId: TENANT, estado: 'en_curso' }), firmaOk: true,
    });
    sinSecreto(r);
  });

  it('409 sale con código 3', async () => {
    responder = () => ({ estado: 409, json: { error: 'transicion_no_permitida' } });
    const r = await correr(['estado', 'rec-a', 'en_curso']);
    expect(r.codigo).toBe(3);
  });

  it('404 y 503 fallan; repetido se avisa', async () => {
    responder = () => ({ estado: 404, json: {} });
    const a = await correr(['estado', 'rec-a', 'completada']);
    expect(a.codigo).toBe(1);
    expect(a.err).toContain('404');
    responder = () => ({ estado: 503, json: { error: 'no_configurado' } });
    const b = await correr(['estado', 'rec-a', 'completada']);
    expect(b.codigo).toBe(1);
    expect(b.err).toContain('503');
    responder = () => ({ estado: 200, json: { id: 'rec-a', estado: 'completada', repetido: true } });
    const c = await correr(['estado', 'rec-a', 'completada']);
    expect(c.codigo).toBe(0);
    expect(c.out).toContain('repetido');
  });

  it('estado o id inválidos no llaman al servidor', async () => {
    expect((await correr(['estado', 'rec-a', 'pendiente'])).codigo).toBe(2);
    expect((await correr(['estado', '../x', 'fallida'])).codigo).toBe(2);
    expect(visto).toHaveLength(0);
  });
});

describe('contenido-sitio entradas', () => {
  it('tenant inválido y SITIO_URL no https salen con código 2 sin llamar', async () => {
    expect((await correr(['pendiente'], { TENANT_ID: 'Tienda/../x' })).codigo).toBe(2);
    expect((await correr(['pendiente'], { SITIO_URL: 'http://sitio.ejemplo.invalid' })).codigo).toBe(2);
    expect((await correr(['pendiente'], { SITIO_URL: 'ftp://sitio.ejemplo.invalid' })).codigo).toBe(2);
    expect((await correr(['pendiente'], { SITIO_RECONSTRUCCION_SECRETO: '' })).codigo).toBe(2);
    expect(visto).toHaveLength(0);
  });

  it('uso incorrecto', async () => {
    expect((await correr([])).codigo).toBe(2);
    expect((await correr(['generar'])).codigo).toBe(2);
  });
});

describe('contenido-sitio generar', () => {
  const IDS = ['p-uno', 'p-dos'];
  const servir = (v: Visto) => {
    if (v.url.startsWith('/api/sitio/v1/publicado')) return { estado: 200, json: publicado(IDS) };
    if (v.url.startsWith('/api/disponibilidad')) return { estado: 200, json: { disponibilidad: { 'p-uno': 'disponible', 'p-dos': 'agotado' } } };
    return { estado: 404, json: {} };
  };

  it('escribe el contenido validado, con disponibilidad y sin esEjemplo', async () => {
    responder = servir;
    const salida = join(tmp, 'sub', 'publicado.json');
    const r = await correr(['generar', '--salida', salida]);
    expect(r.err).toContain('sin bloque de App Check');
    expect(r.codigo).toBe(0);
    expect(r.out).toContain('2 productos');
    const c = JSON.parse(readFileSync(salida, 'utf8')) as { config: { esEjemplo: boolean }; productos: { id: string; disponible: boolean }[] };
    expect(validarContenido(c).ok).toBe(true);
    expect(c.config.esEjemplo).toBe(false);
    expect(Object.fromEntries(c.productos.map((p) => [p.id, p.disponible]))).toEqual({ 'p-uno': true, 'p-dos': false });
    expect(visto.find((v) => v.url.startsWith('/api/sitio/v1/publicado'))).toMatchObject({ url: `/api/sitio/v1/publicado?tenantId=${TENANT}`, firmaOk: true });
    const disp = visto.find((v) => v.url.startsWith('/api/disponibilidad'));
    expect(disp?.url).toBe('/api/disponibilidad?ids=p-uno,p-dos');
    sinSecreto(r);
    expect(r.out + r.err).not.toContain('Producto p-uno');
  });

  it('consulta la disponibilidad en lotes de 50', async () => {
    const muchos = Array.from({ length: 120 }, (_, i) => `p-${String(i).padStart(3, '0')}`);
    responder = (v) => (v.url.startsWith('/api/sitio/v1/publicado') ? { estado: 200, json: publicado(muchos) } : { estado: 200, json: { disponibilidad: {} } });
    const r = await correr(['generar', '--salida', join(tmp, 'lotes.json')]);
    const lotes = visto.filter((v) => v.url.startsWith('/api/disponibilidad')).map((v) => v.url.split('=')[1]!.split(',').length);
    expect(lotes).toEqual([50, 50, 20]);
    expect(r.codigo).toBe(0);
    sinSecreto(r);
  });

  it('negocio inválido falla nombrando campos, sin escribir el archivo', async () => {
    responder = servir;
    const salida = join(tmp, 'no.json');
    const r = await correr(['generar', '--salida', salida], { SITIO_NEGOCIO: JSON.stringify({ ...negocio, mercados: [] }) });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain('negocio.mercados');
    expect(() => readFileSync(salida)).toThrow();
  });

  it('disponibilidad 500 o 429 falla', async () => {
    for (const estado of [500, 429]) {
      responder = (v) => (v.url.startsWith('/api/sitio/v1/publicado') ? { estado: 200, json: publicado(IDS) } : { estado, json: {} });
      const r = await correr(['generar', '--salida', join(tmp, 'd.json')]);
      expect(r.codigo).toBe(1);
      expect(r.err).toContain(String(estado));
    }
  });

  it('contenido inválido: conteo y rutas sin ids de producto', async () => {
    const p = publicado(['p-secreto']);
    delete ((p.documentos as Record<string, unknown>)['producto__p-secreto'] as Record<string, unknown>)['marca'];
    responder = (v) => (v.url.startsWith('/api/sitio/v1/publicado') ? { estado: 200, json: p } : { estado: 200, json: { disponibilidad: {} } });
    const r = await correr(['generar', '--salida', join(tmp, 'i.json')]);
    expect(r.codigo).toBe(1);
    expect(r.err).toMatch(/\(\d+ errores\)/);
    expect(r.err).toContain('documentos.producto__*.marca');
    expect(r.err).not.toContain('p-secreto');
  });

  it('descarta ids no válidos con aviso de conteo y reemplaza un archivo previo con modo 0600', async () => {
    const p = publicado(['p-uno']);
    (p.documentos as Record<string, unknown>)['producto__MAL ID'] = prod('p-dos');
    responder = (v) => (v.url.startsWith('/api/sitio/v1/publicado') ? { estado: 200, json: p } : { estado: 200, json: { disponibilidad: {} } });
    const salida = join(tmp, 'previo.json');
    writeFileSync(salida, 'viejo', { mode: 0o644 });
    const r = await correr(['generar', '--salida', salida]);
    expect(r.err).toContain('1 productos con identificador no válido');
    expect(r.err + r.out).not.toContain('MAL ID');
    expect(statSync(salida).mode & 0o777).toBe(0o600);
  });

  it('http://localhost sin NODE_ENV=test se rechaza', async () => {
    expect((await correr(['pendiente'], { NODE_ENV: 'production' })).codigo).toBe(2);
  });

  it('App Check incompleto es entrada inválida', async () => {
    const r = await correr(['generar', '--salida', join(tmp, 'x.json')], { SITIO_APPCHECK_CLAVE_SITIO: 'clave-publica-de-ejemplo' });
    expect(r.codigo).toBe(2);
  });

  it('401 en publicado falla sin filtrar el secreto', async () => {
    const r = await correr(['generar', '--salida', join(tmp, 'y.json')], { SITIO_RECONSTRUCCION_SECRETO: 'secreto-equivocado-abcdef012345' });
    expect(r.codigo).toBe(1);
    expect(r.out + r.err).not.toContain('secreto-equivocado-abcdef012345');
  });
});
