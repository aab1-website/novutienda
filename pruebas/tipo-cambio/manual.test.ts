import { describe, expect, it } from 'vitest';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS, CargaNoAutorizada, ValorFueraDeBanda, ConfirmacionRequerida, SaltoSinConfirmar, SinCotizacionUtilizable, SinManualActivo, TipoCambioInvalido,
  actualizarMercado, escribirCotizacion, fijarCotizacionManualDe, leerTipoCambioDe, type AvisoOperativo, type AlmacenCotizaciones, leerCotizacionDe, leerReferenciaDe, quitarCotizacionManualDe,
  rutaCotizacionManual, type Lectura,
} from './nucleo-tc.js';
import { AHORA, AlmacenMemoria } from './ayudas.js';

const O = { tenantId: 't1', comercial: COMERCIAL_LEGADO_TRES_MONEDAS };
const adm = { uid: 'ana', rol: 'adm' as const, proveedor: 'password' };
const bcb = (valor: number, fecha = '2026-11-04'): Lectura => ({ valor, fecha, fuente: 'BCB' });
const DIA = 86_400_000;

async function conBcb(valor = 12.06) {
  const a = new AlmacenMemoria();
  await escribirCotizacion(a, { mercado: 'BO', principal: bcb(valor, '2026-11-03'), control: null, ahoraMs: AHORA - DIA }, O);
  return a;
}

describe('tipo de cambio manual', () => {
  it('sin manual, todo es igual que hoy', async () => {
    const a = await conBcb();
    const r = await leerReferenciaDe(a, 'BO', AHORA, O);
    expect(await leerCotizacionDe(a, 'BO', AHORA, O)).toEqual(r);
    expect(r.fuente).toBe('BCB');
  });

  it('el manual manda aunque llegue un BCB más nuevo, y no vence', async () => {
    const a = await conBcb();
    const m = await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.2, actor: adm, ahoraMs: AHORA }, O);
    expect(m).toMatchObject({ fecha: '2026-11-04', fuente: 'manual', origen: 'manual' });
    await escribirCotizacion(a, { mercado: 'BO', principal: bcb(12.3, '2026-11-05'), control: null, ahoraMs: AHORA + DIA }, O);
    const r = await leerCotizacionDe(a, 'BO', AHORA + DIA, O);
    expect(r).toMatchObject({ valor: 12.2, fuente: 'manual', estado: 'vigente', par: 'BOB/USD' });
    const lejos = await leerCotizacionDe(a, 'BO', AHORA + 60 * DIA, O);
    expect(lejos).toMatchObject({ valor: 12.2, fuente: 'manual', estado: 'vigente' });
    await expect(leerReferenciaDe(a, 'BO', AHORA + 60 * DIA, O)).rejects.toThrow(SinCotizacionUtilizable);
  });

  it('un manual mal formado cae a la referencia', async () => {
    const a = await conBcb();
    a.docs.set(rutaCotizacionManual('t1', 'BO'), { valor: -1, fecha: 'x' });
    expect((await leerCotizacionDe(a, 'BO', AHORA, O)).fuente).toBe('BCB');
  });

  it('el salto de más del 5 % sin confirmación se rechaza; confirmado, pasa; queda historial', async () => {
    const a = await conBcb();
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 14, actor: adm, ahoraMs: AHORA }, O)).rejects.toThrow(SaltoSinConfirmar);
    const m = await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 14, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O);
    expect(a.docs.get(`${rutaCotizacionManual('t1', 'BO')}/historial/${m.cotizacionId}`)).toMatchObject({ por: 'ana', antes: { valor: 12.06, fuente: 'BCB' } });
    // contra el manual anterior
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.5, actor: adm, ahoraMs: AHORA + 1 }, O)).rejects.toThrow(SaltoSinConfirmar);
  });

  it('caj, sup, adm con Google, valores y mercados inválidos se rechazan', async () => {
    const a = await conBcb();
    for (const actor of [{ uid: 'c', rol: 'caj' as const, proveedor: 'password' }, { uid: 's', rol: 'sup' as const, proveedor: 'password' }, { uid: 'g', rol: 'adm' as const, proveedor: 'google.com' }]) {
      await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.1, actor, ahoraMs: AHORA }, O)).rejects.toThrow(CargaNoAutorizada);
      await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor, ahoraMs: AHORA, confirmar: true }, O)).rejects.toThrow(CargaNoAutorizada);
    }
    for (const valor of [0, -1, NaN, Infinity]) {
      await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor, actor: adm, ahoraMs: AHORA }, O)).rejects.toThrow(RangeError);
    }
    await expect(fijarCotizacionManualDe(a, { mercado: 'US', valor: 1, actor: adm, ahoraMs: AHORA }, O)).rejects.toThrow(RangeError);
  });

  it('el propietario con Google puede fijar', async () => {
    const a = await conBcb();
    const p = { uid: 'prop', rol: 'propietario' as const, proveedor: 'google.com' };
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.1, actor: p, ahoraMs: AHORA }, O)).resolves.toMatchObject({ valor: 12.1 });
  });

  it('volver al banco central: exige confirmación, deja historial y rige la referencia', async () => {
    const a = await conBcb();
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.2, actor: adm, ahoraMs: AHORA }, O);
    await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 1 }, O)).rejects.toThrow(ConfirmacionRequerida);
    expect((await leerCotizacionDe(a, 'BO', AHORA, O)).fuente).toBe('manual');
    await quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 2, confirmar: true }, O);
    expect(await leerCotizacionDe(a, 'BO', AHORA, O)).toMatchObject({ fuente: 'BCB', valor: 12.06 });
    expect(a.docs.get(`${rutaCotizacionManual('t1', 'BO')}/historial/BO-quitar-${AHORA + 2}`)).toMatchObject({ accion: 'quitar', por: 'ana', antes: { valor: 12.2 } });
    await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 3, confirmar: true }, O)).rejects.toThrow(SinManualActivo);
    await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 3, confirmar: true }, O)).rejects.toBeInstanceOf(RangeError);
    await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor: { ...adm, uid: ' ' }, ahoraMs: AHORA + 3, confirmar: true }, O)).rejects.toThrow(TipoCambioInvalido);
    // y se puede volver a fijar
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.1, actor: adm, ahoraMs: AHORA + 4 }, O);
    expect((await leerCotizacionDe(a, 'BO', AHORA, O)).fuente).toBe('manual');
  });

  it('sin referencia ni manual previo exige confirmación', async () => {
    const a = new AlmacenMemoria();
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 6.96, actor: adm, ahoraMs: AHORA }, O)).rejects.toThrow(SaltoSinConfirmar);
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 6.96, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).resolves.toMatchObject({ valor: 6.96 });
  });

  it('la banda de cordura rechaza valores fuera de rango aunque vengan confirmados', async () => {
    const a = await conBcb();
    for (const valor of [0.5, 101, 1e9]) {
      await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).rejects.toThrow(ValorFueraDeBanda);
    }
    await expect(fijarCotizacionManualDe(a, { mercado: 'AR', valor: 5, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).rejects.toThrow(ValorFueraDeBanda);
    await expect(fijarCotizacionManualDe(a, { mercado: 'AR', valor: 1500, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).resolves.toMatchObject({ valor: 1500 });
  });

  it('banda relativa: con 11,83 del banco central se admite de 5,915 a 17,745, bordes incluidos', async () => {
    const a = await conBcb(11.83);
    let n = 0;
    const f = (valor: number) => fijarCotizacionManualDe(a, { mercado: 'BO', valor, actor: adm, ahoraMs: AHORA + n++, confirmarSalto: true }, O);
    await expect(f(5.915)).resolves.toMatchObject({ valor: 5.915 });
    await expect(f(17.745)).resolves.toMatchObject({ valor: 17.745 });
    for (const valor of [5.914, 17.746, 1]) await expect(f(valor)).rejects.toThrow(ValorFueraDeBanda);
    await expect(f(1)).rejects.toThrow('el valor 1 está fuera del rango admitido para BOB/USD (5,915 a 17,745: ±50 % del banco central)');
    await expect(f(1)).rejects.toMatchObject({ rango: '5,915 a 17,745', referencia: 11.83 });
  });

  it('la banda relativa se mide contra el banco central, no contra el manual vigente', async () => {
    const a = await conBcb(11.83);
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 17, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O);
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 25, actor: adm, ahoraMs: AHORA + 1, confirmarSalto: true }, O)).rejects.toThrow(ValorFueraDeBanda);
  });

  it('el texto nunca contradice el rechazo y expone descripcion', async () => {
    const a = await conBcb(11.83);
    const e = await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 5.9149, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O).catch((x) => x);
    expect(e).toBeInstanceOf(ValorFueraDeBanda);
    expect(e.message).toContain('el valor 5,9149 está fuera');
    expect(e.descripcion).toBe('5,915 a 17,745: ±50 % del banco central');
    const b = await fijarCotizacionManualDe(new AlmacenMemoria(), { mercado: 'BO', valor: 0.00005, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O).catch((x) => x);
    expect(b.descripcion).toBe('1 a 100');
  });

  it('una referencia guardada con fuente manual se ignora y rige la banda absoluta', async () => {
    const a = new AlmacenMemoria();
    a.docs.set('tenants/t1/cotizaciones/BO', { valor: 12, fecha: '2026-11-04', fuente: 'manual', cotizacionId: 'x' });
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 50, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).resolves.toMatchObject({ valor: 50 });
  });

  it('sin referencia usable rige la banda absoluta del par', async () => {
    const a = new AlmacenMemoria();
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 101, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O))
      .rejects.toThrow('el valor 101 está fuera del rango admitido para BOB/USD (1 a 100)');
    await expect(fijarCotizacionManualDe(a, { mercado: 'BO', valor: 50, actor: adm, ahoraMs: AHORA, confirmarSalto: true }, O)).resolves.toMatchObject({ valor: 50 });
  });

  it('el documento manual no lleva uid; el propietario también puede volver al banco central', async () => {
    const a = await conBcb();
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.2, actor: adm, ahoraMs: AHORA }, O);
    expect(a.docs.get(rutaCotizacionManual('t1', 'BO'))).not.toHaveProperty('por');
    const p = { uid: 'prop', rol: 'propietario' as const, proveedor: 'google.com' };
    await quitarCotizacionManualDe(a, { mercado: 'BO', actor: p, ahoraMs: AHORA + 1, confirmar: true }, O);
    const doc = a.docs.get(rutaCotizacionManual('t1', 'BO'));
    expect(doc).toMatchObject({ activo: false });
    expect(doc).not.toHaveProperty('quitadoPor');
    expect(a.docs.get(`${rutaCotizacionManual('t1', 'BO')}/historial/BO-quitar-${AHORA + 1}`)).toMatchObject({ por: 'prop' });
  });

  it('con un manual vigente, la vigilancia de la fuente automática sigue avisando', async () => {
    const a = new AlmacenMemoria();
    a.docs.set('tenants/t1/cotizaciones/BO', { cotizacionId: 'BO-x', mercado: 'BO', par: 'BOB/USD', valor: 12.06, fecha: '2026-10-20', fuente: 'BCB', origen: 'automatico' });
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.1, actor: adm, ahoraMs: AHORA }, O);
    const avisos: AvisoOperativo[] = [];
    const caida = async (): Promise<never> => { throw new Error('sin red'); };
    await actualizarMercado(a, 'BO', AHORA, { fetchFn: caida, tenantId: 't1', notificador: { notificar: async (x) => { avisos.push(x); } } });
    expect(avisos.map((x) => x.tipo)).toEqual(['fallas_fuente', 'cotizacion_vieja']);
  });

  it('leerTipoCambioDe: referencia, manual vigente con su autor e historial reciente', async () => {
    const base = await conBcb();
    const a: AlmacenCotizaciones = {
      leer: (r) => base.leer(r), transaccion: (f) => base.transaccion(f),
      listarRecientes: async (ruta, limite) => [...base.docs].filter(([k]) => k.startsWith(`${ruta}/`)).map(([, d]) => d).slice(0, limite),
    };
    const vacia = await leerTipoCambioDe(a, 'BO', AHORA, O);
    expect(vacia).toMatchObject({ mercado: 'BO', par: 'BOB/USD', manual: null, historial: [], referencia: { fuente: 'BCB' } });
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.2, actor: adm, ahoraMs: AHORA }, O);
    const v = await leerTipoCambioDe(a, 'BO', AHORA, O);
    expect(v.manual).toMatchObject({ valor: 12.2, por: 'ana' });
    expect(v.historial).toEqual([expect.objectContaining({ accion: 'fijar', por: 'ana', valor: 12.2 })]);
    await quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 1, confirmar: true }, O);
    expect((await leerTipoCambioDe(a, 'BO', AHORA, O)).manual).toBeNull();
    expect((await leerTipoCambioDe(a, 'BO', AHORA, { ...O, limite: 1 })).historial).toHaveLength(1);
  });

  it('leerTipoCambioDe sin listarRecientes: historial vacío; sin referencia: motivo', async () => {
    const a = new AlmacenMemoria();
    const v = await leerTipoCambioDe(a, 'BO', AHORA, O);
    expect(v.historial).toEqual([]);
    expect(v.referencia).toMatchObject({ motivo: expect.any(String) });
    await expect(leerTipoCambioDe(a, 'US', AHORA, O)).rejects.toThrow(RangeError);
  });
});
