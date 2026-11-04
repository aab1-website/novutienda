import { describe, expect, it } from 'vitest';
import { almacenMemoria, borrarSeguro, guardarSeguro, leerSeguro, type AlmacenClaveValor } from './almacen.js';
import { agregar, cambiarCantidad, leerCarrito, MAX_CANTIDAD, MAX_LINEAS, quitar, serializarCarrito, totalUnidades } from './carrito.js';
import { convertir, textoReferencia } from './convertidor.js';
import { formatearMonto, parsearMonto } from './dinero.js';
import { EVENTOS, emitir, escuchar } from './eventos.js';
import { guardarMercado, leerMercado, monedaDe } from './mercado.js';
import { alternarTema, guardarTema, leerTema, temaEfectivo } from './tema.js';
import { enlaceWhatsApp, mensajeComprar, mensajeConsulta } from './whatsapp.js';
import { configCliente } from './config-cliente.js';

const roto: AlmacenClaveValor = {
  getItem: () => { throw new Error('bloqueado'); },
  setItem: () => { throw new Error('bloqueado'); },
  removeItem: () => { throw new Error('bloqueado'); },
};

describe('dinero', () => {
  it('formatea centavos enteros por moneda', () => {
    expect(formatearMonto(12345, 'BOB')).toBe('Bs 123,45');
    expect(formatearMonto(1_234_500, 'BOB')).toBe('Bs 12.345');
    expect(formatearMonto(50_100_000, 'ARS')).toBe('$ 501.000');
    expect(formatearMonto(99, 'USD')).toBe('US$ 0,99');
    expect(formatearMonto(-500, 'USD')).toBe('-US$ 5');
    expect(() => formatearMonto(1.5, 'USD')).toThrow(RangeError);
  });
  it('interpreta lo que escribe una persona', () => {
    expect(parsearMonto('1.234,5')).toBe(1234.5);
    expect(parsearMonto('1234.5')).toBe(1234.5);
    expect(parsearMonto('1 234,50')).toBe(1234.5);
    expect(parsearMonto('12,5')).toBe(12.5);
    expect(parsearMonto('')).toBeNull();
    expect(parsearMonto('abc')).toBeNull();
    expect(parsearMonto('-5')).toBeNull();
    expect(parsearMonto('1e999')).toBeNull();
  });
});

describe('whatsapp', () => {
  it('arma el enlace con el mensaje del botón Comprar', () => {
    const m = mensajeComprar('Televisor X', 'tv-x');
    expect(m).toBe('Hola, quiero comprar: Televisor X (cód. tv-x)');
    const url = enlaceWhatsApp('59100000001', m);
    expect(url).toBe(`https://wa.me/59100000001?text=${encodeURIComponent(m)}`);
  });
  it('sin número válido no hay enlace (nunca uno roto)', () => {
    expect(enlaceWhatsApp(null, 'x')).toBeNull();
    expect(enlaceWhatsApp('', 'x')).toBeNull();
    expect(enlaceWhatsApp('12', 'x')).toBeNull();
    expect(enlaceWhatsApp('+59100000001', 'x')).toBeNull();
    expect(enlaceWhatsApp('5910000000a', 'x')).toBeNull();
  });
  it('acota el largo del mensaje y arma la consulta del carrito', () => {
    expect(enlaceWhatsApp('59100000001', 'a'.repeat(5000))!.length).toBeLessThan(1700);
    expect(mensajeConsulta([{ id: 'a-1', nombre: 'A', cantidad: 2 }])).toBe('Hola, quiero consultar por estos productos:\n- 2 x A (cód. a-1)');
  });
});

describe('carrito', () => {
  const a = { id: 'tv-1', nombre: 'TV' };
  it('agrega, suma, quita y cambia cantidades', () => {
    let c = agregar([], a);
    c = agregar(c, a, 2);
    expect(c).toEqual([{ id: 'tv-1', nombre: 'TV', cantidad: 3 }]);
    expect(totalUnidades(c)).toBe(3);
    c = cambiarCantidad(c, 'tv-1', -1);
    expect(c[0]?.cantidad).toBe(2);
    expect(cambiarCantidad(c, 'tv-1', -5)).toEqual([]);
    expect(cambiarCantidad(c, 'otro-1', 1)).toEqual(c);
    expect(quitar(c, 'tv-1')).toEqual([]);
  });
  it('limita cantidad y número de líneas', () => {
    expect(agregar(agregar([], a, 500), a, 500)[0]?.cantidad).toBe(MAX_CANTIDAD);
    let c = agregar([], a);
    for (let i = 0; i < MAX_LINEAS + 5; i += 1) c = agregar(c, { id: `p-${i + 10}`, nombre: 'P' });
    expect(c).toHaveLength(MAX_LINEAS);
  });
  it('no confía en lo guardado', () => {
    expect(leerCarrito(null)).toEqual([]);
    expect(leerCarrito('{no json')).toEqual([]);
    expect(leerCarrito('{"a":1}')).toEqual([]);
    const sucio = JSON.stringify([
      { id: 'ok-1', nombre: 'Bueno', cantidad: 3 },
      { id: 'ok-1', nombre: 'Repetido', cantidad: 1 },
      { id: '<script>', nombre: 'x', cantidad: 1 },
      { id: 'ok-2', nombre: '', cantidad: 1 },
      { id: 'ok-3', nombre: 'x', cantidad: 'mucho' },
      null,
      { id: 'ok-4', nombre: 'Enorme', cantidad: 9999 },
    ]);
    expect(leerCarrito(sucio)).toEqual([{ id: 'ok-1', nombre: 'Bueno', cantidad: 3 }, { id: 'ok-4', nombre: 'Enorme', cantidad: MAX_CANTIDAD }]);
    expect(leerCarrito(serializarCarrito(agregar([], a)))).toEqual([{ id: 'tv-1', nombre: 'TV', cantidad: 1 }]);
  });
});

describe('almacén, mercado y tema', () => {
  it('toleran un almacenamiento bloqueado', () => {
    expect(leerSeguro(roto, 'x')).toBeNull();
    expect(() => guardarSeguro(roto, 'x', '1')).not.toThrow();
    expect(() => borrarSeguro(roto, 'x')).not.toThrow();
    expect(leerSeguro(null, 'x')).toBeNull();
    expect(leerMercado(roto, ['BO'])).toBeNull();
  });
  it('recuerdan el mercado solo si está permitido', () => {
    const a = almacenMemoria();
    expect(leerMercado(a, ['BO', 'AR'])).toBeNull();
    guardarMercado(a, 'AR');
    expect(leerMercado(a, ['BO', 'AR'])).toBe('AR');
    expect(leerMercado(a, ['BO'])).toBeNull();
    a.setItem('cb.mercado', 'XX');
    expect(leerMercado(a, ['BO', 'AR'])).toBeNull();
    expect(monedaDe('BO')).toBe('BOB');
    expect(monedaDe('AR')).toBe('ARS');
  });
  it('el tema sigue al dispositivo hasta que la persona elige', () => {
    const a = almacenMemoria();
    expect(temaEfectivo(leerTema(a), true)).toBe('oscuro');
    expect(temaEfectivo(leerTema(a), false)).toBe('claro');
    guardarTema(a, 'claro');
    expect(temaEfectivo(leerTema(a), true)).toBe('claro');
    expect(alternarTema('claro')).toBe('oscuro');
    expect(alternarTema('oscuro')).toBe('claro');
    a.setItem('cb.tema', 'sepia');
    expect(leerTema(a)).toBeNull();
  });
});

describe('convertidor', () => {
  const cot = {
    BO: { cotizacionId: 'a', par: 'BOB/USD', valor: 10, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' as const },
    AR: { cotizacionId: 'b', par: 'ARS/USD', valor: 1000, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' as const },
  };
  it('usa el dólar como pivote', () => {
    expect(convertir('USD', 2, cot)).toEqual({ USD: 2, BOB: 20, ARS: 2000 });
    expect(convertir('BOB', 50, cot)).toEqual({ USD: 5, BOB: 50, ARS: 5000 });
    expect(convertir('ARS', 3000, cot)).toEqual({ USD: 3, BOB: 30, ARS: 3000 });
  });
  it('sin cotización no inventa nada', () => {
    expect(convertir('USD', 2, { BO: cot.BO })).toEqual({ USD: 2, BOB: 20, ARS: null });
    expect(convertir('ARS', 3000, { BO: cot.BO })).toEqual({ USD: null, BOB: null, ARS: 3000 });
    expect(convertir('BOB', 5, {})).toEqual({ USD: null, BOB: 5, ARS: null });
    expect(textoReferencia(null)).toBe('');
    expect(textoReferencia(12.3456)).toMatch(/12[,.]35/);
  });
});

describe('eventos entre islas y configuración', () => {
  it('emite y escucha, y deja de escuchar', () => {
    const t = new EventTarget();
    const vistos: unknown[] = [];
    const parar = escuchar<number>(EVENTOS.carrito, (d) => vistos.push(d), t);
    emitir(EVENTOS.carrito, 1, t);
    parar();
    emitir(EVENTOS.carrito, 2, t);
    expect(vistos).toEqual([1]);
  });
  it('lee el bloque de configuración o falla con claridad', () => {
    expect(() => configCliente({ getElementById: () => null })).toThrow(/configuración/);
    const el = { textContent: '{"nombre":"X"}' } as HTMLElement;
    expect(configCliente({ getElementById: () => el }).nombre).toBe('X');
    // Queda en memoria: una segunda lectura no vuelve a tocar el documento.
    expect(configCliente({ getElementById: () => null }).nombre).toBe('X');
  });
});
