import { describe, expect, it } from 'vitest';
import { SinCotizacionUtilizable, type AlmacenCotizaciones, type CopiaCotizacion } from '@novutienda/nucleo';
import { manejarContacto, validarContacto, type DepsContacto, type PeticionContacto } from './contacto.js';
import { lectorCotizacion, manejarCotizacionSitio } from './cotizacion.js';
import { manejarDisponibilidad } from './disponibilidad.js';
import { limpiarTexto } from './http.js';
import { limiteMemoria } from './limite-tasa.js';
import { despacharApi, RUTAS_API, type DepsApi } from './router.js';

describe('GET /api/disponibilidad', () => {
  const leer = (datos: Record<string, boolean>) => (ids: readonly string[]): Promise<Record<string, boolean>> =>
    Promise.resolve(Object.fromEntries(ids.filter((i) => i in datos).map((i) => [i, datos[i] as boolean])));

  it('responde solo disponible o agotado, nunca cantidades, y omite los desconocidos', async () => {
    // El lector podría devolver más de lo debido: el handler solo emite el estado.
    const fuga = (): Promise<Record<string, boolean>> => Promise.resolve({ 'tv-1': true, 'tv-2': false, 'tv-3': 7 as unknown as boolean });
    const r = await manejarDisponibilidad({ metodo: 'GET', ids: 'tv-1,tv-2,tv-3,tv-4' }, fuga);
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ disponibilidad: { 'tv-1': 'disponible', 'tv-2': 'agotado' } });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/\d{2,}|cantidad|stock/);
    expect(r.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=60');
  });
  it('valida método, ids, cantidad y errores del lector', async () => {
    const l = leer({});
    expect((await manejarDisponibilidad({ metodo: 'POST', ids: 'a-b' }, l)).status).toBe(405);
    expect((await manejarDisponibilidad({ metodo: 'GET' }, l)).status).toBe(400);
    expect((await manejarDisponibilidad({ metodo: 'GET', ids: ' , ' }, l)).status).toBe(400);
    expect((await manejarDisponibilidad({ metodo: 'GET', ids: 'A B' }, l)).status).toBe(400);
    expect((await manejarDisponibilidad({ metodo: 'GET', ids: '../etc' }, l)).status).toBe(400);
    const muchos = Array.from({ length: 51 }, (_, i) => `p-${i + 10}`).join(',');
    expect((await manejarDisponibilidad({ metodo: 'GET', ids: muchos }, l)).status).toBe(400);
    const caido = await manejarDisponibilidad({ metodo: 'GET', ids: 'tv-1' }, () => Promise.reject(new Error('detalle interno')));
    expect(caido.status).toBe(503);
    expect(JSON.stringify(caido.cuerpo)).not.toContain('interno');
  });
});

describe('POST /api/contacto', () => {
  const valido = {
    envioId: 'envio_1234567890abcd', nombre: 'Ana Pérez', correo: 'ana@ejemplo.invalid', telefono: '', mensaje: 'Quisiera saber el precio.',
    pais: 'BO', productoId: 'tv-1', aceptaPrivacidad: true, recaptchaToken: 'x'.repeat(40), sitioWeb: '',
  };
  const guardados: unknown[] = [];
  let usosRecaptcha = 0;
  function deps(sobre: Partial<DepsContacto> = {}, reloj = { t: 1000 }): DepsContacto {
    return {
      recaptcha: { verificar: (t, accion) => { usosRecaptcha += 1; expect(accion).toBe('contacto'); return Promise.resolve({ valido: t.startsWith('x'), puntaje: 0.9 }); } },
      appCheck: { verificar: (t) => Promise.resolve(t === 'token-bueno') },
      limite: limiteMemoria(3, 60_000),
      almacen: { guardar: (c) => { const yaEsta = guardados.some((g) => (g as { operacionId: string }).operacionId === c.operacionId); if (!yaEsta) guardados.push(c); return Promise.resolve(yaEsta ? 'repetido' : 'creado'); } },
      ahora: () => reloj.t,
      ...sobre,
    };
  }
  const pet = (sobre: Partial<PeticionContacto> = {}): PeticionContacto => ({
    metodo: 'POST', cabeceras: { 'content-type': 'application/json', 'x-firebase-appcheck': 'token-bueno' }, cuerpo: valido, origen: 'ip-1', ...sobre,
  });

  it('guarda un contacto válido y reintentar el mismo envío no duplica nada', async () => {
    guardados.length = 0;
    const d = deps({ limite: limiteMemoria(100, 60_000) });
    const r1 = await manejarContacto(pet(), d);
    const r2 = await manejarContacto(pet(), d);
    expect(r1).toMatchObject({ status: 200, cuerpo: { ok: true, repetido: false } });
    expect(r2).toMatchObject({ status: 200, cuerpo: { ok: true, repetido: true } });
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({ nombre: 'Ana Pérez', correo: 'ana@ejemplo.invalid', telefono: null, pais: 'BO', productoId: 'tv-1' });
    expect(JSON.stringify(guardados[0])).not.toContain('recaptcha');
  });

  it('rechaza método, tipo de contenido y cuerpos enormes', async () => {
    expect((await manejarContacto(pet({ metodo: 'GET' }), deps())).status).toBe(405);
    expect((await manejarContacto(pet({ cabeceras: { 'content-type': 'text/plain' } }), deps())).status).toBe(415);
    expect((await manejarContacto(pet({ cuerpo: { ...valido, mensaje: 'a'.repeat(20_000) } }), deps())).status).toBe(413);
    const circular: Record<string, unknown> = {};
    circular['yo'] = circular;
    expect((await manejarContacto(pet({ cuerpo: circular }), deps())).status).toBe(400);
  });

  it('sin App Check válido responde 401 y no consulta reCAPTCHA ni guarda', async () => {
    guardados.length = 0;
    usosRecaptcha = 0;
    for (const cabeceras of [{ 'content-type': 'application/json' }, { 'content-type': 'application/json', 'x-firebase-appcheck': 'falso' }, { 'content-type': 'application/json', 'x-firebase-appcheck': '' }]) {
      expect((await manejarContacto(pet({ cabeceras }), deps())).status).toBe(401);
    }
    expect(usosRecaptcha).toBe(0);
    expect(guardados).toHaveLength(0);
  });

  it('límite de tasa: la cuarta petición del mismo origen recibe 429 con Retry-After', async () => {
    const d = deps();
    for (let i = 0; i < 3; i += 1) expect((await manejarContacto(pet(), d)).status).toBeLessThan(429);
    const r = await manejarContacto(pet(), d);
    expect(r.status).toBe(429);
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
    expect((await manejarContacto(pet({ origen: 'ip-2' }), d)).status).toBeLessThan(429);
  });

  it('App Check va antes del límite: las peticiones sin token válido no consumen ni consultan el límite', async () => {
    let consultas = 0;
    const base = limiteMemoria(3, 60_000);
    const d = deps({ limite: { intentar: (k, t) => { consultas += 1; return base.intentar(k, t); } } });
    for (let i = 0; i < 10; i += 1) expect((await manejarContacto(pet({ cabeceras: { 'content-type': 'application/json' } }), d)).status).toBe(401);
    expect(consultas).toBe(0);
    for (let i = 0; i < 3; i += 1) expect((await manejarContacto(pet(), d)).status).toBeLessThan(429);
    expect((await manejarContacto(pet(), d)).status).toBe(429);
  });

  it('reCAPTCHA inválido o con puntaje bajo: 403', async () => {
    expect((await manejarContacto(pet({ cuerpo: { ...valido, recaptchaToken: 'y'.repeat(40) } }), deps())).status).toBe(403);
    const bajo = deps({ recaptcha: { verificar: () => Promise.resolve({ valido: true, puntaje: 0.1 }) } });
    expect((await manejarContacto(pet(), bajo)).status).toBe(403);
    const sinPuntaje = deps({ recaptcha: { verificar: () => Promise.resolve({ valido: true, puntaje: null }) } });
    expect((await manejarContacto(pet(), sinPuntaje)).status).toBe(403);
    const exigente = deps({ puntajeMinimo: 0.95 });
    expect((await manejarContacto(pet(), exigente)).status).toBe(403);
  });

  it('la trampa para bots responde 200 sin guardar ni consultar reCAPTCHA', async () => {
    guardados.length = 0;
    usosRecaptcha = 0;
    const r = await manejarContacto(pet({ cuerpo: { ...valido, sitioWeb: 'http://spam.example' } }), deps());
    expect(r).toMatchObject({ status: 200, cuerpo: { ok: true } });
    expect(guardados).toHaveLength(0);
    expect(usosRecaptcha).toBe(0);
  });

  it('un fallo interno no filtra detalles ni datos personales', async () => {
    const roto = deps({ almacen: { guardar: () => Promise.reject(new Error('fallo con ana@ejemplo.invalid')) } });
    const r = await manejarContacto(pet(), roto);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('ana@');
  });

  it('devuelve los campos inválidos sin eco de su contenido', () => {
    const r = validarContacto({ ...valido, nombre: 'A', correo: 'no-es-correo', mensaje: 'hola', pais: 'CL', productoId: 'A B', aceptaPrivacidad: false, envioId: 'corto', recaptchaToken: 'corto' });
    expect(r.ok).toBe(false);
    expect(!r.ok && [...r.campos].sort()).toEqual(['aceptaPrivacidad', 'correo', 'envioId', 'mensaje', 'nombre', 'pais', 'productoId', 'recaptchaToken']);
    expect(validarContacto(null)).toEqual({ ok: false, campos: ['cuerpo'] });
    expect(validarContacto([])).toEqual({ ok: false, campos: ['cuerpo'] });
    const sinMedio = validarContacto({ ...valido, correo: undefined, telefono: undefined });
    expect(!sinMedio.ok && sinMedio.campos).toContain('contacto');
    expect(validarContacto({ ...valido, correo: 5, telefono: 5 }).ok).toBe(false);
    expect(validarContacto({ ...valido, correo: '', telefono: '+591 700-000' }).ok).toBe(true);
    expect(validarContacto({ ...valido, telefono: 'llamame' }).ok).toBe(false);
    expect(validarContacto({ ...valido, sitioWeb: 3 }).ok).toBe(false);
    expect(validarContacto({ ...valido, nombre: 7 }).ok).toBe(false);
  });

  it('limpia caracteres de control y respeta los saltos de línea del mensaje', () => {
    const r = validarContacto({ ...valido, nombre: 'Ana\u0000 \u0007Pérez', mensaje: 'Línea 1\nLínea 2\u001b' });
    expect(r.ok && r.datos.nombre).toBe('Ana Pérez');
    expect(r.ok && r.datos.mensaje).toBe('Línea 1\nLínea 2');
    expect(limpiarTexto('a\nb')).toBe('ab');
  });
});

describe('límite de tasa en memoria', () => {
  it('reinicia la ventana cuando vence', async () => {
    const l = limiteMemoria(1, 1000);
    expect((await l.intentar('k', 0)).permitido).toBe(true);
    expect(await l.intentar('k', 500)).toEqual({ permitido: false, reintentarEnSeg: 1 });
    expect((await l.intentar('k', 1500)).permitido).toBe(true);
  });
});

describe('GET /api/cotizacion (handler del núcleo)', () => {
  const copia = (m: 'BO' | 'AR'): CopiaCotizacion => ({ cotizacionId: `${m}-1`, par: m === 'BO' ? 'BOB/USD' : 'ARS/USD', valor: 7, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });
  it('se integra tal cual y no tiene tasas propias', async () => {
    const r = await manejarCotizacionSitio({ metodo: 'GET' }, (m) => Promise.resolve(copia(m)));
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ cotizaciones: { BO: copia('BO'), AR: copia('AR') } });
  });
  it('lee del almacén inyectado: sin documento responde sin cotización', async () => {
    const vacio: AlmacenCotizaciones = { leer: () => Promise.resolve(null), transaccion: () => Promise.reject(new Error('no se usa')) };
    const r = await manejarCotizacionSitio({ metodo: 'GET', mercado: 'BO' }, lectorCotizacion(vacio, 'tenant-a', () => Date.parse('2026-11-04T12:00:00Z')));
    expect(r.status).toBe(503);
    await expect(lectorCotizacion(vacio, 'tenant-a', () => 0)('BO')).rejects.toBeInstanceOf(SinCotizacionUtilizable);
  });
});

describe('despachador', () => {
  const d: DepsApi = {
    leerCotizacion: (m) => Promise.resolve({ cotizacionId: 'x', par: m === 'BO' ? 'BOB/USD' : 'ARS/USD', valor: 7, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' }),
    leerDisponibilidad: () => Promise.resolve({ 'tv-1': true }),
    contacto: {
      recaptcha: { verificar: () => Promise.resolve({ valido: true, puntaje: 1 }) }, appCheck: { verificar: () => Promise.resolve(true) },
      limite: limiteMemoria(10, 1000), almacen: { guardar: () => Promise.resolve('creado') }, ahora: () => 0,
    },
  };
  const base = { metodo: 'GET', consulta: {}, cabeceras: {}, origen: 'ip' };
  it('enruta las tres APIs y responde 404 al resto', async () => {
    expect(RUTAS_API).toHaveLength(3);
    expect((await despacharApi({ ...base, ruta: '/api/cotizacion', consulta: { mercado: 'BO' } }, d)).status).toBe(200);
    expect((await despacharApi({ ...base, ruta: '/api/cotizacion/', consulta: { mercado: 'XX' } }, d)).status).toBe(400);
    expect((await despacharApi({ ...base, ruta: '/api/disponibilidad', consulta: { ids: 'tv-1' } }, d)).cuerpo).toEqual({ disponibilidad: { 'tv-1': 'disponible' } });
    expect((await despacharApi({ ...base, metodo: 'POST', ruta: '/api/contacto', cabeceras: { 'content-type': 'application/json' }, cuerpo: {} }, d)).status).toBe(401);
    expect((await despacharApi({ ...base, ruta: '/api/otra' }, d)).status).toBe(404);
    expect((await despacharApi({ ...base, ruta: '/' }, d)).status).toBe(404);
  });
});
