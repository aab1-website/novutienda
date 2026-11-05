import { describe, expect, it } from 'vitest';
import {
  CACHE_COTIZACION, SinCotizacionUtilizable, actualizarMercado, bajarTexto, manejarCotizacion, rutaCotizacion,
  type AvisoOperativo, type CopiaCotizacion, type FetchLike, type Mercado, type Notificador,
} from './nucleo-tc.js';
import { AHORA, AlmacenMemoria, fixture } from './ayudas.js';

const copia = (m: Mercado): CopiaCotizacion => ({
  cotizacionId: `${m}-x`, par: m === 'BO' ? 'BOB/USD' : 'ARS/USD', valor: m === 'BO' ? 12.06 : 1520, fecha: '2026-11-04', fuente: m === 'BO' ? 'BCB' : 'BNA', estado: 'vigente',
});

describe('GET /api/cotizacion', () => {
  it('responde ambos mercados con la caché pública pedida', async () => {
    const r = await manejarCotizacion({ metodo: 'GET' }, async (m) => copia(m));
    expect(CACHE_COTIZACION).toBe('public, max-age=60, s-maxage=300');
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=300');
    expect(r.cuerpo).toEqual({ cotizaciones: { BO: copia('BO'), AR: copia('AR') } });
  });
  it('responde un solo mercado si se pide', async () => {
    const r = await manejarCotizacion({ metodo: 'get', mercado: 'AR' }, async (m) => copia(m));
    expect(r.cuerpo).toEqual({ cotizaciones: { AR: copia('AR') } });
  });
  it('mercado inválido: 400 sin caché; método distinto de GET: 405', async () => {
    const mala = await manejarCotizacion({ metodo: 'GET', mercado: 'XX' }, async (m) => copia(m));
    expect(mala).toMatchObject({ status: 400 });
    expect(mala.headers['Cache-Control']).toBe('no-store');
    expect(await manejarCotizacion({ metodo: 'POST' }, async (m) => copia(m))).toMatchObject({ status: 405, headers: { Allow: 'GET' } });
  });
  it('sin mercado, si uno falla responde por mercado: 200 con el que sí está y el error del otro, sin caché', async () => {
    const r = await manejarCotizacion({ metodo: 'GET' }, async (m) => {
      if (m === 'AR') throw new SinCotizacionUtilizable('AR', 'detalle interno');
      return copia(m);
    });
    expect(r).toMatchObject({ status: 200, headers: { 'Cache-Control': 'no-store' }, cuerpo: { cotizaciones: { BO: copia('BO') }, errores: { AR: 'sin_cotizacion' } } });
    expect(JSON.stringify(r.cuerpo)).not.toContain('interno');
  });
  it('sin mercado y ambos fallan: 503; con mercado explícito: 200 o 503 por separado', async () => {
    const falla = async (m: Mercado): Promise<CopiaCotizacion> => { throw new SinCotizacionUtilizable(m, 'x'); };
    expect(await manejarCotizacion({ metodo: 'GET' }, falla)).toMatchObject({ status: 503, headers: { 'Retry-After': '300' }, cuerpo: { error: 'sin_cotizacion' } });
    const soloAr = async (m: Mercado): Promise<CopiaCotizacion> => { if (m === 'AR') throw new SinCotizacionUtilizable('AR', 'x'); return copia(m); };
    expect(await manejarCotizacion({ metodo: 'GET', mercado: 'BO' }, soloAr)).toMatchObject({ status: 200 });
    const r = await manejarCotizacion({ metodo: 'GET', mercado: 'AR' }, soloAr);
    expect(r).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store' }, cuerpo: { error: 'sin_cotizacion', mercado: 'AR' } });
  });
  it('un error inesperado se propaga', async () => {
    await expect(manejarCotizacion({ metodo: 'GET' }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

/** fetch simulado por URL: sin red. */
const flujo = (partes: readonly Uint8Array[], visto?: { leidos: number; cancelado: boolean }) => ({
  getReader: () => {
    let i = 0;
    return {
      read: async () => {
        if (i >= partes.length) return { done: true };
        if (visto) visto.leidos++;
        return { done: false, value: partes[i++]! };
      },
      cancel: async () => { if (visto) visto.cancelado = true; },
    };
  },
});
const falso = (respuestas: Record<string, { status?: number; cuerpo: string; longitud?: string }>): FetchLike => async (url) => {
  const r = respuestas[url];
  if (!r) throw new Error('sin red');
  return {
    ok: (r.status ?? 200) < 400, status: r.status ?? 200,
    headers: { get: (n) => (n === 'content-length' ? (r.longitud ?? null) : null) },
    body: flujo([new TextEncoder().encode(r.cuerpo)]),
  };
};
const FUENTES = {
  'https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php': { cuerpo: fixture('bcb-2026-11-04.html') },
  'https://www.bna.com.ar/Personas': { cuerpo: fixture('bna-2026-11-04.html') },
  'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF': { cuerpo: fixture('bcra-ref-2026-11-03.json') },
};

describe('bajarTexto', () => {
  it('falla con respuestas no exitosas o demasiado grandes', async () => {
    await expect(bajarTexto('u', { fetchFn: falso({ u: { status: 500, cuerpo: '' } }) })).rejects.toThrow('500');
    await expect(bajarTexto('u', { fetchFn: falso({ u: { cuerpo: 'xxxx' } }), bytesMaximos: 2 })).rejects.toThrow('grande');
    await expect(bajarTexto('u', { fetchFn: falso({ u: { cuerpo: 'ok' } }) })).resolves.toBe('ok');
  });
  it('cuenta BYTES, no caracteres: «ñ» ocupa 2', async () => {
    await expect(bajarTexto('u', { fetchFn: falso({ u: { cuerpo: 'ññ' } }), bytesMaximos: 3 })).rejects.toThrow('grande');
    await expect(bajarTexto('u', { fetchFn: falso({ u: { cuerpo: 'ññ' } }), bytesMaximos: 4 })).resolves.toBe('ññ');
  });
  it('rechaza antes de leer si content-length supera el tope', async () => {
    const visto = { leidos: 0, cancelado: false };
    const f: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => '999999' }, body: flujo([new Uint8Array(10)], visto) });
    await expect(bajarTexto('u', { fetchFn: f, bytesMaximos: 100 })).rejects.toThrow('grande');
    expect(visto).toEqual({ leidos: 0, cancelado: true });
  });
  it('aborta el streaming al pasar el tope sin bajar el resto', async () => {
    const visto = { leidos: 0, cancelado: false };
    const trozos = Array.from({ length: 1000 }, () => new Uint8Array(100));
    const f: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: flujo(trozos, visto) });
    await expect(bajarTexto('u', { fetchFn: f, bytesMaximos: 250 })).rejects.toThrow('grande');
    expect(visto.leidos).toBe(3);
    expect(visto.cancelado).toBe(true);
  });
  it('decodifica un carácter UTF-8 partido entre dos trozos y tolera cuerpo vacío', async () => {
    const bytes = new TextEncoder().encode('añ');
    const f: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: flujo([bytes.slice(0, 2), bytes.slice(2)]) });
    await expect(bajarTexto('u', { fetchFn: f })).resolves.toBe('añ');
    const sin: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, body: null });
    await expect(bajarTexto('u', { fetchFn: sin })).resolves.toBe('');
  });
});

describe('actualizarMercado (fuentes simuladas)', () => {
  it('BO: lee el BCB y escribe', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'BO', AHORA, { fetchFn: falso(FUENTES), tenantId: 't1' });
    expect(r.fallas).toEqual([]);
    expect(a.docs.get(rutaCotizacion('t1', 'BO'))).toMatchObject({ valor: 12.06, fuente: 'BCB' });
  });
  it('AR: BNA como principal y A 3500 como control', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'AR', AHORA, { fetchFn: falso(FUENTES), tenantId: 't1' });
    expect(r.decision.avisos).toEqual([]);
    expect(a.docs.get(rutaCotizacion('t1', 'AR'))).toMatchObject({ valor: 1520, fuente: 'BNA', par: 'ARS/USD' });
  });
  it('AR: si el BNA falla usa la A 3500 y lo avisa; si todo falla no escribe y conserva lo guardado', async () => {
    const a = new AlmacenMemoria();
    const { 'https://www.bna.com.ar/Personas': _bna, ...sinBna } = FUENTES;
    void _bna;
    const r = await actualizarMercado(a, 'AR', AHORA, { fetchFn: falso(sinBna), tenantId: 't1' });
    expect(r.fallas).toEqual([expect.stringContaining('BNA')]);
    expect(r.decision.avisos).toEqual([expect.objectContaining({ codigo: 'respaldo_bcra' })]);
    expect(a.docs.get(rutaCotizacion('t1', 'AR'))).toMatchObject({ fuente: 'BCRA', valor: 1549.7194 });

    const b = new AlmacenMemoria();
    const todo = await actualizarMercado(b, 'AR', AHORA, { fetchFn: falso({}), tenantId: 't1' });
    expect(todo.fallas).toHaveLength(2);
    expect(todo.decision.accion).toBe('rechazar');
    expect(b.docs.size).toBe(0);
  });
  it('registra como falla una fuente ilegible o con JSON roto', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'AR', AHORA, {
      tenantId: 't1',
      fetchFn: falso({ ...FUENTES, 'https://www.bna.com.ar/Personas': { cuerpo: '<html></html>' }, 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF': { cuerpo: '{no es json' } }),
    });
    expect(r.fallas).toHaveLength(2);
    expect(r.decision.accion).toBe('rechazar');
  });
  it('pasa config y el tenant de las rutas', async () => {
    const a = new AlmacenMemoria();
    await actualizarMercado(a, 'BO', AHORA, { fetchFn: falso(FUENTES), tenantId: 'x', config: { saltoMaximo: 0.5 } });
    expect(a.docs.has('tenants/x/cotizaciones/BO')).toBe(true);
  });
});

describe('notificación de fallas', () => {
  const registro = () => {
    const avisos: AvisoOperativo[] = [];
    const n: Notificador = { notificar: async (a) => { avisos.push(a); } };
    return { avisos, n };
  };
  it('avisa ante fallas de fuente', async () => {
    const { avisos, n } = registro();
    const { 'https://www.bna.com.ar/Personas': _b, ...sinBna } = FUENTES;
    void _b;
    await actualizarMercado(new AlmacenMemoria(), 'AR', AHORA, { fetchFn: falso(sinBna), tenantId: 't1', notificador: n });
    expect(avisos).toEqual([expect.objectContaining({ tipo: 'fallas_fuente', mercado: 'AR', fallas: [expect.stringContaining('BNA')] })]);
  });
  it('avisa si la cotización guardada es más vieja que el límite (o no hay)', async () => {
    const { avisos, n } = registro();
    const a = new AlmacenMemoria();
    a.docs.set(rutaCotizacion('t1', 'BO'), { cotizacionId: 'BO-x', mercado: 'BO', par: 'BOB/USD', valor: 12.06, fecha: '2026-10-20', fuente: 'BCB', origen: 'automatico' });
    await actualizarMercado(a, 'BO', AHORA, { fetchFn: falso({}), tenantId: 't1', notificador: n });
    expect(avisos.map((x) => x.tipo)).toEqual(['fallas_fuente', 'cotizacion_vieja']);
    expect(avisos[1]).toMatchObject({ mercado: 'BO', detalle: expect.stringContaining('días hábiles') });
  });
  it('sin fallas ni vejez no avisa; y un notificador que falla no tumba la corrida', async () => {
    const { avisos, n } = registro();
    await actualizarMercado(new AlmacenMemoria(), 'BO', AHORA, { fetchFn: falso(FUENTES), tenantId: 't1', notificador: n });
    expect(avisos).toEqual([]);
    const roto: Notificador = { notificar: async () => { throw new Error('sin canal'); } };
    const r = await actualizarMercado(new AlmacenMemoria(), 'BO', AHORA, { fetchFn: falso({}), tenantId: 't1', notificador: roto });
    expect(r.fallas).toHaveLength(1);
  });
});
