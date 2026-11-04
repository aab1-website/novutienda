import { describe, expect, it } from 'vitest';
import { decidirCotizacion, type Lectura } from './nucleo-tc.js';
import { AHORA } from './ayudas.js';

const bna = (valor: number, fecha = '2026-11-04'): Lectura => ({ valor, fecha, fuente: 'BNA' });
const bcra = (valor: number, fecha = '2026-11-03'): Lectura => ({ valor, fecha, fuente: 'BCRA' });
const bcb = (valor: number, fecha = '2026-11-04'): Lectura => ({ valor, fecha, fuente: 'BCB' });
const guardado = (valor: number, fecha: string, origen: 'automatico' | 'manual' = 'automatico') => ({ valor, fecha, origen });

describe('decidirCotizacion', () => {
  it('escribe la primera lectura cuando no hay nada guardado', () => {
    const d = decidirCotizacion({ mercado: 'BO', actual: null, principal: bcb(12.06), control: null, ahoraMs: AHORA });
    expect(d).toMatchObject({ accion: 'escribir', nuevo: { valor: 12.06, fecha: '2026-11-04', fuente: 'BCB', origen: 'automatico' }, avisos: [] });
  });
  it('nunca escribe hacia atrás', () => {
    const d = decidirCotizacion({ mercado: 'BO', actual: guardado(12.06, '2026-11-04'), principal: bcb(12.05, '2026-11-03'), control: null, ahoraMs: AHORA });
    expect(d).toMatchObject({ accion: 'anterior' });
  });
  it('no repite lo igual', () => {
    const d = decidirCotizacion({ mercado: 'BO', actual: guardado(12.06, '2026-11-04'), principal: bcb(12.06), control: null, ahoraMs: AHORA });
    expect(d).toMatchObject({ accion: 'igual' });
  });
  it('no pisa una carga manual de igual fecha ni anterior, pero sí una más vieja', () => {
    const manual = guardado(12.5, '2026-11-04', 'manual');
    expect(decidirCotizacion({ mercado: 'BO', actual: manual, principal: bcb(12.06), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'manual_vigente' });
    expect(decidirCotizacion({ mercado: 'BO', actual: manual, principal: bcb(12.06, '2026-11-03'), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'manual_vigente' });
    const vieja = guardado(12.5, '2026-11-03', 'manual');
    expect(decidirCotizacion({ mercado: 'BO', actual: vieja, principal: bcb(12.55), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'escribir' });
  });
  it('rechaza un salto mayor al 5 % por defecto y lo acepta si el umbral es configurable más alto', () => {
    const actual = guardado(1500, '2026-11-03');
    const d = decidirCotizacion({ mercado: 'AR', actual, principal: bna(1600), control: null, ahoraMs: AHORA });
    expect(d).toMatchObject({ accion: 'rechazar', motivo: expect.stringContaining('salto') });
    expect(decidirCotizacion({ mercado: 'AR', actual, principal: bna(1574), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'escribir' });
    expect(decidirCotizacion({ mercado: 'AR', actual, principal: bna(1600), control: null, ahoraMs: AHORA, config: { saltoMaximo: 0.1 } })).toMatchObject({ accion: 'escribir' });
  });
  it('avisa si BNA se desvía de la A 3500 más que el umbral (y escribe igual)', () => {
    const d = decidirCotizacion({ mercado: 'AR', actual: null, principal: bna(1400), control: bcra(1549.7194), ahoraMs: AHORA });
    expect(d.accion).toBe('escribir');
    expect(d.avisos).toEqual([expect.objectContaining({ codigo: 'desvio_control' })]);
    const poco = decidirCotizacion({ mercado: 'AR', actual: null, principal: bna(1520), control: bcra(1549.7194), ahoraMs: AHORA });
    expect(poco.avisos).toEqual([]);
    const estricto = decidirCotizacion({ mercado: 'AR', actual: null, principal: bna(1520), control: bcra(1549.7194), ahoraMs: AHORA, config: { desvioMaximo: 0.01 } });
    expect(estricto.avisos).toHaveLength(1);
  });
  it('usa la A 3500 como respaldo si falla el BNA, con aviso y fuente BCRA', () => {
    const d = decidirCotizacion({ mercado: 'AR', actual: null, principal: null, control: bcra(1549.7194), ahoraMs: AHORA });
    expect(d).toMatchObject({ accion: 'escribir', nuevo: { fuente: 'BCRA', valor: 1549.7194 } });
    expect(d.avisos).toEqual([expect.objectContaining({ codigo: 'respaldo_bcra' })]);
  });
  it('sin ninguna lectura mantiene lo guardado', () => {
    expect(decidirCotizacion({ mercado: 'AR', actual: guardado(1500, '2026-11-03'), principal: null, control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'rechazar' });
  });
  it('rechaza lecturas inválidas, fechas futuras y descarta un control inválido', () => {
    expect(decidirCotizacion({ mercado: 'BO', actual: null, principal: bcb(0), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'rechazar' });
    expect(decidirCotizacion({ mercado: 'BO', actual: null, principal: bcb(12.06, '2026-13-40'), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'rechazar' });
    expect(decidirCotizacion({ mercado: 'BO', actual: null, principal: bcb(12.06, '2026-11-09'), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'rechazar' });
    const d = decidirCotizacion({ mercado: 'AR', actual: null, principal: bna(1520), control: bcra(-1), ahoraMs: AHORA });
    expect(d.accion).toBe('escribir');
    expect(d.avisos).toEqual([expect.objectContaining({ codigo: 'control_invalido' })]);
  });
  it('acepta la tabla del día siguiente que el BCB publica de noche (hasta diasFuturoMax)', () => {
    const noche = Date.parse('2026-11-05T01:30:00Z'); // 4/11 21:30 en La Paz
    expect(decidirCotizacion({ mercado: 'BO', actual: guardado(12.06, '2026-11-04'), principal: bcb(12.06, '2026-11-05'), control: null, ahoraMs: noche })).toMatchObject({ accion: 'escribir' });
    expect(decidirCotizacion({ mercado: 'BO', actual: null, principal: bcb(12.06, '2026-11-06'), control: null, ahoraMs: noche })).toMatchObject({ accion: 'rechazar' });
  });
  it('trata un documento guardado mal formado como ausente y avisa', () => {
    const d = decidirCotizacion({ mercado: 'BO', actual: { valor: 'x' }, principal: bcb(12.06), control: null, ahoraMs: AHORA });
    expect(d.accion).toBe('escribir');
    expect(d.avisos).toEqual([expect.objectContaining({ codigo: 'actual_ilegible' })]);
  });
  it('una carga manual de la misma fecha y valor no cuenta como «igual» de una automática', () => {
    // el automático de igual fecha no pisa lo manual (manual_vigente), aun con el mismo valor
    expect(decidirCotizacion({ mercado: 'BO', actual: guardado(12.06, '2026-11-04', 'manual'), principal: bcb(12.06), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'manual_vigente' });
  });
  it('una lectura de la misma fecha con otro valor dentro del umbral se escribe (el BNA se mueve en el día)', () => {
    expect(decidirCotizacion({ mercado: 'AR', actual: guardado(1520, '2026-11-04'), principal: bna(1530), control: null, ahoraMs: AHORA })).toMatchObject({ accion: 'escribir' });
  });
});
