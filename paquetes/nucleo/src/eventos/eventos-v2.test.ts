import { describe, expect, it } from 'vitest';
import type { SobreEvento } from '../contratos/sobre-evento.js';
import { COMERCIAL_LEGADO_TRES_MONEDAS } from '../tipo-cambio/tipos.js';
import type { ConfiguracionComercial, MercadoTenant } from '../tenant/mercados.js';
import { coherenteConComercial, versionDeEventos } from './comercial-v2.js';
import { CONTRATOS_POR_VERSION, CONTRATOS_V1, CONTRATOS_V2, validarEvento } from './contratos.js';
import { normalizarDatosAV2, normalizarEventoAV2 } from './normalizar-v2.js';
import { fixturesPedidoConfirmadoV1, validarPedidoConfirmadoV1 } from './pedido-confirmado.v1.js';
import { fixturesPedidoConfirmadoV2, validarPedidoConfirmadoV2 } from './pedido-confirmado.v2.js';
import { fixturesPedidoSolicitadoV1, validarPedidoSolicitadoV1 } from './pedido-solicitado.v1.js';
import { fixturesPedidoSolicitadoV2, validarPedidoSolicitadoV2 } from './pedido-solicitado.v2.js';
import { fixturesTurnoCerradoV1, validarTurnoCerradoV1 } from './turno-cerrado.v1.js';
import { fixturesTurnoCerradoV2, validarTurnoCerradoV2 } from './turno-cerrado.v2.js';
import { fixturesVentaAnuladaV1, validarVentaAnuladaV1 } from './venta-anulada.v1.js';
import { fixturesVentaAnuladaV2, validarVentaAnuladaV2 } from './venta-anulada.v2.js';
import { fixturesVentaConfirmadaV1, validarVentaConfirmadaV1 } from './venta-confirmada.v1.js';
import { fixturesVentaConfirmadaV2, validarVentaConfirmadaV2 } from './venta-confirmada.v2.js';

/** Elemento de un arreglo de fixtures (falla si no existe, para no usar aserciones). */
function en<T>(a: readonly T[], i: number): T {
  const x = a[i];
  if (x === undefined) throw new Error(`falta el fixture ${i}`);
  return x;
}

const v2 = [
  ['venta.confirmada', validarVentaConfirmadaV2, fixturesVentaConfirmadaV2],
  ['venta.anulada', validarVentaAnuladaV2, fixturesVentaAnuladaV2],
  ['turno.cerrado', validarTurnoCerradoV2, fixturesTurnoCerradoV2],
  ['pedido.solicitado', validarPedidoSolicitadoV2, fixturesPedidoSolicitadoV2],
  ['pedido.confirmado', validarPedidoConfirmadoV2, fixturesPedidoConfirmadoV2],
] as const;

const v1 = [
  ['venta.confirmada', validarVentaConfirmadaV1, fixturesVentaConfirmadaV1],
  ['venta.anulada', validarVentaAnuladaV1, fixturesVentaAnuladaV1],
  ['turno.cerrado', validarTurnoCerradoV1, fixturesTurnoCerradoV1],
  ['pedido.solicitado', validarPedidoSolicitadoV1, fixturesPedidoSolicitadoV1],
  ['pedido.confirmado', validarPedidoConfirmadoV1, fixturesPedidoConfirmadoV1],
] as const;

describe.each(v2)('contrato %s v2', (tipo, validar, fixtures) => {
  it('está registrado en la versión 2 y la v1 sigue registrada', () => {
    expect(CONTRATOS_V2[tipo]).toBe(validar);
    expect(CONTRATOS_POR_VERSION[1]).toBe(CONTRATOS_V1);
    expect(CONTRATOS_POR_VERSION[2]).toBe(CONTRATOS_V2);
  });
  it.each(fixtures.validos.map((d, i) => [i, d] as const))('acepta el fixture válido %i', (_i, datos) => {
    expect(validar(datos).ok).toBe(true);
  });
  it.each(fixtures.invalidos.map((f) => [f.nombre, f.datos] as const))('rechaza el fixture inválido: %s', (_n, datos) => {
    expect(validar(datos).ok).toBe(false);
  });
});

describe('invariantes de moneda y cotización (v2)', () => {
  const venta = fixturesVentaConfirmadaV2.validos;
  const v0 = en(venta, 0);
  it('con cotización, el par es moneda/base', () => {
    const r = validarVentaConfirmadaV2({ ...v0, cotizacion: { ...v0.cotizacion!, par: 'CLP/USD' } });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('CLP/EUR');
  });
  it('sin cotización solo si la moneda es la base', () => {
    expect(validarVentaConfirmadaV2({ ...venta[0], cotizacion: null }).ok).toBe(false);
    expect(validarVentaConfirmadaV2(venta[1]).ok).toBe(true);
  });
  it('el mercado del pedido son dos letras mayúsculas', () => {
    expect(validarPedidoSolicitadoV2({ ...fixturesPedidoSolicitadoV2.validos[0], mercado: 'C' }).ok).toBe(false);
    expect(validarPedidoSolicitadoV2({ ...fixturesPedidoSolicitadoV2.validos[0], mercado: 'C1' }).ok).toBe(false);
  });
});

describe('validarEvento con versiones', () => {
  const sobre = (tipo: string, version: number, datos: unknown) => ({
    id: 'e1', tipo, version, tenantId: 't1', origen: 'pos', ocurridoEn: '2026-11-04T12:00:00Z', claveIdempotencia: 'k1', datos,
  });
  it('acepta un v2 válido y rechaza un v2 inválido', () => {
    expect(validarEvento(sobre('venta.confirmada', 2, fixturesVentaConfirmadaV2.validos[0])).ok).toBe(true);
    expect(validarEvento(sobre('venta.confirmada', 2, { ...fixturesVentaConfirmadaV2.validos[0], cotizacion: null })).ok).toBe(false);
  });
  it('los datos v2 con sobre v1 (y al revés) se rechazan: cada versión valida con su contrato', () => {
    expect(validarEvento(sobre('venta.confirmada', 1, fixturesVentaConfirmadaV2.validos[0])).ok).toBe(false);
    expect(validarEvento(sobre('venta.confirmada', 2, fixturesVentaConfirmadaV1.validos[0])).ok).toBe(false);
  });
  it('un tipo sin v2 no admite la versión 2', () => {
    const r = validarEvento(sobre('stock.bajo', 2, {}));
    expect(r.ok).toBe(false);
  });
  it.each([0, 3, 1.5, '2', null])('rechaza la versión no registrada %s', (version) => {
    expect(validarEvento({ ...sobre('venta.anulada', 1, fixturesVentaAnuladaV2.validos[0]), version })).toEqual({ ok: false, error: 'Versión de evento desconocida' });
  });
  it('rechaza una versión heredada del prototipo', () => {
    expect(validarEvento({ ...sobre('venta.anulada', 1, {}), version: 'constructor' }).ok).toBe(false);
  });
});

describe('los fixtures v1 validan igual', () => {
  it.each(v1)('%s v1: válidos e inválidos intactos', (_t, validar, fixtures) => {
    for (const d of fixtures.validos) expect(validar(d).ok).toBe(true);
    for (const f of fixtures.invalidos) expect(validar(f.datos).ok).toBe(false);
  });
});

describe('normalizar un evento v1 a v2 (ida)', () => {
  it.each(v1)('todo %s v1 válido se normaliza a un v2 válido', (tipo, _validar, fixtures) => {
    const validarV2 = CONTRATOS_V2[tipo]!;
    for (const d of fixtures.validos) {
      const r = validarV2(normalizarDatosAV2(tipo, d));
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    }
  });
  it('un sobre v1 sale como v2 válido para validarEvento', () => {
    const sobre: SobreEvento = {
      id: 'e1', tipo: 'venta.confirmada', version: 1, tenantId: 't1', origen: 'pos', ocurridoEn: '2026-11-04T12:00:00Z',
      claveIdempotencia: 'k1', datos: fixturesVentaConfirmadaV1.validos[0],
    };
    const n = normalizarEventoAV2(sobre);
    expect(n.version).toBe(2);
    expect(validarEvento(n).ok).toBe(true);
    expect(sobre.version).toBe(1);
  });
  it('la venta v1 gana monedaBase USD y conserva su cotización; en USD queda null', () => {
    const bob = en(fixturesVentaConfirmadaV1.validos, 0);
    const usd = en(fixturesVentaConfirmadaV1.validos, 1);
    expect(normalizarDatosAV2('venta.confirmada', bob)).toMatchObject({ monedaBase: 'USD', cotizacion: bob.cotizacion });
    expect(normalizarDatosAV2('venta.confirmada', usd)).toMatchObject({ monedaBase: 'USD', cotizacion: null });
  });
  it('un pedido v1 en USD (con cotización en v1) pasa a cotización null; en moneda local la conserva', () => {
    const d = en(fixturesPedidoSolicitadoV1.validos, 0);
    expect(normalizarDatosAV2('pedido.solicitado', d)).toMatchObject({ monedaBase: 'USD', cotizacion: d.cotizacion });
    const enUsd = { ...d, moneda: 'USD' };
    expect(validarPedidoSolicitadoV1(enUsd).ok).toBe(true);
    const n = normalizarDatosAV2('pedido.solicitado', enUsd);
    expect(n).toMatchObject({ moneda: 'USD', cotizacion: null });
    expect(validarPedidoSolicitadoV2(n).ok).toBe(true);
  });
  it('un tipo sin v2 y un sobre v2 salen sin cambios', () => {
    const stock = { id: 'e', tipo: 'stock.bajo', version: 1, tenantId: 't', origen: 'inventarios', ocurridoEn: '2026-11-04T12:00:00Z', claveIdempotencia: 'k', datos: {} } as SobreEvento;
    expect(normalizarEventoAV2(stock)).toBe(stock);
    const e2 = { ...stock, tipo: 'venta.anulada', version: 2 } as SobreEvento;
    expect(normalizarEventoAV2(e2)).toBe(e2);
  });
});

const mercado = (parcial: Partial<MercadoTenant> & Pick<MercadoTenant, 'id' | 'monedaVenta'>): MercadoTenant => ({
  nombre: parcial.id, monedaBase: 'USD', zonaHoraria: 'America/La_Paz',
  tipoCambio: { par: `${parcial.monedaVenta}/USD`, fuentes: ['manual'] }, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ...parcial,
});
const legado = COMERCIAL_LEGADO_TRES_MONEDAS;
const sinCambio: ConfiguracionComercial = {
  mercados: [{ ...mercado({ id: 'CL', monedaVenta: 'CLP', monedaBase: 'CLP' }), tipoCambio: null }],
  monedas: ['CLP'],
};
const tercerMercado: ConfiguracionComercial = { mercados: [...legado.mercados, mercado({ id: 'PE', monedaVenta: 'PEN' })], monedas: [...legado.monedas, 'PEN'] };
const baseEuro: ConfiguracionComercial = {
  mercados: [mercado({ id: 'BO', monedaVenta: 'BOB', monedaBase: 'EUR', tipoCambio: { par: 'BOB/EUR', fuentes: ['manual'] } })],
  monedas: ['BOB', 'EUR'],
};

describe('versionDeEventos (D13)', () => {
  it('el tenant de tres monedas y su derivado legado emiten v1', () => expect(versionDeEventos(legado)).toBe(1));
  it('un solo mercado del legado también cabe en v1', () => {
    expect(versionDeEventos({ mercados: [en(legado.mercados, 0)], monedas: ['BOB', 'USD'] })).toBe(1);
  });
  it('un mercado sin tipo de cambio es v2', () => expect(versionDeEventos(sinCambio)).toBe(2));
  it('un tercer mercado es v2', () => expect(versionDeEventos(tercerMercado)).toBe(2));
  it('una moneda base distinta de USD es v2', () => expect(versionDeEventos(baseEuro)).toBe(2));
  it('una moneda de caja fuera de BOB, USD y ARS es v2', () => {
    expect(versionDeEventos({ ...legado, monedas: [...legado.monedas, 'EUR'] })).toBe(2);
  });
  it('un mercado que vende en otra moneda o con otro par es v2', () => {
    expect(versionDeEventos({ mercados: [{ ...en(legado.mercados, 0), monedaVenta: 'ARS' }], monedas: legado.monedas })).toBe(2);
    expect(versionDeEventos({ mercados: [{ ...en(legado.mercados, 0), tipoCambio: { par: 'ARS/USD', fuentes: ['manual'] } }], monedas: legado.monedas })).toBe(2);
  });
});

describe('coherenteConComercial', () => {
  const sobre = (tipo: string, version: 1 | 2, datos: unknown): SobreEvento => ({
    id: 'e1', tipo, version, tenantId: 't1', origen: 'pos', ocurridoEn: '2026-11-04T12:00:00Z', claveIdempotencia: 'k1', datos,
  });
  const ped = fixturesPedidoSolicitadoV2.validos;
  const venta = fixturesVentaConfirmadaV2.validos;
  const clp: ConfiguracionComercial = {
    mercados: [mercado({ id: 'CL', monedaVenta: 'CLP', monedaBase: 'EUR', tipoCambio: { par: 'CLP/EUR', fuentes: ['manual'] } })],
    monedas: ['CLP', 'EUR'],
  };
  it('acepta un pedido y una venta del tenant', () => {
    expect(coherenteConComercial(sobre('pedido.solicitado', 2, ped[0]), clp).ok).toBe(true);
    expect(coherenteConComercial(sobre('venta.confirmada', 2, venta[0]), clp).ok).toBe(true);
    expect(coherenteConComercial(sobre('venta.confirmada', 2, venta[1]), clp).ok).toBe(true);
  });
  it('rechaza un mercado que el tenant no declara', () => {
    expect(coherenteConComercial(sobre('pedido.confirmado', 2, fixturesPedidoConfirmadoV2.validos[0]), legado)).toMatchObject({ ok: false });
    expect(coherenteConComercial(sobre('pedido.solicitado', 2, { ...ped[0], mercado: 'ZZ' }), clp)).toMatchObject({ ok: false });
  });
  it('rechaza moneda, base o par que el mercado no tiene', () => {
    expect(coherenteConComercial(sobre('pedido.solicitado', 2, { ...en(ped, 0), monedaBase: 'USD', cotizacion: { ...en(ped, 0).cotizacion!, par: 'CLP/USD' } }), clp).ok).toBe(false);
    expect(coherenteConComercial(sobre('pedido.solicitado', 2, { ...en(ped, 0), moneda: 'BOB', cotizacion: { ...en(ped, 0).cotizacion!, par: 'BOB/EUR' } }), clp).ok).toBe(false);
    expect(coherenteConComercial(sobre('venta.confirmada', 2, venta[3]), clp).ok).toBe(false);
  });
  it('rechaza una moneda de venta fuera de las monedas de caja', () => {
    expect(coherenteConComercial(sobre('venta.confirmada', 2, venta[0]), { ...clp, monedas: ['CLP'] }).ok).toBe(true);
    expect(coherenteConComercial(sobre('venta.confirmada', 2, venta[1]), { ...clp, monedas: ['CLP'] }).ok).toBe(false);
  });
  it('turno y anulación: sus monedas deben ser de caja del tenant', () => {
    expect(coherenteConComercial(sobre('turno.cerrado', 2, fixturesTurnoCerradoV2.validos[0]), clp).ok).toBe(true);
    expect(coherenteConComercial(sobre('turno.cerrado', 2, fixturesTurnoCerradoV2.validos[0]), legado).ok).toBe(false);
    expect(coherenteConComercial(sobre('venta.anulada', 2, fixturesVentaAnuladaV2.validos[0]), clp).ok).toBe(true);
    expect(coherenteConComercial(sobre('venta.anulada', 2, fixturesVentaAnuladaV2.validos[0]), legado).ok).toBe(false);
  });
  it('todo evento v1 válido del fixture es coherente con el tenant de tres monedas (se normaliza antes)', () => {
    const todos: [string, readonly unknown[]][] = [
      ['venta.confirmada', fixturesVentaConfirmadaV1.validos], ['venta.anulada', fixturesVentaAnuladaV1.validos],
      ['turno.cerrado', fixturesTurnoCerradoV1.validos], ['pedido.solicitado', fixturesPedidoSolicitadoV1.validos],
      ['pedido.confirmado', fixturesPedidoConfirmadoV1.validos],
    ];
    for (const [tipo, datos] of todos) for (const d of datos) expect(coherenteConComercial(sobre(tipo, 1, d), legado)).toMatchObject({ ok: true });
  });
  it('un tipo sin mercado ni moneda es coherente siempre', () => {
    expect(coherenteConComercial(sobre('stock.bajo', 1, {}), clp).ok).toBe(true);
  });
});
