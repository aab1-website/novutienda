import { describe, expect, it } from 'vitest';
import {
  avisoDesproporcion,
  esCategoriaValida,
  conMiles,
  excedeTopeCentavos,
  mensajeCategoriaInvalida,
  mensajeCostoSobreTope,
  mensajeGuardadoInvalido,
  mensajePrecioSobreTope,
  NOMBRES_MONEDA,
  nombreDeMoneda,
  sugerirCategoria,
  TOPE_PRECIO_BASE_CENTAVOS,
} from './reglas-sitio.js';

describe('categoría', () => {
  it('sugiere un slug', () => {
    expect(sugerirCategoria('Audio')).toBe('audio');
    expect(sugerirCategoria('Electrodomésticos')).toBe('electrodomesticos');
    expect(sugerirCategoria('Línea Blanca')).toBe('linea-blanca');
    expect(sugerirCategoria('ñandú')).toBe('nandu');
    expect(sugerirCategoria('¡¡ ??')).toBe('');
    expect(sugerirCategoria('a'.repeat(80)).length).toBe(60);
  });
  it('valida el slug y el largo', () => {
    expect(esCategoriaValida('audio')).toBe(true);
    expect(esCategoriaValida('linea-blanca')).toBe(true);
    expect(esCategoriaValida('Audio')).toBe(false);
    expect(esCategoriaValida('')).toBe(false);
    expect(esCategoriaValida('a'.repeat(60))).toBe(true);
    expect(esCategoriaValida('a'.repeat(61))).toBe(false);
  });
  it('arma el mensaje', () => {
    expect(mensajeCategoriaInvalida('Audio')).toBe(
      'La categoría va en minúsculas, sin tildes ni espacios: use «audio».',
    );
    expect(mensajeCategoriaInvalida('???')).not.toContain('use «');
  });
});

describe('tope', () => {
  it('el tope justo pasa y uno más falla', () => {
    expect(excedeTopeCentavos(TOPE_PRECIO_BASE_CENTAVOS)).toBe(false);
    expect(excedeTopeCentavos(TOPE_PRECIO_BASE_CENTAVOS + 1)).toBe(true);
    expect(excedeTopeCentavos(Number.NaN)).toBe(true);
  });
  it('mensajes', () => {
    expect(
      mensajePrecioSobreTope(
        { nombre: 'Argentina', monedaBase: 'USD', monedaVenta: 'ARS' },
        'pesos argentinos',
      ),
    ).toBe(
      'El precio de Argentina va en USD (moneda base) y supera el tope de 1.000.000: ¿lo cargó en pesos argentinos?',
    );
    expect(
      mensajePrecioSobreTope({ nombre: 'Bolivia', monedaBase: 'USD', monedaVenta: 'USD' }),
    ).toBe('El precio de Bolivia va en USD (moneda base) y supera el tope de 1.000.000.');
  });
});

describe('desproporción', () => {
  const mercados = [
    { id: 'bo', nombre: 'Bolivia', monedaBase: 'USD' },
    { id: 'ar', nombre: 'Argentina', monedaBase: 'USD' },
    { id: 'x', nombre: 'Otro', monedaBase: 'BOB' },
  ];
  it('avisa por encima de 10 veces', () => {
    expect(avisoDesproporcion({ bo: 1000, ar: 10001 }, mercados)).toHaveLength(1);
  });
  it('no avisa en 10 veces justas, con ceros ni entre monedas distintas', () => {
    expect(avisoDesproporcion({ bo: 1000, ar: 10000 }, mercados)).toEqual([]);
    expect(avisoDesproporcion({ bo: 0, ar: 50000 }, mercados)).toEqual([]);
    expect(avisoDesproporcion({ bo: 100, x: 999999 }, mercados)).toEqual([]);
  });
});

describe('mensajes centralizados', () => {
  it('conMiles separa con punto', () => {
    expect(conMiles(0)).toBe('0');
    expect(conMiles(999)).toBe('999');
    expect(conMiles(1000)).toBe('1.000');
    expect(conMiles(1234567.9)).toBe('1.234.567');
    expect(conMiles(-1234)).toBe('-1.234');
  });
  it('nombra las monedas o devuelve el código', () => {
    expect(NOMBRES_MONEDA.ARS).toBe('pesos argentinos');
    expect(Object.isFrozen(NOMBRES_MONEDA)).toBe(true);
    expect(nombreDeMoneda('USD')).toBe('dólares');
    expect(nombreDeMoneda('BOB')).toBe('bolivianos');
    expect(nombreDeMoneda('EUR')).toBe('EUR');
    expect(nombreDeMoneda('toString')).toBe('toString');
  });
  it('el precio usa el nombre de la moneda de venta por defecto', () => {
    expect(
      mensajePrecioSobreTope({ nombre: 'Argentina', monedaBase: 'USD', monedaVenta: 'ARS' }),
    ).toBe(
      'El precio de Argentina va en USD (moneda base) y supera el tope de 1.000.000: ¿lo cargó en pesos argentinos?',
    );
    expect(
      mensajePrecioSobreTope({ nombre: 'X', monedaBase: 'USD', monedaVenta: 'EUR' }),
    ).toContain('¿lo cargó en EUR?');
  });
  it('arma el mensaje de costo', () => {
    expect(mensajeCostoSobreTope('USD')).toBe(
      'El costo va en USD y supera el tope de 1.000.000: revise que no tenga ceros de más ni esté en otra moneda.',
    );
  });
  it('arma el mensaje de dato guardado inválido', () => {
    expect(
      mensajeGuardadoInvalido(
        'La categoría guardada «Audio»',
        'va en minúsculas, sin tildes ni espacios: use «audio».',
      ),
    ).toBe(
      'La categoría guardada «Audio» no cumple: va en minúsculas, sin tildes ni espacios: use «audio». Corríjalo antes de guardar.',
    );
  });
});
