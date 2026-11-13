import { describe, expect, it } from 'vitest';
import {
  CargaNoAutorizada, SaltoSinConfirmar, SinCotizacionUtilizable, cargarManual, escribirCotizacion, leerCotizacion, rutaCotizacion, rutaHistorial, type Lectura,
} from './nucleo-tc.js';
import { AHORA, AlmacenMemoria } from './ayudas.js';

const T = { tenantId: 't1' };
const adm = { uid: 'andres', rol: 'adm' as const, proveedor: 'password' };

const bcb = (valor: number, fecha = '2026-11-04'): Lectura => ({ valor, fecha, fuente: 'BCB' });
const DIA = 86_400_000;

describe('escritura: cotizaciones/{BO|AR} + historial inmutable', () => {
  it('escribe el documento y una entrada de historial con el estado anterior', async () => {
    const a = new AlmacenMemoria();
    const r1 = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06, '2026-11-03'), control: null, ahoraMs: AHORA - DIA }, T);
    expect(r1.escrita?.cotizacionId).toBe(`BO-2026-11-03-${AHORA - DIA}`);
    const r2 = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.1), control: null, ahoraMs: AHORA }, T);
    const doc = a.docs.get(rutaCotizacion('t1', 'BO'));
    expect(doc).toMatchObject({ valor: 12.1, fecha: '2026-11-04', par: 'BOB/USD', fuente: 'BCB', origen: 'automatico', actualizadoEn: '2026-11-04T14:00:00.000Z' });
    const h = a.docs.get(rutaHistorial('t1', 'BO', r2.escrita!.cotizacionId));
    expect(h).toMatchObject({ valor: 12.1, por: 'automatico', antes: { valor: 12.06, fecha: '2026-11-03', fuente: 'BCB' } });
    expect(a.docs.get(rutaHistorial('t1', 'BO', r1.escrita!.cotizacionId))).toMatchObject({ antes: null });
    expect([...a.docs.keys()].filter((k) => k.includes('/historial/'))).toHaveLength(2);
  });
  it('no escribe nada si la decisión no es escribir', async () => {
    const a = new AlmacenMemoria();
    const r = await escribirCotizacion(a, { mercado: 'BO', principal: null, control: null, ahoraMs: AHORA }, T);
    expect(r.escrita).toBeNull();
    expect(a.docs.size).toBe(0);
  });
  it('el historial no se sobrescribe: una colisión de id falla', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA }, T);
    a.docs.delete(rutaCotizacion('t1', 'BO'));
    await expect(escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA }, T)).rejects.toThrow('ya existe');
  });
  it('la ruta es por tenant y coincide con el manifiesto (tenants/{t}/cotizaciones)', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'AR', principal: { valor: 1520, fecha: '2026-11-04', fuente: 'BNA' }, control: null, ahoraMs: AHORA }, { tenantId: 'tenant-x' });
    expect(a.docs.has('tenants/tenant-x/cotizaciones/AR')).toBe(true);
    expect(rutaHistorial('tenant-x', 'AR', 'x')).toBe('tenants/tenant-x/cotizaciones/AR/historial/x');
    expect(() => rutaCotizacion('../otro', 'AR')).toThrow(RangeError);
  });
  it('N corridas de +4,9 % con la misma fecha: solo la primera se escribe', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'AR', principal: { valor: 1500, fecha: '2026-11-03', fuente: 'BNA' }, control: null, ahoraMs: AHORA - DIA }, T);
    let v = 1500;
    const decisiones: string[] = [];
    for (let i = 0; i < 5; i++) {
      v *= 1.049;
      const r = await escribirCotizacion(a, { mercado: 'AR', principal: { valor: v, fecha: '2026-11-04', fuente: 'BNA' }, control: null, ahoraMs: AHORA + i }, T);
      decisiones.push(r.decision.accion);
    }
    expect(decisiones).toEqual(['escribir', 'ya_escrita', 'ya_escrita', 'ya_escrita', 'ya_escrita']);
    expect(a.docs.get(rutaCotizacion('t1', 'AR'))).toMatchObject({ valor: 1500 * 1.049, ancla: { valor: 1500, fecha: '2026-11-03' } });
    expect([...a.docs.keys()].filter((k) => k.includes('/historial/'))).toHaveLength(2);
  });
  it('con la misma fecha, la A 3500 no reemplaza al BNA ya escrito; el BNA sí mejora a la A 3500', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'AR', principal: { valor: 1520, fecha: '2026-11-04', fuente: 'BNA' }, control: null, ahoraMs: AHORA }, T);
    const r = await escribirCotizacion(a, { mercado: 'AR', principal: null, control: { valor: 3500, fecha: '2026-11-04', fuente: 'BCRA' }, ahoraMs: AHORA + 1 }, T);
    expect(r.decision.accion).toBe('ya_escrita');
    expect(a.docs.get(rutaCotizacion('t1', 'AR'))).toMatchObject({ valor: 1520, fuente: 'BNA' });
    const b = new AlmacenMemoria();
    await escribirCotizacion(b, { mercado: 'AR', principal: null, control: { valor: 1500, fecha: '2026-11-04', fuente: 'BCRA' }, ahoraMs: AHORA }, T);
    const m = await escribirCotizacion(b, { mercado: 'AR', principal: { valor: 1520, fecha: '2026-11-04', fuente: 'BNA' }, control: null, ahoraMs: AHORA + 1 }, T);
    expect(m.decision.accion).toBe('escribir');
  });
});

describe('carga manual', () => {
  it('queda marcada manual, con el uid de quien la cargó, y la automática igual o más vieja no la pisa', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA - 1000 }, T);
    const m = await cargarManual(a, { mercado: 'BO', valor: 12.3, fecha: '2026-11-04', actor: adm, ahoraMs: AHORA }, T);
    expect(m).toMatchObject({ fuente: 'manual', origen: 'manual', valor: 12.3 });
    expect(a.docs.get(rutaHistorial('t1', 'BO', m.cotizacionId))).toMatchObject({ por: 'andres', antes: { valor: 12.06 } });
    const r = await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA + 1000 }, T);
    expect(r.decision.accion).toBe('manual_vigente');
    expect(a.docs.get(rutaCotizacion('t1', 'BO'))).toMatchObject({ valor: 12.3 });
  });
  it('exige administrador con contraseña o propietario; nadie más', async () => {
    const a = new AlmacenMemoria();
    const base = { mercado: 'BO' as const, valor: 12, fecha: '2026-11-04', ahoraMs: AHORA };
    for (const actor of [
      { uid: 'u', rol: 'caj' as const, proveedor: 'password' }, { uid: 'u', rol: 'sup' as const, proveedor: 'password' },
      { uid: 'u', rol: 'adm' as const, proveedor: 'google.com' }, { uid: 'u', rol: 'adm' as const, proveedor: 'anonymous' },
      { uid: 'u', rol: 'propietario' as const, proveedor: 'password' },
    ]) {
      await expect(cargarManual(a, { ...base, actor }, T)).rejects.toBeInstanceOf(CargaNoAutorizada);
    }
    await expect(cargarManual(a, { ...base, actor: { uid: 'p', rol: 'propietario', proveedor: 'google.com' } }, T)).resolves.toMatchObject({ valor: 12 });
    expect(a.docs.size).toBe(2);
  });
  it('un valor que se aparta más que el salto máximo pide confirmación explícita y usa la config recibida', async () => {
    const a = new AlmacenMemoria();
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA - 1000 }, T);
    const e = { mercado: 'BO' as const, valor: 14, fecha: '2026-11-04', actor: adm, ahoraMs: AHORA };
    await expect(cargarManual(a, e, T)).rejects.toBeInstanceOf(SaltoSinConfirmar);
    await expect(cargarManual(a, { ...e, confirmarSalto: false }, T)).rejects.toBeInstanceOf(SaltoSinConfirmar);
    expect(a.docs.get(rutaCotizacion('t1', 'BO'))).toMatchObject({ valor: 12.06 });
    await expect(cargarManual(a, { ...e, config: { saltoMaximo: 0.5 } }, T)).resolves.toMatchObject({ valor: 14 });
    const b = new AlmacenMemoria();
    await escribirCotizacion(b, { mercado: 'BO', principal: bcb(12.06), control: null, ahoraMs: AHORA - 1000 }, T);
    await expect(cargarManual(b, { ...e, confirmarSalto: true }, T)).resolves.toMatchObject({ valor: 14, origen: 'manual' });
  });
  it('valida valor, fecha, autor y fecha futura', async () => {
    const a = new AlmacenMemoria();
    const base = { mercado: 'BO' as const, valor: 12, fecha: '2026-11-04', actor: adm, ahoraMs: AHORA };
    await expect(cargarManual(a, { ...base, valor: 0 }, T)).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, valor: Number.NaN }, T)).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, fecha: '4/11/2026' }, T)).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, actor: { ...adm, uid: ' ' } }, T)).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, fecha: '2026-11-10' }, T)).rejects.toThrow(RangeError);
    await expect(cargarManual(a, { ...base, fecha: '2026-11-05' }, T)).rejects.toThrow(RangeError); // futura: no vigente por defecto
    await expect(cargarManual(a, { ...base, fecha: '2026-11-05', config: { futuroVigente: true } }, T)).resolves.toMatchObject({ fecha: '2026-11-05' });
  });
});

describe('lectura con estado (días hábiles)', () => {
  const guardar = async (fecha: string, extra: Record<string, unknown> = {}, mercado: 'BO' | 'AR' = 'BO') => {
    const a = new AlmacenMemoria();
    a.docs.set(rutaCotizacion('t1', mercado), { cotizacionId: 'BO-x', mercado, par: 'BOB/USD', valor: 12.06, fecha, fuente: 'BCB', origen: 'automatico', ...extra });
    return a;
  };
  it("'vigente' cuando la fecha está dentro de la ventana, y devuelve la copia para guardar en la venta", async () => {
    const a = await guardar('2026-11-04');
    expect(await leerCotizacion(a, 'BO', AHORA, T)).toEqual({ cotizacionId: 'BO-x', par: 'BOB/USD', valor: 12.06, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });
    // AHORA es miércoles 4/11: el viernes 30/10 son 3 hábiles (lun, mar, mié)
    expect((await leerCotizacion(await guardar('2026-11-02'), 'BO', AHORA, T)).estado).toBe('vigente'); // 2 hábiles
  });
  it("el fin de semana no cuenta: el valor del viernes sigue vigente el lunes", async () => {
    const lunes = Date.parse('2026-11-09T14:00:00Z');
    expect((await leerCotizacion(await guardar('2026-11-06'), 'BO', lunes, T)).estado).toBe('vigente');
  });
  it("'ultimo_verificado' pasados diasVigente y SinCotizacionUtilizable pasado diasLimite", async () => {
    expect((await leerCotizacion(await guardar('2026-10-30'), 'BO', AHORA, T)).estado).toBe('ultimo_verificado'); // 3 hábiles
    const e = await leerCotizacion(await guardar('2026-10-29'), 'BO', AHORA, T).catch((x: unknown) => x); // 4 hábiles: aún; 28 → 5
    expect(e).not.toBeInstanceOf(SinCotizacionUtilizable);
    const f = await leerCotizacion(await guardar('2026-10-28'), 'BO', AHORA, T).catch((x: unknown) => x);
    expect(f).toBeInstanceOf(SinCotizacionUtilizable);
    expect(f).toMatchObject({ mercado: 'BO', name: 'SinCotizacionUtilizable' });
    expect((await leerCotizacion(await guardar('2026-10-28'), 'BO', AHORA, { ...T, config: { diasLimite: 10, diasVigente: 7 } })).estado).toBe('vigente');
  });
  it('un feriado largo (calendario inyectado) no deja el mercado sin cotización', async () => {
    // Carnaval simulado: lun 9 y mar 10 de noviembre; el valor es del viernes 6 y se lee el viernes 13 (5 hábiles sin calendario).
    const viernes13 = Date.parse('2026-11-13T14:00:00Z');
    const a = await guardar('2026-11-06', {}, 'AR');
    await expect(leerCotizacion(a, 'AR', viernes13, T)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
    const feriados = new Set(['2026-11-09', '2026-11-10']);
    const r = await leerCotizacion(a, 'AR', viernes13, { ...T, esFeriado: (f) => feriados.has(f) });
    expect(r.estado).toBe('ultimo_verificado'); // 3 hábiles
  });
  it('lanza si falta, está mal formada o es futura', async () => {
    await expect(leerCotizacion(new AlmacenMemoria(), 'BO', AHORA, T)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
    for (const extra of [{ valor: 0 }, { valor: 'x' }, { fecha: 'ayer' }, { cotizacionId: '' }, { fuente: 'otra' }]) {
      await expect(leerCotizacion(await guardar('2026-11-04', extra), 'BO', AHORA, T)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
    }
    await expect(leerCotizacion(await guardar('2026-11-20'), 'BO', AHORA, T)).rejects.toThrow('fecha futura');
  });
  it('fecha del día siguiente: no es vigente esa noche por defecto; con futuroVigente sí', async () => {
    const noche = Date.parse('2026-11-05T01:30:00Z'); // 4/11 21:30 en La Paz
    const a = await guardar('2026-11-05');
    await expect(leerCotizacion(a, 'BO', noche, T)).rejects.toThrow('fecha futura');
    expect((await leerCotizacion(a, 'BO', noche, { ...T, config: { futuroVigente: true } })).estado).toBe('vigente');
    await expect(leerCotizacion(await guardar('2026-11-06'), 'BO', noche, { ...T, config: { futuroVigente: true } })).rejects.toThrow('fecha futura');
  });
});
