// scripts/certificar-sitio.mjs contra un servidor HTTP local que sirve un sitio sintético con el mismo formato que el sitio compilado.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { calcularFirma, verificarFirma } from '@novutienda/nucleo/servidor';
import { versionContenido } from '../../plataforma/registro.js';
import {
  armarResumen, armarSalida, codigoDe, atributos, compararCotizacion, compararFicha, compararIndice, compararPortada, compararVersion, configCliente, decodificarEntidades,
  ejecutar, etiquetas, islasDe, jsonLdDe, metaFicha, primerH1, textoPlano, comprobacion, cerrar,
} from '../../scripts/certificar-sitio.mjs';

const SECRETO = 's'.repeat(24);
const TENANT = 'tienda-secreta-t';
const ORIGEN = 'https://sitio-privado.example.com';
const NOMBRES = ['Producto Zeta & "Uno" <b>', "Producto Zeta d'Dos", 'Producto Zeta Tres'];
const IDS = ['zz-cod-uno', 'zz-cod-dos', 'zz-cod-tres'];
const SLUGS = ['slug-privado-uno', 'slug-privado-dos', 'slug-privado-tres'];
const SECCION = 'seccion-privada';
const PRIVADOS = [TENANT, ORIGEN, 'sitio-privado', SECRETO, ...NOMBRES.map((n) => n.slice(0, 14)), ...IDS, ...SLUGS, SECCION, 'Zeta'];

interface ProductoT { id: string; slug: string; nombre: string; precioUsd: { BO: number; AR: number }; disponible: boolean }
interface ContenidoT {
  config: { plantilla: string; whatsappNovuchat: string | null; mercados: string[]; mercadoInicial: string; redondeo: unknown };
  productos: ProductoT[];
  secciones: { slug: string; titulo: string }[];
  publicacion: { version: number; publicadoEn: string };
}
const REDONDEO = { BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' }, ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'arriba' } };

const armar = (viva: Record<string, boolean>): ContenidoT => ({
  config: { plantilla: 'cielo', whatsappNovuchat: '59100000009', mercados: ['BO', 'AR'], mercadoInicial: 'BO', redondeo: REDONDEO },
  productos: IDS.map((id, i) => ({ id, slug: SLUGS[i]!, nombre: NOMBRES[i]!, precioUsd: { BO: 100 + i, AR: i === 2 ? 0 : 120 + i }, disponible: viva[id] === true })),
  secciones: [{ slug: SECCION, titulo: 'Sección privada' }],
  publicacion: { version: 7, publicadoEn: '2026-01-02T03:04:05.000Z' },
});

// ---- renderizado sintético con el formato real (entidades HTML, props de isla en formato Astro, JSON-LD seguro) ----
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const enc = (v: unknown): unknown => (Array.isArray(v) ? [1, v.map(enc)] : v !== null && typeof v === 'object' ? [0, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)]))] : [0, v]);
const props = (o: Record<string, unknown>) => esc(JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]))));
const ldSeguro = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function paginaFicha(p: ProductoT, c: ContenidoT): string {
  const ofertas = c.config.mercados.filter((m) => (p.precioUsd as Record<string, number>)[m]! > 0).map((m) => ({ '@type': 'Offer', price: (p.precioUsd as Record<string, number>)[m]!.toFixed(2), priceCurrency: 'USD', eligibleRegion: { '@type': 'Country', name: m } }));
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.nombre, sku: p.id, ...(ofertas.length > 0 ? { offers: ofertas } : {}) };
  return `<!doctype html><html lang="es" data-plantilla="${c.config.plantilla}"><head><title>x</title>
<script is:inline type="application/json" id="cb-config">${ldSeguro({ nombre: 'N', mercados: c.config.mercados, redondeo: c.config.redondeo, whatsappNovuchat: c.config.whatsappNovuchat })}</script>
<script type="application/ld+json">${ldSeguro(ld)}</script></head><body><main>
<h1>${esc(p.nombre)}</h1><p class="ficha-meta"><span>Marca: <strong>M</strong></span><span>Código: <strong>${esc(p.id)}</strong></span></p>
<astro-island uid="a" component-url="/_astro/Precio.AbC123.js" component-export="default" props="${props({ usd: p.precioUsd, inicial: c.config.mercadoInicial, mercados: c.config.mercados, redondeo: c.config.redondeo })}" client="load"></astro-island>
<astro-island uid="b" component-url="/_astro/BotonComprar.Zz9.js" component-export="default" props="${props({ id: p.id, nombre: p.nombre, disponible: p.disponible, whatsapp: c.config.whatsappNovuchat, verificar: true })}" client="load"></astro-island>
</main></body></html>`;
}
const paginaPortada = (c: ContenidoT): string => paginaFicha(c.productos[0]!, c).replace(/<h1>[\s\S]*<\/h1>/, '<h1>Portada</h1>');

// ---- servidor ----
interface Modo {
  /** Contenido que pinta el HTML (puede diferir del publicado). */
  html: ContenidoT;
  /** Contenido con el que se calculó la versión servida. */
  version: ContenidoT;
  versionEstado?: number | undefined;
  versionAjuste?: ((v: Record<string, unknown>) => Record<string, unknown>) | undefined;
  sinFicha?: number | undefined;
  sinIndiceId?: string | undefined;
  cotizacion: 'vigente' | 'ultimo_verificado' | 'ausente';
  viva: Record<string, boolean>;
  vivaOmitir?: string[] | undefined;
  vivaSinMapa?: boolean | undefined;
  sinBoton?: boolean | undefined;
}
let peticionesFichas = 0;
let peticionesIndice = 0;
let modo: Modo;
let servidor: Server;
let url = '';
let peticionesPublicado = 0;
const leer = (req: IncomingMessage) => new Promise<string>((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => ok(t)); });
const VIVA_INICIAL = { [IDS[0]!]: true, [IDS[1]!]: false, [IDS[2]!]: true };
const nuevoModo = (): Modo => ({ html: armar(VIVA_INICIAL), version: armar(VIVA_INICIAL), cotizacion: 'vigente', viva: { ...VIVA_INICIAL } });

beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    const cuerpo = await leer(req);
    const ruta = req.url ?? '';
    const enviar = (estado: number, tipo: string, texto: string) => { res.writeHead(estado, { 'Content-Type': tipo }); res.end(texto); };
    const json = (estado: number, o: unknown) => enviar(estado, 'application/json', JSON.stringify(o));
    if (ruta.startsWith('/api/sitio/v1/publicado')) {
      peticionesPublicado++;
      const v = verificarFirma({ secreto: SECRETO, marcaTiempo: String(req.headers['x-marca-tiempo']), firma: String(req.headers['x-firma']), cuerpo: `${req.method}\n${ruta}\n${cuerpo}`, ahoraMs: Date.now() });
      if (!v.ok) return json(401, {});
      return json(200, { documentos: Object.fromEntries(IDS.map((id) => [`producto__${id}`, {}])) });
    }
    if (ruta.startsWith('/api/disponibilidad')) {
      const ids = new URL(ruta, 'http://x').searchParams.get('ids')!.split(',').filter((i) => !(modo.vivaOmitir ?? []).includes(i));
      if (modo.vivaSinMapa === true) return json(200, {});
      return json(200, { disponibilidad: Object.fromEntries(ids.map((i) => [i, modo.viva[i] === true ? 'disponible' : 'agotado'])) });
    }
    if (ruta === '/api/cotizacion') {
      if (modo.cotizacion === 'ausente') return json(200, { cotizaciones: {} });
      const c = (par: string) => ({ cotizacionId: 'c', par, valor: 1, fecha: 'f', fuente: 'x', estado: modo.cotizacion });
      return json(200, { cotizaciones: { BO: c('USD/BOB'), AR: c('USD/ARS') } });
    }
    if (ruta === '/version-contenido.json') {
      if (modo.versionEstado !== undefined) return json(modo.versionEstado, {});
      const v = versionContenido(modo.version as never) as unknown as Record<string, unknown>;
      return json(200, modo.versionAjuste === undefined ? v : modo.versionAjuste(v));
    }
    if (ruta === '/indice-productos.json') {
      peticionesIndice++;
      return json(200, modo.html.productos.filter((p) => p.id !== modo.sinIndiceId).map((p) => ({ i: p.id, nombre: p.nombre, marca: 'M', categoria: 'C', ruta: `/producto/${p.slug}` })));
    }
    if (ruta === '/') return enviar(200, 'text/html', paginaPortada(modo.html));
    const m = /^\/producto\/(.+)$/.exec(ruta);
    if (m !== null) {
      peticionesFichas++;
      const i = modo.html.productos.findIndex((p) => p.slug === m[1]);
      if (i === -1 || i === modo.sinFicha) return enviar(404, 'text/html', 'no');
      {
        const h = paginaFicha(modo.html.productos[i]!, modo.html);
        return enviar(200, 'text/html', modo.sinBoton === true ? h.replace(/<astro-island uid="b"[\s\S]*?<\/astro-island>/, '') : h);
      }
    }
    if (ruta === `/seccion/${SECCION}`) return enviar(200, 'text/html', '<h1>s</h1>');
    return enviar(404, 'text/plain', 'no');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const dir = servidor.address();
  url = `http://127.0.0.1:${typeof dir === 'object' && dir !== null ? dir.port : 0}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
beforeEach(() => { modo = nuevoModo(); peticionesPublicado = 0; peticionesFichas = 0; peticionesIndice = 0; });

const fetchLocal = ((entrada: string, init?: RequestInit) => fetch(String(entrada).replace(ORIGEN, url), init)) as typeof fetch;
const red = { esperar: async () => undefined, avisar: () => undefined };
const env = { SITIO_RECONSTRUCCION_SECRETO: SECRETO, MEDIOS_BASE_URL: 'https://medios.example.com/', SITIO_NEGOCIO: '{"nombre":"N"}', NODE_ENV: 'test' };
const deps = {
  calcularFirma,
  // El mapeo sintético arma el contenido con la disponibilidad que entrega el entorno (como el real).
  mapear: (_r: unknown, _n: unknown, e: unknown) => armar((e as { disponibilidad: Record<string, boolean> }).disponibilidad),
  versionContenido: versionContenido as unknown as (c: unknown) => unknown,
};
const args = ['--tenant', TENANT, '--url', ORIGEN];
const correr = (extra: string[] = [], e: Record<string, string | undefined> = env) => ejecutar([...args, ...extra], e, deps, fetchLocal, red);
const sinPrivados = (t: string) => { for (const p of PRIVADOS) expect(t).not.toContain(p); };

describe('certificar-sitio de punta a punta', () => {
  it('todo coincide: código 0, conteos y ningún dato del caso', async () => {
    const r = await correr();
    expect(r.error).toBeUndefined();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('fichas verificadas: 3');
    expect(r.salida).toContain('huella: ok');
    expect(r.salida).toContain('certificación: correcta (0 comprobaciones con avisos)');
    sinPrivados(JSON.stringify(r));
  });
  it('un precio distinto en el HTML: código 1, nombra la comprobación y el producto por posición, sin valores', async () => {
    modo.html.productos[1]!.precioUsd.BO = 98765;
    const r = await correr();
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/diferencias: 1 en fichas\.precioUsd \(producto #2\)/);
    expect(r.salida).toMatch(/diferencias: 1 en fichas\.jsonld\.precio/);
    expect(r.salida).not.toContain('98765');
    sinPrivados(JSON.stringify(r));
  });
  it('una ficha que falta: código 1 (ficha 404 e índice sin ella)', async () => {
    modo.sinFicha = 2;
    modo.sinIndiceId = IDS[2];
    const r = await correr();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('diferencias: 1 en fichas.estado (producto #3)');
    expect(r.salida).toContain('diferencias: 1 en indice.faltan');
    sinPrivados(JSON.stringify(r));
  });
  it('version-contenido.json 404: código 1 con el motivo claro', async () => {
    modo.versionEstado = 404;
    const r = await correr();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('el sitio desplegado es anterior al verificador');
    modo.versionEstado = undefined;
    modo.versionAjuste = (v) => ({ ...v, esquema: 1 });
    const r2 = await correr();
    expect(r2.codigo).toBe(1);
    expect(r2.salida).toContain('anterior al verificador');
  });
  it('contenido distinto en la versión (huellaSinDisponibilidad): error firme', async () => {
    modo.version.productos[0]!.nombre = 'otro';
    const r = await correr();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('diferencias: 1 en huella.huellaSinDisponibilidad');
  });
  it('huella distinta con huellaSinDisponibilidad igual: código 0 con aviso', async () => {
    modo.versionAjuste = (v) => ({ ...v, huella: 'a'.repeat(64) });
    const r = await correr();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('huella: aviso');
    expect(r.salida).toContain('aviso: huella.disponibilidad-cambio-desde-el-build');
  });
  it('la disponibilidad del HTML estático difiere de la viva: aviso con conteo, código 0', async () => {
    modo.html.productos[0]!.disponible = false; // el build vio otra cosa; la huella sin disponibilidad no cambia
    modo.version.productos[0]!.disponible = false;
    const r = await correr();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('aviso: 1 en disponibilidad.html-estatico-vs-viva');
    expect(r.salida).toContain('fichas con disponibilidad distinta de la viva: 1');
  });
  it('cotización ultimo_verificado: código 0 con aviso; ausente: error firme', async () => {
    modo.cotizacion = 'ultimo_verificado';
    const r = await correr();
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('cotizacion: aviso');
    expect(r.salida).toContain('ultimo_verificado.BO');
    modo.cotizacion = 'ausente';
    const r2 = await correr();
    expect(r2.codigo).toBe(1);
    expect(r2.salida).toContain('diferencias: 1 en cotizacion.estado.BO');
  });
  it('portada con otra plantilla: error en portada.plantilla; sección que no responde: error', async () => {
    modo.html.config.plantilla = 'noche';
    const r = await correr();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('diferencias: 1 en portada.plantilla');
    modo = nuevoModo();
    modo.html.secciones = [];
    const servidorSinRuta = ((e: string, i?: RequestInit) => fetchLocal(String(e).replace(`/seccion/${SECCION}`, '/seccion/inexistente'), i)) as typeof fetch;
    const r2 = await ejecutar(args, env, deps, servidorSinRuta, red);
    expect(r2.codigo).toBe(1);
    expect(r2.salida).toContain('diferencias: 1 en secciones.estado');
  });
  it('--resumen escribe una tabla en Markdown sin valores; GITHUB_STEP_SUMMARY se usa si no hay --resumen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'certificar-sitio-'));
    try {
      modo.html.productos[0]!.precioUsd.AR = 55555;
      const ruta = join(dir, 'resumen.md');
      const r = await correr(['--resumen', ruta]);
      expect(r.codigo).toBe(1);
      const md = readFileSync(ruta, 'utf8');
      expect(md).toContain('| Comprobación | Resultado | Conteos |');
      expect(md).toContain('| fichas | error |');
      expect(md).not.toContain('55555');
      sinPrivados(md);
      const paso = join(dir, 'paso.md');
      modo = nuevoModo();
      expect((await correr([], { ...env, GITHUB_STEP_SUMMARY: paso })).codigo).toBe(0);
      expect(readFileSync(paso, 'utf8')).toContain('Certificación del sitio: correcta');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('uso inválido: código 2 sin --tenant o con url no https; sin secreto: código 3 (operación)', async () => {
    expect((await ejecutar(['--url', ORIGEN], env, deps, fetchLocal, red)).codigo).toBe(2);
    expect((await ejecutar(['--tenant', TENANT, '--url', 'http://otro.example.com'], { ...env, NODE_ENV: 'production' }, deps, fetchLocal, red)).codigo).toBe(2);
    expect((await ejecutar(['--tenant', 'No Válido!', '--url', ORIGEN], env, deps, fetchLocal, red)).codigo).toBe(2);
    const sinSecreto = await correr([], { ...env, SITIO_RECONSTRUCCION_SECRETO: '' });
    expect(sinSecreto.error).toBe('falta SITIO_RECONSTRUCCION_SECRETO');
    expect(sinSecreto.codigo).toBe(3);
  });
  it('fallo al regenerar el contenido o excepción inesperada: código 3', async () => {
    const r = await correr([], { ...env, SITIO_NEGOCIO: 'no es json' });
    expect(r.codigo).toBe(3);
    const rompe = { ...deps, mapear: () => { throw new TypeError('boom'); } };
    const r2 = await ejecutar(args, env, rompe as never, fetchLocal, red);
    expect(r2.codigo).toBe(3);
    sinPrivados(JSON.stringify([r, r2]));
  });
  it('el sitio caído: código 3 y no revela la URL', async () => {
    const caido = (() => Promise.reject(new Error(`fallo en ${ORIGEN}`))) as typeof fetch;
    const r = await ejecutar(args, env, deps, caido, red);
    expect(r.codigo).toBe(3);
    sinPrivados(JSON.stringify(r));
  });
});

describe('certificar-sitio: separación de códigos, corte temprano y sin falsos verdes', () => {
  const archivo = (c: unknown): string => {
    const d = mkdtempSync(join(tmpdir(), 'cert-cod-'));
    const ruta = join(d, 'contenido.json');
    writeFileSync(ruta, JSON.stringify(c));
    return ruta;
  };
  const sinSecreto = { NODE_ENV: 'test' };
  const conBuild = (extra: string[] = [], c: unknown = armar(VIVA_INICIAL)) => correr(['--contenido', archivo(c), ...extra], sinSecreto);

  it('version-contenido.json con 5xx: código 3 sin visitar fichas ni índice; con 404: código 1', async () => {
    for (const estado of [500, 503]) {
      modo.versionEstado = estado;
      peticionesFichas = 0;
      peticionesIndice = 0;
      const r = await conBuild();
      expect(r.codigo).toBe(3);
      expect(r.salida).toBeUndefined();
      expect(peticionesFichas).toBe(0);
      expect(peticionesIndice).toBe(0);
      sinPrivados(JSON.stringify(r));
    }
    modo.versionEstado = 404;
    expect((await conBuild()).codigo).toBe(1);
  });
  it('error de red en version-contenido.json: código 3 sin visitar fichas', async () => {
    const cae = ((e: string, i?: RequestInit) => (String(e).endsWith('/version-contenido.json') ? Promise.reject(new Error(`fallo ${ORIGEN}`)) : fetchLocal(e, i))) as typeof fetch;
    const r = await ejecutar([...args, '--contenido', archivo(armar(VIVA_INICIAL))], sinSecreto, deps, cae, red);
    expect(r.codigo).toBe(3);
    expect(peticionesFichas).toBe(0);
    sinPrivados(JSON.stringify(r));
  });
  it('disponibilidad viva ilegible: código 3 (no se pudo comparar), no 1', async () => {
    const cae = ((e: string, i?: RequestInit) => (String(e).includes('/api/disponibilidad') ? Promise.reject(new Error('x')) : fetchLocal(e, i))) as typeof fetch;
    const r = await ejecutar([...args, '--contenido', archivo(armar(VIVA_INICIAL))], sinSecreto, deps, cae, red);
    expect(r.codigo).toBe(3);
    expect(r.salida).toContain('NO CONCLUYENTE');
    // Con una diferencia firme además, manda el 1.
    modo.html.productos[0]!.precioUsd.BO = 98765;
    const r2 = await ejecutar([...args, '--contenido', archivo(armar(VIVA_INICIAL))], sinSecreto, deps, cae, red);
    expect(r2.codigo).toBe(1);
  });
  it('diferencias firmes: código 1', async () => {
    modo.html.productos[0]!.precioUsd.BO = 98765;
    expect((await conBuild()).codigo).toBe(1);
  });
  it('falta la isla del botón de compra: diferencia firme fichas.isla-boton', async () => {
    modo.sinBoton = true;
    const r = await conBuild();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('diferencias: 3 en fichas.isla-boton (producto #1, #2, #3)');
    sinPrivados(JSON.stringify(r));
  });
  it('compararFicha: botón sin prop disponible booleana también es isla-boton; precio y JSON-LD ausentes ya lo eran', () => {
    const p: ProductoT = { id: 'zz-1', slug: 'zz', nombre: 'A', precioUsd: { BO: 10, AR: 0 }, disponible: true };
    const c = armar({});
    const html = paginaFicha(p, c).replace('&quot;disponible&quot;:[0,true]', '&quot;otra&quot;:[0,true]');
    expect(html).not.toBe(paginaFicha(p, c));
    expect(compararFicha(p, c.config, html).campos).toEqual(['isla-boton']);
  });
  it('la respuesta viva sin algún id pedido o sin mapa: diferencia firme ids-ausentes (no «agotado»)', async () => {
    modo.vivaOmitir = [IDS[1]!];
    const r = await conBuild();
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('diferencias: 1 en disponibilidad.ids-ausentes');
    expect(r.salida).not.toContain('contenido-regenerado-vs-viva');
    modo.vivaOmitir = undefined;
    modo.vivaSinMapa = true;
    const r2 = await conBuild();
    expect(r2.codigo).toBe(1);
    expect(r2.salida).toContain('diferencias: 3 en disponibilidad.ids-ausentes');
    sinPrivados(JSON.stringify([r, r2]));
  });
  it('0 productos: aviso «0 fichas», no error por sí mismo', async () => {
    const vacio = armar(VIVA_INICIAL);
    vacio.productos = [];
    modo.version = { ...modo.version, productos: [] };
    const r = await conBuild([], vacio);
    expect(r.salida).toContain('fichas: aviso');
    expect(r.salida).toContain('aviso: fichas.0 fichas');
  });
  it('--contenido sin valor (último o seguido de otra bandera): código 2, no cae al modo regenerado', async () => {
    const a = await correr(['--contenido']);
    const b = await correr(['--contenido', '--resumen', 'x.md']);
    for (const r of [a, b]) {
      expect(r.codigo).toBe(2);
      expect(r.error).toContain('--contenido');
    }
    expect(peticionesPublicado).toBe(0);
    expect((await correr(['--resumen'])).codigo).toBe(2);
  });
  it('--contenido con config.esEjemplo: código 2 con motivo claro y sin llamar al sitio', async () => {
    const ej = armar(VIVA_INICIAL) as unknown as { config: Record<string, unknown> };
    ej.config['esEjemplo'] = true;
    const r = await conBuild([], ej);
    expect(r.codigo).toBe(2);
    expect(r.error).toContain('ejemplo');
    expect(peticionesFichas).toBe(0);
    expect(peticionesPublicado).toBe(0);
  });
  it('codigoDe y el resumen: 0, 1 y 3', () => {
    const lectura = cerrar({ ...comprobacion('cotizacion'), motivo: 'x', operacion: true });
    const firme = cerrar({ ...comprobacion('fichas'), diferencias: [{ campo: 'h1', n: 1 }] });
    const ok = cerrar(comprobacion('huella'));
    expect([codigoDe([ok]), codigoDe([ok, lectura]), codigoDe([lectura, firme])]).toEqual([0, 3, 1]);
    expect(armarResumen([ok, lectura])).toContain('NO CONCLUYENTE');
  });
});

describe('certificar-sitio con --contenido (referencia: el build)', () => {
  const sinSecreto = { NODE_ENV: 'test' };
  const archivo = (c: unknown, crudo?: string): string => {
    const d = mkdtempSync(join(tmpdir(), 'cert-cont-'));
    const ruta = join(d, 'contenido.json');
    writeFileSync(ruta, crudo ?? `${JSON.stringify(c)}\n`);
    return ruta;
  };
  it('sitio coherente: código 0, cero peticiones a publicado, sin secreto ni negocio, y dice la referencia', async () => {
    const ruta = archivo(armar(VIVA_INICIAL));
    const r = await correr(['--contenido', ruta], sinSecreto);
    expect(r.error).toBeUndefined();
    expect(r.codigo).toBe(0);
    expect(peticionesPublicado).toBe(0);
    expect(r.salida).toContain('referencia: contenido del build');
    expect(r.salida).toContain('huella: ok');
    rmSync(ruta, { force: true });
  });
  it('un precio distinto en el HTML: código 1', async () => {
    const ruta = archivo(armar(VIVA_INICIAL));
    const otro = armar(VIVA_INICIAL);
    otro.productos[0]!.precioUsd = { BO: 999, AR: 888 };
    modo.html = otro;
    const r = await correr(['--contenido', ruta], sinSecreto);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('fichas');
    expect(peticionesPublicado).toBe(0);
  });
  it('archivo inexistente, JSON inválido o sin forma: código 2 sin ruta ni contenido', async () => {
    const ausente = join(tmpdir(), 'no-existe-cert', 'x.json');
    for (const ruta of [ausente, archivo(null, '{no es json SECRETO-X'), archivo({ config: {} })]) {
      const r = await correr(['--contenido', ruta], sinSecreto);
      expect(r.codigo).toBe(2);
      expect(r.error).toContain('--contenido');
      expect(r.error).not.toContain(ruta);
      expect(r.error).not.toContain('SECRETO-X');
    }
    expect(peticionesPublicado).toBe(0);
  });
  it('sin --contenido regenera desde publicado y lo dice', async () => {
    const r = await correr();
    expect(r.codigo).toBe(0);
    expect(peticionesPublicado).toBeGreaterThan(0);
    expect(r.salida).toContain('referencia: contenido regenerado desde lo publicado');
  });
});

describe('extractores y comparadores puros', () => {
  const p: ProductoT = { id: 'zz-1', slug: 'zz', nombre: 'Aire "A" & Co', precioUsd: { BO: 10, AR: 0 }, disponible: true };
  const c = armar({});
  it('decodifican entidades y leen h1, código, islas, JSON-LD y cb-config de una página con el formato real', () => {
    const html = paginaFicha(p, c);
    expect(decodificarEntidades('&amp;&lt;&quot;&#39;&#x41;&nbsp;&desconocida;&#99999999;')).toBe('&<"\'A\u00a0&desconocida;&#99999999;');
    expect(primerH1(html)).toBe('Aire "A" & Co');
    expect(metaFicha(html)).toBe('Marca: MCódigo: zz-1');
    const islas = islasDe(html);
    expect(islas.map((i) => i.componente)).toEqual(['Precio', 'BotonComprar']);
    expect(islas[0]!.props['usd']).toEqual({ BO: 10, AR: 0 });
    expect(islas[0]!.props['mercados']).toEqual(['BO', 'AR']);
    expect(jsonLdDe(html)[0]!['name']).toBe('Aire "A" & Co');
    expect(configCliente(html)!['whatsappNovuchat']).toBe('59100000009');
    expect(compararFicha(p, c.config, html)).toEqual({ campos: [], disponibleHtml: true });
    expect(compararPortada(c.config, html)).toEqual([]);
  });
  it('detectan cada diferencia con el nombre del campo', () => {
    expect(compararFicha({ ...p, nombre: 'Otro' }, c.config, paginaFicha(p, c)).campos).toEqual(['h1', 'jsonld.nombre']);
    expect(compararFicha({ ...p, id: 'zz-2' }, c.config, paginaFicha(p, c)).campos).toContain('codigo');
    expect(compararFicha(p, { ...c.config, redondeo: {} }, paginaFicha(p, c)).campos).toEqual(['redondeo']);
    expect(compararFicha(p, c.config, '<html></html>').campos).toEqual(['h1', 'codigo', 'isla-precio', 'isla-boton', 'jsonld']);
    expect(compararPortada({ ...c.config, whatsappNovuchat: null }, paginaFicha(p, c))).toEqual(['whatsappNovuchat']);
    expect(compararPortada(c.config, '<html></html>')).toEqual(['plantilla', 'cb-config']);
    expect(compararIndice([p], [{ i: 'zz-1', nombre: 'x', ruta: '/producto/otro' }, { i: 'extra' }, 3])).toEqual({ campos: { formato: 1, ruta: 1, nombre: 1, sobran: 1 } });
    expect(compararIndice([p], 'no')).toEqual({ campos: { formato: 1 } });
    expect(compararCotizacion(['BO', 'AR'], { cotizaciones: { BO: { estado: 'vigente' } } })).toEqual({ diferencias: ['estado.AR'], avisos: [] });
    expect(compararCotizacion(['BO'], null)).toEqual({ diferencias: ['estado.BO'], avisos: [] });
  });
  it('compararVersion: esquema, campos y aviso de huella', () => {
    const esperada = { esquema: 2, version: 1, publicadoEn: 'x', productos: 1, secciones: 0, huella: 'h', huellaSinDisponibilidad: 'g' };
    expect(compararVersion(esperada, esperada)).toEqual({ errores: [], avisos: [] });
    expect(compararVersion(esperada, { ...esperada, huella: 'z' })).toEqual({ errores: [], avisos: ['huella'] });
    expect(compararVersion(esperada, { ...esperada, version: 2, productos: 3 }).errores).toEqual(['version', 'productos']);
    expect(compararVersion(esperada, { ...esperada, esquema: 1 }).motivo).toContain('anterior al verificador');
    expect(compararVersion(esperada, null).errores).toEqual(['respuesta']);
  });
  it('el informe usa solo nombres y conteos', () => {
    const a = cerrar({ ...comprobacion('fichas'), conteos: { 'fichas verificadas': 12 }, diferencias: [{ campo: 'precioUsd', n: 12, posiciones: Array.from({ length: 12 }, (_, i) => i + 1) } as never] });
    const b = cerrar({ ...comprobacion('huella'), avisos: [{ campo: 'x', n: 2 }] });
    const salida = armarSalida([a, b]);
    expect(salida).toContain('diferencias: 12 en fichas.precioUsd (producto #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, …)');
    expect(salida).toContain('certificación: FALLÓ (1 comprobaciones con diferencias, 1 con avisos)');
    expect(armarResumen([a, b])).toContain('| huella | aviso |');
  });
  it('HTML hostil y largo termina rápido y sin colgarse', () => {
    const casos = [
      '<script '.repeat(150_000),
      '<h1'.repeat(300_000),
      `<astro-island props="${'&quot;'.repeat(400_000)}`,
      `<p class="ficha-meta">${'<'.repeat(500_000)}`,
      `<script type="application/ld+json">${'{'.repeat(500_000)}`,
      `<a ${'x="y" '.repeat(100_000)}>`,
      `<html ${'a='.repeat(200_000)}>`,
      '<'.repeat(1_000_000),
      `<h1>${'&amp'.repeat(300_000)}</h1>`,
      `<script id="cb-config">${'\n'.repeat(1_000_000)}`,
    ];
    const t0 = Date.now();
    for (const html of casos) {
      primerH1(html); metaFicha(html); islasDe(html); jsonLdDe(html); configCliente(html); compararPortada(c.config, html); compararFicha(p, c.config, html);
      etiquetas(html, 'p'); textoPlano(html); atributos(html.slice(0, 300_000));
    }
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
