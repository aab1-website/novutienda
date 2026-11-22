import { describe, expect, it } from 'vitest';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS, CargaNoAutorizada, ConfirmacionRequerida, SaltoSinConfirmar, SinCotizacionUtilizable,
  escribirCotizacion, fijarCotizacionManualDe, leerCotizacionDe, leerReferenciaDe, quitarCotizacionManualDe,
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
    await expect(quitarCotizacionManualDe(a, { mercado: 'BO', actor: adm, ahoraMs: AHORA + 3, confirmar: true }, O)).rejects.toThrow(RangeError);
    // y se puede volver a fijar
    await fijarCotizacionManualDe(a, { mercado: 'BO', valor: 12.1, actor: adm, ahoraMs: AHORA + 4 }, O);
    expect((await leerCotizacionDe(a, 'BO', AHORA, O)).fuente).toBe('manual');
  });
});
