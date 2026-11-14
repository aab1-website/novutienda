import { describe, expect, it } from 'vitest';
import {
  COMERCIAL_LEGADO_TRES_MONEDAS,
  comercialDe,
  comercialLegado,
  esMultimercado,
  fuentesDe,
  mercadoDe,
  mercadosDe,
  monedaBaseDe,
  monedaDe,
  monedasCaja,
  parDe,
  redondeoPorMoneda,
  tieneTipoCambio,
  validarConfiguracionComercial,
  validarTenant,
  zonaDe,
  type ConfiguracionComercial,
} from '@novutienda/nucleo';

const dos = (): ConfiguracionComercial => JSON.parse(JSON.stringify(COMERCIAL_LEGADO_TRES_MONEDAS)) as ConfiguracionComercial;

/** Un tenant de una moneda y un mercado, sin tipo de cambio (precio base = precio de venta). */
const una = () => ({
  mercados: [{
    id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', zonaHoraria: 'America/Bogota',
    tipoCambio: null, redondeo: { tipo: 'multiplo', multiplo: 50, modo: 'cercano' },
  }],
  monedas: ['COP'],
});

const rechaza = (x: unknown, campo: string) => {
  const r = validarConfiguracionComercial(x);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain(campo);
};

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mod = (f: (c: Mutable) => void, base: () => unknown = dos): unknown => {
  const c = base() as Mutable;
  f(c);
  return c;
};

describe('configuración comercial: aceptación', () => {
  it('acepta la declaración del tenant de tres monedas', () => {
    expect(validarConfiguracionComercial(dos()).ok).toBe(true);
  });
  it('acepta un tenant de una moneda y un mercado sin tipo de cambio', () => {
    expect(validarConfiguracionComercial(una()).ok).toBe(true);
  });
  it('acepta monedas de caja adicionales a las de venta', () => {
    expect(validarConfiguracionComercial(mod((c) => c.monedas.push('EUR'), una)).ok).toBe(true);
  });
  it('acepta un mercado con base distinta, par venta/base y fuente manual', () => {
    const c = mod((x) => {
      x.mercados[0].monedaBase = 'USD';
      x.mercados[0].tipoCambio = { par: 'COP/USD', fuentes: ['manual'] };
      x.monedas = ['COP', 'USD'];
    }, una);
    expect(validarConfiguracionComercial(c).ok).toBe(true);
  });
});

describe('configuración comercial: rechazos con el campo en el motivo', () => {
  it('falla cerrado sin mercados', () => {
    rechaza({ monedas: ['BOB'] }, 'comercial.mercados');
    rechaza({ mercados: [], monedas: ['BOB'] }, 'comercial.mercados');
    rechaza(undefined, 'comercial');
    rechaza([], 'comercial');
  });
  it('id de mercado inválido o repetido', () => {
    rechaza(mod((c) => (c.mercados[0].id = 'bo')), 'mercados[0].id');
    rechaza(mod((c) => (c.mercados[0].id = 'BOL')), 'mercados[0].id');
    rechaza(mod((c) => (c.mercados[1].id = 'BO')), 'mercados[1].id');
  });
  it('nombre vacío', () => rechaza(mod((c) => (c.mercados[0].nombre = ' ')), 'mercados[0].nombre'));
  it('monedas con formato inválido', () => {
    rechaza(mod((c) => (c.mercados[0].monedaVenta = 'bob')), 'mercados[0].monedaVenta');
    rechaza(mod((c) => (c.mercados[0].monedaBase = 'US')), 'mercados[0].monedaBase');
  });
  it('zona horaria que no es IANA', () => {
    rechaza(mod((c) => (c.mercados[0].zonaHoraria = 'Bolivia/La_Paz')), 'mercados[0].zonaHoraria');
    rechaza(mod((c) => (c.mercados[0].zonaHoraria = '')), 'mercados[0].zonaHoraria');
  });
  it('redondeo inválido', () => {
    rechaza(mod((c) => delete c.mercados[0].redondeo), 'mercados[0].redondeo');
    rechaza(mod((c) => (c.mercados[0].redondeo = { tipo: 'decimales', decimales: 9, modo: 'cercano' })), 'mercados[0].redondeo');
    rechaza(mod((c) => (c.mercados[1].redondeo = { tipo: 'multiplo', multiplo: 0, modo: 'cercano' })), 'mercados[1].redondeo');
  });
  it('base distinta de la venta exige tipo de cambio', () => {
    rechaza(mod((c) => (c.mercados[0].tipoCambio = null)), 'mercados[0].tipoCambio');
    rechaza(mod((c) => delete c.mercados[0].tipoCambio), 'mercados[0].tipoCambio');
  });
  it('base igual a la venta exige tipoCambio null', () => {
    rechaza(mod((c) => (c.mercados[0].tipoCambio = { par: 'COP/COP', fuentes: ['manual'] }), una), 'mercados[0].tipoCambio');
  });
  it('el par debe ser venta/base', () => {
    rechaza(mod((c) => (c.mercados[0].tipoCambio.par = 'USD/BOB')), 'venta/base');
    rechaza(mod((c) => (c.mercados[0].tipoCambio.par = 'BOBUSD')), 'mercados[0].tipoCambio.par');
    rechaza(mod((c) => (c.mercados[1].tipoCambio.par = 'BOB/USD')), 'mercados[1].tipoCambio.par');
  });
  it('fuentes vacías, desconocidas o repetidas', () => {
    rechaza(mod((c) => (c.mercados[0].tipoCambio.fuentes = [])), 'tipoCambio.fuentes');
    rechaza(mod((c) => (c.mercados[0].tipoCambio.fuentes = ['XYZ'])), 'tipoCambio.fuentes');
    rechaza(mod((c) => (c.mercados[1].tipoCambio.fuentes = ['BNA', 'BNA'])), 'tipoCambio.fuentes');
  });
  it('monedas de caja: vacías, repetidas, mal formadas o sin la de venta', () => {
    rechaza(mod((c) => (c.monedas = [])), 'comercial.monedas');
    rechaza(mod((c) => (c.monedas = ['BOB', 'BOB', 'ARS'])), 'comercial.monedas');
    rechaza(mod((c) => (c.monedas = ['BOB', 'ars', 'USD'])), 'comercial.monedas');
    rechaza(mod((c) => (c.monedas = ['BOB', 'USD'])), 'ARS');
  });
});

describe('dinero en centavos y redondeo por moneda', () => {
  it('rechaza monedas de tres o más decimales', () => {
    for (const k of ['KWD', 'BHD', 'JOD', 'OMR', 'TND']) {
      rechaza(mod((c) => { c.mercados[0].monedaVenta = k; c.monedas = [k]; c.mercados[0].monedaBase = k; c.mercados[0].tipoCambio = null; }, una), 'más de 2 decimales');
    }
    rechaza(mod((c) => (c.monedas.push('KWD')), una), 'comercial.monedas');
    rechaza(mod((c) => { c.mercados[0].monedaBase = 'BHD'; c.mercados[0].tipoCambio = { par: 'COP/BHD', fuentes: ['manual'] }; }, una), 'monedaBase');
  });
  it('rechaza un redondeo con más de 2 decimales y acepta 0, 1 y 2', () => {
    rechaza(mod((c) => (c.mercados[0].redondeo = { tipo: 'decimales', decimales: 3, modo: 'cercano' })), 'más de 2 decimales');
    rechaza(mod((c) => (c.mercados[0].redondeo = { tipo: 'multiplo', multiplo: 0.001, modo: 'cercano' })), 'múltiplo');
    for (const d of [0, 1, 2]) {
      expect(validarConfiguracionComercial(mod((c) => (c.mercados[0].redondeo = { tipo: 'decimales', decimales: d, modo: 'cercano' }))).ok).toBe(true);
    }
    expect(validarConfiguracionComercial(mod((c) => (c.mercados[0].redondeo = { tipo: 'multiplo', multiplo: 0.05, modo: 'arriba' }))).ok).toBe(true);
  });
  it('dos mercados en la misma moneda deben tener el mismo redondeo', () => {
    const dosEnUna = (r2: unknown) => mod((c) => {
      c.mercados.push({ ...c.mercados[0], id: 'CX', nombre: 'Otro', redondeo: r2 });
    }, una);
    expect(validarConfiguracionComercial(dosEnUna({ modo: 'cercano', multiplo: 50, tipo: 'multiplo' })).ok).toBe(true);
    rechaza(dosEnUna({ tipo: 'multiplo', multiplo: 100, modo: 'cercano' }), 'misma moneda');
    rechaza(dosEnUna({ tipo: 'ninguno' }), 'mercados[1].redondeo');
  });
});

describe('topes de tamaño y forma cerrada', () => {
  it('rechaza más de 20 mercados o monedas antes de recorrer', () => {
    const muchos = { mercados: Array.from({ length: 21 }, () => ({})), monedas: ['COP'] };
    rechaza(muchos, 'más de 20 mercados');
    rechaza({ ...una(), monedas: Array.from({ length: 21 }, (_, i) => `A${String.fromCharCode(65 + i)}A`) }, 'más de 20 monedas');
  });
  it('limita el nombre: largo máximo, vacío y caracteres de control', () => {
    rechaza(mod((c) => (c.mercados[0].nombre = 'x'.repeat(81))), 'nombre');
    rechaza(mod((c) => (c.mercados[0].nombre = 'Bo\nlivia')), 'control');
    expect(validarConfiguracionComercial(mod((c) => (c.mercados[0].nombre = 'x'.repeat(80)))).ok).toBe(true);
  });
  it('rechaza claves desconocidas en cada nivel', () => {
    rechaza(mod((c) => (c.extra = 1)), 'la clave extra');
    rechaza(mod((c) => (c.mercados[0].extra = 1)), 'mercados[0]: la clave extra');
    rechaza(mod((c) => (c.mercados[0].tipoCambio.extra = 1)), 'tipoCambio: la clave extra');
    rechaza(mod((c) => (c.mercados[0].redondeo.extra = 1)), 'redondeo: la clave extra');
  });
  it('limita las fuentes', () => {
    rechaza(mod((c) => (c.mercados[1].tipoCambio.fuentes = ['BNA', 'BCRA', 'manual', 'BCB', 'BNA'])), 'más de 4 fuentes');
  });
  it('devuelve un objeto reconstruido, sin reutilizar el de entrada', () => {
    const entrada = dos();
    const r = validarConfiguracionComercial(entrada);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor).toEqual(entrada);
      expect(r.valor).not.toBe(entrada);
      expect(r.valor.mercados[0]).not.toBe(entrada.mercados[0]);
      expect(r.valor.mercados[0]!.tipoCambio).not.toBe(entrada.mercados[0]!.tipoCambio);
    }
  });
  it('ningún mercado, con o sin tipo de cambio, admite «ninguno» (D7)', () => {
    rechaza(mod((c) => (c.mercados[0].redondeo = { tipo: 'ninguno' })), 'sin redondear');
    rechaza(mod((c) => (c.mercados[0].redondeo = { tipo: 'ninguno' }), una), 'sin redondear');
  });
  it('cada regla de redondeo rechazada dice por qué y las admitidas pasan', () => {
    const malas: [unknown, string][] = [
      [{ tipo: 'decimales', decimales: 3, modo: 'cercano' }, 'más de 2 decimales'], [{ tipo: 'decimales', decimales: -1, modo: 'cercano' }, 'decimales'],
      [{ tipo: 'decimales', decimales: 1.5, modo: 'cercano' }, 'decimales'], [{ tipo: 'multiplo', multiplo: 0.005, modo: 'cercano' }, 'múltiplo'],
      [{ tipo: 'multiplo', multiplo: 0, modo: 'cercano' }, 'múltiplo'], [{ tipo: 'multiplo', multiplo: 0.015, modo: 'cercano' }, 'centavos exactos'],
      [{ tipo: 'multiplo', multiplo: Infinity, modo: 'cercano' }, 'múltiplo'], [{ tipo: 'decimales', decimales: 2, modo: 'raro' }, 'modo'], [undefined, 'falta la regla'],
    ];
    for (const [r, motivo] of malas) rechaza(mod((c) => (c.mercados[0].redondeo = r as never), una), motivo);
    for (const r of [{ tipo: 'multiplo', multiplo: 0.01, modo: 'abajo' }, { tipo: 'multiplo', multiplo: 0.05, modo: 'cercano' }, { tipo: 'multiplo', multiplo: 100, modo: 'arriba' }]) {
      expect(validarConfiguracionComercial(mod((c) => (c.mercados[0].redondeo = r as never), una)).ok).toBe(true);
    }
  });
});

describe('consultas puras', () => {
  const c = COMERCIAL_LEGADO_TRES_MONEDAS;
  it('responden por mercado declarado', () => {
    expect(mercadosDe(c)).toEqual(['BO', 'AR']);
    expect(monedaDe(c, 'AR')).toBe('ARS');
    expect(monedaBaseDe(c, 'AR')).toBe('USD');
    expect(parDe(c, 'BO')).toBe('BOB/USD');
    expect(zonaDe(c, 'AR')).toBe('America/Argentina/Buenos_Aires');
    expect(tieneTipoCambio(c, 'BO')).toBe(true);
    expect(fuentesDe(c, 'AR')).toEqual(['BNA', 'BCRA']);
    expect(monedasCaja(c)).toEqual(['BOB', 'USD', 'ARS']);
    expect(redondeoPorMoneda(c)).toEqual({ BOB: c.mercados[0]!.redondeo, ARS: c.mercados[1]!.redondeo });
    expect(esMultimercado(c)).toBe(true);
  });
  it('un mercado no declarado no devuelve nada (falla cerrado)', () => {
    expect(mercadoDe(c, 'CL')).toBeUndefined();
    expect(monedaDe(c, 'CL')).toBeUndefined();
    expect(parDe(c, 'CL')).toBeNull();
    expect(zonaDe(c, 'CL')).toBeUndefined();
    expect(tieneTipoCambio(c, 'CL')).toBe(false);
  });
  it('un tenant de una moneda no tiene par ni es multimercado', () => {
    const u = una() as ConfiguracionComercial;
    expect(parDe(u, 'CO')).toBeNull();
    expect(tieneTipoCambio(u, 'CO')).toBe(false);
    expect(esMultimercado(u)).toBe(false);
  });
});

describe('documento de tenant v3 y legado', () => {
  const base = { estado: 'activo', plan: 'multimercado', modulos: {} };
  it('acepta el documento v3 y lo devuelve tal cual', () => {
    const doc = { ...base, comercial: dos() };
    const r = validarTenant(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(comercialDe(r.valor)).toEqual({ ok: true, valor: doc.comercial });
  });
  it('acepta un tenant de una moneda en el plan base', () => {
    expect(validarTenant({ ...base, plan: 'base', comercial: una() }).ok).toBe(true);
  });
  it('con v3 devuelve la configuración reconstruida, no la de entrada', () => {
    const doc = { ...base, comercial: dos() };
    const r = validarTenant(doc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.valor.comercial).toEqual(doc.comercial);
      expect(r.valor.comercial).not.toBe(doc.comercial);
    }
  });
  it('rechaza mezclar comercial con la forma anterior (zonaHoraria o monedas), coherente o no', () => {
    for (const mezcla of [{ zonaHoraria: 'America/La_Paz' }, { monedas: ['BOB', 'USD', 'ARS'] }, { zonaHoraria: 'America/Lima', monedas: ['COP'] }]) {
      expect(validarTenant({ ...base, comercial: dos(), ...mezcla })).toMatchObject({ ok: false, error: expect.stringContaining('no puede convivir') });
    }
  });
  it('rechaza la v3 inválida, con el campo', () => {
    const r = validarTenant({ ...base, comercial: mod((c) => (c.monedas = ['BOB'])) });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('comercial.monedas') });
  });
  it('rechaza una configuración que supera el plan', () => {
    expect(validarTenant({ ...base, plan: 'base', comercial: dos() })).toMatchObject({ ok: false, error: expect.stringContaining('plan base') });
  });
  it('falla cerrado sin comercial ni campos legado (no asume el tenant de tres monedas)', () => {
    expect(validarTenant(base)).toMatchObject({ ok: false, error: expect.stringContaining('comercial') });
  });
  it('comercialLegado deriva la declaración explícita solo de la forma actual exacta', () => {
    expect(comercialLegado({ zonaHoraria: 'America/La_Paz', monedas: ['ARS', 'BOB', 'USD'] })).toEqual({ ok: true, valor: COMERCIAL_LEGADO_TRES_MONEDAS });
    expect(comercialLegado({ zonaHoraria: 'America/Lima', monedas: ['BOB', 'USD', 'ARS'] }).ok).toBe(false);
    expect(comercialLegado({ zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD'] }).ok).toBe(false);
    expect(comercialLegado({}).ok).toBe(false);
  });
  it('el documento legado válido se lee con la configuración derivada', () => {
    const doc = { ...base, plan: 'base', zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] };
    const r = validarTenant(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(comercialDe(r.valor)).toEqual({ ok: true, valor: COMERCIAL_LEGADO_TRES_MONEDAS });
  });
});
