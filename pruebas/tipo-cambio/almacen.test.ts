import { describe, expect, it } from 'vitest';
import {
  SinCotizacionUtilizable, cargarManual, escribirCotizacion, leerCotizacion, rutaCotizacion, rutaHistorial, type Lectura,
} from './nucleo-tc.js';
import { AHORA, AlmacenMemoria } from './ayudas.js';

const bcb = (valor: number, fecha = '2026-11-04'): Lectura => ({ valor, fecha, fuente: 'BCB' });
const DIA = 86_400_000;

describe('escritura: cotizaciones/{BO|AR} + historial inmutable', () => {
  it('escribe el documento y una entrada de historial con el estado anterior', async () => {
    const a = new AlmacenMemoria();
    const r1 = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06, '2026-11-03'), control: null, ahoraMs: AHORA - DIA });
    expect(r1.escrita?.cotizacionId).toBe(`BO-2026-11-03-${AHORA - DIA}`);
    const r2 = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.1), control: null, ahoraMs: AHORA });
    const doc = a.docs.get(rutaCotizacion('BO'));
    expect(doc).toMatchObject({ valor: 12.1, fecha: '2026-11-04', par: 'BOB/USD', fuente: 'BCB', origen: 'automatico', actualizadoEn: '2026-11-04T14:00:00.000Z' });
    const h = a.docs.get(rutaHistorial('BO', r2.escrita!.cotizacionId));
    expect(h).toMatchObject({ valor: 12.1, por: 'automatico', antes: { valor: 12.06, fecha: '2026-11-03', fuente: 'BCB' } });
    expect(a.docs.get(rutaHistorial('BO', r1.escrita!.cotizacionId))).toMatchObject({ antes: null });
    expect([...a.docs.keys()].filter((k) => k.includes('/historial/'))).toHaveLength(2);
  });
  it('no escribe nada si la decisión no es escribir', async () => {
    const a = new AlmacenMemoria();
    const r = await escribirCotizacion(a, { mercado: 'BO', principal: null, control: null, ahoraMs: AHORA });
    expect(r.escrita).toBeNull();
    expect(a.docs.size).toBe(0);
  });
  it('el historial no se sobrescribe: una colisión de id falla', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA });
    a.docs.delete(rutaCotizacion('BO'));
    await expect(escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA })).rejects.toThrow('ya existe');
  });
  it('admite una base de rutas distinta (por tenant)', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'AR', principal: { valor: 1520, fecha: '2026-11-04', fuente: 'BNA' }, control: null, ahoraMs: AHORA }, { base: 'tenants/t1/cotizaciones', por: 'job' });
    expect(a.docs.has('tenants/t1/cotizaciones/AR')).toBe(true);
  });
});

describe('carga manual', () => {
  it('queda marcada manual, con quién la cargó, y la automática igual o más vieja no la pisa', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA - 1000 });
    const m = await cargarManual(a, { mercado: 'BO', valor: 13, fecha: '2026-11-04', por: 'andres', ahoraMs: AHORA });
    expect(m).toMatchObject({ fuente: 'manual', origen: 'manual', valor: 13 });
    expect(a.docs.get(rutaHistorial('BO', m.cotizacionId))).toMatchObject({ por: 'andres', antes: { valor: 12.06 } });
    const r = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA + 1000 });
    expect(r.decision.accion).toBe('manual_vigente');
    expect(a.docs.get(rutaCotizacion('BO'))).toMatchObject({ valor: 13 });
  });
  it('valida valor, fecha, autor y fecha futura', async () => {
    const a = new AlmacenMemoria();
    const base = { mercado: 'BO' as const, valor: 12, fecha: '2026-11-04', por: 'a', ahoraMs: AHORA };
    await expect(cargarManual(a, { ...base, valor: 0 })).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, valor: Number.NaN })).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, fecha: '4/11/2026' })).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, por: ' ' })).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, fecha: '2026-11-10' })).rejects.toThrow(RangeError);
  });
});

describe('lectura con estado', () => {
  const guardar = async (fecha: string, extra: Record<string, unknown> = {}) => {
    const a = new AlmacenMemoria();
    a.docs.set(rutaCotizacion('BO'), { cotizacionId: 'BO-x', mercado: 'BO', par: 'BOB/USD', valor: 12.06, fecha, fuente: 'BCB', origen: 'automatico', ...extra });
    return a;
  };
  it("'vigente' cuando la fecha está dentro de la ventana, y devuelve la copia para guardar en la venta", async () => {
    const a = await guardar('2026-11-04');
    expect(await leerCotizacion(a, 'BO', AHORA)).toEqual({ cotizacionId: 'BO-x', par: 'BOB/USD', valor: 12.06, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });
    expect((await leerCotizacion(await guardar('2026-11-01'), 'BO', AHORA)).estado).toBe('vigente'); // 3 días
  });
  it("'ultimo_verificado' pasados diasVigente y SinCotizacionUtilizable pasado diasLimite", async () => {
    expect((await leerCotizacion(await guardar('2026-10-31'), 'BO', AHORA)).estado).toBe('ultimo_verificado'); // 4 días
    const e = await leerCotizacion(await guardar('2026-10-30'), 'BO', AHORA).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SinCotizacionUtilizable);
    expect(e).toMatchObject({ mercado: 'BO', name: 'SinCotizacionUtilizable' });
    expect((await leerCotizacion(await guardar('2026-10-30'), 'BO', AHORA, { config: { diasLimite: 10, diasVigente: 7 } })).estado).toBe('vigente');
  });
  it('lanza si falta, está mal formada o es futura', async () => {
    await expect(leerCotizacion(new AlmacenMemoria(), 'BO', AHORA)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
    for (const extra of [{ valor: 0 }, { valor: 'x' }, { fecha: 'ayer' }, { cotizacionId: '' }, { fuente: 'otra' }]) {
      await expect(leerCotizacion(await guardar('2026-11-04', extra), 'BO', AHORA)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
    }
    await expect(leerCotizacion(await guardar('2026-11-20'), 'BO', AHORA)).rejects.toThrow('fecha futura');
  });
});
