import { describe, expect, it } from 'vitest';
import { leerCotizacionesBcra, leerPaginaBna, leerTablaBcb } from './nucleo-tc.js';
import { fixture } from './ayudas.js';

describe('BCB: tabla del TCO', () => {
  const html = fixture('bcb-2026-11-04.html');

  it('lee el TCO y la fecha de la página real del 04/11/2026', () => {
    expect(leerTablaBcb(html)).toEqual({ ok: true, lectura: { valor: 12.06, fecha: '2026-11-04', fuente: 'BCB' } });
  });
  it('rechaza si las fechas del rótulo y del título no coinciden', () => {
    const roto = html.replace('TABLA DE COTIZACIONES DEL 4 DE NOVIEMBRE', 'TABLA DE COTIZACIONES DEL 3 DE NOVIEMBRE');
    expect(leerTablaBcb(roto)).toMatchObject({ ok: false, motivo: expect.stringContaining('no coinciden') });
  });
  it('rechaza una página sin fecha, sin tabla del TCO, con dos filas USD o con un valor no numérico', () => {
    expect(leerTablaBcb('<html></html>')).toMatchObject({ ok: false });
    expect(leerTablaBcb(html.replace('Tipo de Cambio Oficial (TCO)', 'Otra cosa'))).toMatchObject({ ok: false, motivo: 'sin la tabla del TCO' });
    const dos = html.replace('</table>\n\n<div class="bloque-titulo">COTIZACI&Oacute;N DE MONEDAS', '<tr><td>USD</td><td>12.07</td></tr></table>\n\n<div class="bloque-titulo">COTIZACI&Oacute;N DE MONEDAS');
    expect(leerTablaBcb(dos)).toMatchObject({ ok: false, motivo: expect.stringContaining('hay 2') });
    expect(leerTablaBcb(html.replace('12.06', 'n/d'))).toMatchObject({ ok: false, motivo: 'el TCO no es un número' });
    expect(leerTablaBcb(html.replace(/FECHA DE LA COTIZACI&Oacute;N/, 'OTRA'))).toMatchObject({ ok: false, motivo: 'sin fecha de la cotización' });
    expect(leerTablaBcb(html.replace('4 de Noviembre 2026', '4 de Brumario 2026').replace('4 DE NOVIEMBRE', '4 DE BRUMARIO'))).toMatchObject({ ok: false });
  });
});

describe('BNA: dólar billete compra', () => {
  const html = fixture('bna-2026-11-04.html');

  it('lee la COMPRA de la pestaña de billetes, no la de divisas (otra fecha y otro formato)', () => {
    const r = leerPaginaBna(html);
    expect(r).toEqual({ ok: true, lectura: { lectura: { valor: 1520, fecha: '2026-11-04', fuente: 'BNA' }, venta: 1570, hora: '09:53' } });
  });
  it('rechaza si falta la pestaña de billetes, la fecha o la fila', () => {
    expect(leerPaginaBna('<html></html>')).toMatchObject({ ok: false, motivo: 'sin la pestaña de billetes' });
    expect(leerPaginaBna(html.replace('4/11/2026', 'hoy'))).toMatchObject({ ok: false, motivo: expect.stringContaining('sin fecha') });
    expect(leerPaginaBna(html.replace('Dolar U.S.A</td>\n                            <td>1520,00', 'Otro</td>\n                            <td>1520,00'))).toMatchObject({
      ok: false, motivo: expect.stringContaining('hay 0'),
    });
  });
  it('rechaza compra o venta no numéricas y venta menor que la compra', () => {
    expect(leerPaginaBna(html.replace('1520,00', 's/c'))).toMatchObject({ ok: false, motivo: 'compra o venta no son números' });
    expect(leerPaginaBna(html.replace('1570,00', '1500,00'))).toMatchObject({ ok: false, motivo: 'la venta es menor que la compra' });
  });
  it('entiende miles con punto y devuelve hora nula si no la trae', () => {
    const miles = html.replace('1520,00', '1.520,50').replace(/<div class="legal">Hora[^<]*<\/div>/, '');
    expect(leerPaginaBna(miles)).toMatchObject({ ok: true, lectura: { lectura: { valor: 1520.5 }, hora: null } });
  });
  it('sin la pestaña de divisas igual lee los billetes', () => {
    const cortado = html.slice(0, html.indexOf('id="divisas"') - 20);
    expect(leerPaginaBna(cortado)).toMatchObject({ ok: true });
  });
});

describe('BCRA: Comunicación A 3500 (REF)', () => {
  it('lee REF de la respuesta por código (results = arreglo)', () => {
    const json = JSON.parse(fixture('bcra-ref-2026-11-03.json')) as unknown;
    expect(leerCotizacionesBcra(json)).toEqual({ ok: true, lectura: { valor: 1549.7194, fecha: '2026-11-03', fuente: 'BCRA' } });
  });
  it('lee REF de la respuesta de todas las monedas (results = objeto) y no confunde USD con A 3500', () => {
    const json = JSON.parse(fixture('bcra-cotizaciones-2026-11-03.json')) as unknown;
    const r = leerCotizacionesBcra(json);
    expect(r).toMatchObject({ ok: true, lectura: { valor: 1549.7194 } });
  });
  it('toma la fecha más reciente cuando hay varias', () => {
    const j = { status: 200, results: [
      { fecha: '2026-11-02', detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 1500 }] },
      { fecha: '2026-11-03', detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 1510 }] },
    ] };
    expect(leerCotizacionesBcra(j)).toMatchObject({ ok: true, lectura: { valor: 1510, fecha: '2026-11-03' } });
  });
  it('rechaza respuestas sin status 200, sin REF, con valor 0 o con fecha mala', () => {
    expect(leerCotizacionesBcra(null)).toMatchObject({ ok: false });
    expect(leerCotizacionesBcra({ status: 404 })).toMatchObject({ ok: false });
    expect(leerCotizacionesBcra({ status: 200, results: [] })).toMatchObject({ ok: false });
    expect(leerCotizacionesBcra({ status: 200, results: { fecha: '2026-11-03', detalle: [{ codigoMoneda: 'USD', tipoCotizacion: 1551 }] } })).toMatchObject({ ok: false });
    expect(leerCotizacionesBcra({ status: 200, results: { fecha: '2026-11-03', detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 0 }] } })).toMatchObject({ ok: false });
    expect(leerCotizacionesBcra({ status: 200, results: { fecha: '03/11/2026', detalle: [{ codigoMoneda: 'REF', tipoCotizacion: 1500 }] } })).toMatchObject({ ok: false });
  });
});
