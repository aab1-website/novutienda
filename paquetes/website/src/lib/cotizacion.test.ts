import { describe, expect, it } from 'vitest';
import { precioFinal, type Redondeo } from '@novutienda/nucleo';
import { almacenMemoria } from './almacen.js';
import { crearClienteCotizacion, leerCotizacionApi, VIGENCIA_CACHE_MS, type DepsCotizacion, type RespuestaFetch } from './cotizacion-cliente.js';
import { precioLocal, vistaPrecio } from './precio-vista.js';

const bo = { cotizacionId: 'BO-1', par: 'BOB/USD', valor: 12.06, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' as const };
const ar = { cotizacionId: 'AR-1', par: 'ARS/USD', valor: 1520, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' as const };
const R: Redondeo = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'arriba' } };

function montar(respuesta: unknown, ok = true): { deps: DepsCotizacion; llamadas: string[]; reloj: { t: number } } {
  const llamadas: string[] = [];
  const reloj = { t: 1_000_000 };
  const deps: DepsCotizacion = {
    fetch: (url) => { llamadas.push(url); return Promise.resolve({ ok, json: () => Promise.resolve(respuesta) } as RespuestaFetch); },
    sesion: almacenMemoria(), ahora: () => reloj.t, base: '',
  };
  return { deps, llamadas, reloj };
}

describe('cliente de cotización', () => {
  it('pide /api/cotizacion una sola vez para ambos mercados y guarda 15 minutos', async () => {
    const { deps, llamadas, reloj } = montar({ cotizaciones: { BO: bo, AR: ar } });
    const c = crearClienteCotizacion(deps);
    const [a, b] = await Promise.all([c.obtener('BO'), c.obtener('AR')]);
    expect(a?.valor).toBe(12.06);
    expect(b?.valor).toBe(1520);
    expect(llamadas).toEqual(['/api/cotizacion']);
    reloj.t += VIGENCIA_CACHE_MS - 1;
    await c.obtener('BO');
    expect(llamadas).toHaveLength(1);
    reloj.t += 2;
    await c.obtener('BO');
    expect(llamadas).toHaveLength(2);
  });

  it('descarta una caché con fecha futura o dañada', async () => {
    const { deps, llamadas } = montar({ cotizaciones: { BO: bo, AR: ar } });
    deps.sesion?.setItem('cb.cotizacion.BO', '{no json');
    deps.sesion?.setItem('cb.cotizacion.AR', JSON.stringify({ guardadoEn: 9_999_999_999, cotizacion: ar }));
    await crearClienteCotizacion(deps).todas();
    expect(llamadas).toHaveLength(1);
  });

  it('un error de red o una respuesta rara dan «sin cotización», no un valor inventado', async () => {
    const mala = montar({ cotizaciones: { BO: { ...bo, par: 'ARS/USD' }, AR: { ...ar, valor: -1 } } });
    expect(await crearClienteCotizacion(mala.deps).obtener('BO')).toBeNull();
    expect(await crearClienteCotizacion(mala.deps).obtener('AR')).toBeNull();
    const caida: DepsCotizacion = { ...mala.deps, sesion: null, fetch: () => Promise.reject(new Error('sin red')) };
    expect(await crearClienteCotizacion(caida).todas()).toEqual({});
    const vacia = montar(null);
    expect(await crearClienteCotizacion(vacia.deps).obtener('BO')).toBeNull();
  });

  it('una respuesta parcial entrega el mercado que sí está', async () => {
    const { deps } = montar({ cotizaciones: { BO: bo }, errores: { AR: 'sin_cotizacion' } });
    const c = crearClienteCotizacion(deps);
    expect(await c.obtener('BO')).not.toBeNull();
    expect(await c.obtener('AR')).toBeNull();
  });

  it('leerCotizacionApi valida la forma', () => {
    expect(leerCotizacionApi(bo, 'BO')).toEqual(bo);
    expect(leerCotizacionApi(bo, 'AR')).toBeNull();
    expect(leerCotizacionApi({ ...bo, estado: 'otra' }, 'BO')).toBeNull();
    expect(leerCotizacionApi({ ...bo, cotizacionId: 3 }, 'BO')).toBeNull();
    expect(leerCotizacionApi('x', 'BO')).toBeNull();
  });
});

describe('vista del precio (usa precioFinal del núcleo)', () => {
  it('coincide con precioFinal del núcleo, centavo a centavo', () => {
    const v = vistaPrecio(19.99, 'BO', bo, R);
    const n = precioFinal(19.99, 'BO', { par: bo.par, valor: bo.valor }, R);
    expect(n.tipo).toBe('precio');
    expect(v).toMatchObject({ tipo: 'precio', centavos: n.tipo === 'precio' ? n.centavos : -1, texto: 'Bs 241,08', aviso: null });
    expect(vistaPrecio(10.5, 'AR', ar, R)).toMatchObject({ tipo: 'precio', texto: '$ 16.000' });
  });
  it('precio base 0 muestra «consultar», aun sin cotización', () => {
    expect(vistaPrecio(0, 'BO', undefined, R)).toEqual({ tipo: 'consultar' });
    expect(vistaPrecio(0, 'BO', null, R)).toEqual({ tipo: 'consultar' });
  });
  it('cotización ausente: cargando mientras llega y «sin cotización» si no hay', () => {
    expect(vistaPrecio(10, 'BO', undefined, R)).toEqual({ tipo: 'cargando' });
    expect(vistaPrecio(10, 'BO', null, R)).toEqual({ tipo: 'sin_cotizacion' });
  });
  it('«último verificado» se avisa; una regla de redondeo inválida no inventa precio', () => {
    expect(vistaPrecio(10, 'BO', { ...bo, estado: 'ultimo_verificado' }, R)).toMatchObject({ tipo: 'precio', aviso: 'Último valor verificado del 2026-11-04' });
    const sin = { BOB: { tipo: 'decimales', decimales: 99, modo: 'cercano' }, ARS: R.ARS } as Redondeo;
    expect(vistaPrecio(10, 'BO', bo, sin)).toEqual({ tipo: 'sin_cotizacion' });
    expect(vistaPrecio(-3, 'BO', bo, R)).toEqual({ tipo: 'sin_cotizacion' });
  });
  it('precioLocal devuelve el monto decimal o null', () => {
    expect(precioLocal(10, 'BO', bo, R)).toBe(120.6);
    expect(precioLocal(0, 'BO', bo, R)).toBeNull();
    expect(precioLocal(10, 'BO', undefined, R)).toBeNull();
  });
});
