import { describe, expect, it } from 'vitest';
import {
  CACHE_COTIZACION, SinCotizacionUtilizable, actualizarMercado, bajarTexto, manejarCotizacion, rutaCotizacion,
  type CopiaCotizacion, type FetchLike, type Mercado,
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
  it('sin cotización utilizable: 503 sin caché y sin detalle interno', async () => {
    const r = await manejarCotizacion({ metodo: 'GET' }, async (m) => {
      if (m === 'AR') throw new SinCotizacionUtilizable('AR', 'detalle interno');
      return copia(m);
    });
    expect(r).toMatchObject({ status: 503, headers: { 'Cache-Control': 'no-store' }, cuerpo: { error: 'sin_cotizacion', mercado: 'AR' } });
    expect(JSON.stringify(r.cuerpo)).not.toContain('interno');
  });
  it('un error inesperado se propaga', async () => {
    await expect(manejarCotizacion({ metodo: 'GET' }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

/** fetch simulado por URL: sin red. */
const falso = (respuestas: Record<string, { status?: number; cuerpo: string }>): FetchLike => async (url) => {
  const r = respuestas[url];
  if (!r) throw new Error('sin red');
  return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, text: async () => r.cuerpo };
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
});

describe('actualizarMercado (fuentes simuladas)', () => {
  it('BO: lee el BCB y escribe', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'BO', AHORA, { fetchFn: falso(FUENTES) });
    expect(r.fallas).toEqual([]);
    expect(a.docs.get(rutaCotizacion('BO'))).toMatchObject({ valor: 12.06, fuente: 'BCB' });
  });
  it('AR: BNA como principal y A 3500 como control', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'AR', AHORA, { fetchFn: falso(FUENTES) });
    expect(r.decision.avisos).toEqual([]);
    expect(a.docs.get(rutaCotizacion('AR'))).toMatchObject({ valor: 1520, fuente: 'BNA', par: 'ARS/USD' });
  });
  it('AR: si el BNA falla usa la A 3500 y lo avisa; si todo falla no escribe y conserva lo guardado', async () => {
    const a = new AlmacenMemoria();
    const { 'https://www.bna.com.ar/Personas': _bna, ...sinBna } = FUENTES;
    void _bna;
    const r = await actualizarMercado(a, 'AR', AHORA, { fetchFn: falso(sinBna) });
    expect(r.fallas).toEqual([expect.stringContaining('BNA')]);
    expect(r.decision.avisos).toEqual([expect.objectContaining({ codigo: 'respaldo_bcra' })]);
    expect(a.docs.get(rutaCotizacion('AR'))).toMatchObject({ fuente: 'BCRA', valor: 1549.7194 });

    const b = new AlmacenMemoria();
    const todo = await actualizarMercado(b, 'AR', AHORA, { fetchFn: falso({}) });
    expect(todo.fallas).toHaveLength(2);
    expect(todo.decision.accion).toBe('rechazar');
    expect(b.docs.size).toBe(0);
  });
  it('registra como falla una fuente ilegible o con JSON roto', async () => {
    const a = new AlmacenMemoria();
    const r = await actualizarMercado(a, 'AR', AHORA, {
      fetchFn: falso({ ...FUENTES, 'https://www.bna.com.ar/Personas': { cuerpo: '<html></html>' }, 'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF': { cuerpo: '{no es json' } }),
    });
    expect(r.fallas).toHaveLength(2);
    expect(r.decision.accion).toBe('rechazar');
  });
  it('pasa config y base de rutas', async () => {
    const a = new AlmacenMemoria();
    await actualizarMercado(a, 'BO', AHORA, { fetchFn: falso(FUENTES), base: 'x/cot', config: { saltoMaximo: 0.5 } });
    expect(a.docs.has('x/cot/BO')).toBe(true);
  });
});
