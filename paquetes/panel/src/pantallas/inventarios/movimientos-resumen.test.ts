import { describe, expect, it } from 'vitest';
import type { ProductoPanel } from '../../api/tipos.js';
import { avisosMayusculas, enLotes, haySeQuedan, leerDiferencia, resumenAjuste, resumenIngreso, resumenTraspaso, revisarAjuste, revisarLineas, separar, seriesNuevasDe, type FilaLinea } from './movimientos-resumen.js';

const prod = (id: string, nombre: string, conSerie: boolean, tienda: number, dep1 = 0): ProductoPanel => ({
  id, nombre, categoria: 'c', sku: id.toUpperCase(), activo: true, publicado: true, conSerie, precioUSD: { bo: 1, ar: 1 }, existencias: { tienda, 'deposito-1': dep1, 'deposito-2': 0 }, bajoMinimo: false, disponible: true,
});
const PRODUCTOS = [prod('cable', 'Cable HDMI 2 m', false, 12, 5), prod('tv', 'Televisor', true, 1)];
const fila = (id: string, productoId: string, cantidad = '', series = ''): FilaLinea => ({ id, productoId, cantidad, series });

describe('revisión de líneas', () => {
  it('sin producto elegido no hay valor por omisión: pide elegir', () => {
    const r = revisarLineas([fila('1', '', '3')], PRODUCTOS);
    expect(r.errores['1.producto']).toBe('Elija un producto de la lista.');
    expect(r.lineas).toBeNull();
  });
  it('«1,5» y vacío se rechazan junto al campo', () => {
    expect(revisarLineas([fila('1', 'cable', '1,5')], PRODUCTOS).errores['1.cantidad']).toMatch(/número entero/);
    expect(revisarLineas([fila('1', 'cable', '')], PRODUCTOS).errores['1.cantidad']).toBe('Escriba la cantidad.');
    expect(revisarLineas([fila('1', 'cable', '0')], PRODUCTOS).errores['1.cantidad']).toMatch(/1 a/);
  });
  it('un producto con serie pide una serie por unidad, sin repetir', () => {
    expect(revisarLineas([fila('1', 'tv', '', '')], PRODUCTOS).errores['1.series']).toBeTruthy();
    expect(revisarLineas([fila('1', 'tv', '', 'A1, A1')], PRODUCTOS).errores['1.series']).toMatch(/repetidas/);
    expect(revisarLineas([fila('1', 'tv', '', 'A1 A2')], PRODUCTOS).lineas).toEqual([{ productoId: 'tv', cantidad: 2, series: ['A1', 'A2'] }]);
  });
  it('en un traspaso avisa si pide más de lo que hay en el origen, sumando las líneas del mismo producto', () => {
    const r = revisarLineas([fila('1', 'cable', '4'), fila('2', 'cable', '4')], PRODUCTOS, 'deposito-1');
    expect(r.errores['1.cantidad']).toBeUndefined();
    expect(r.errores['2.cantidad']).toMatch(/En Depósito 1 hay 5/);
  });
  it('líneas válidas devuelven las líneas del servidor', () => {
    expect(revisarLineas([fila('1', 'cable', '3')], PRODUCTOS).lineas).toEqual([{ productoId: 'cable', cantidad: 3 }]);
  });
  it('el ingreso exige serie de 3 a 60 sin «/» y sin repetidas por mayúsculas; el traspaso admite las ya guardadas', () => {
    const ingreso = (series: string) => revisarLineas([fila('1', 'tv', '', series)], PRODUCTOS, undefined, true);
    expect(ingreso('AB').errores['1.series']).toBe('La serie debe tener de 3 a 60 caracteres: letras, números y - . _ (sin espacios)');
    expect(ingreso('x'.repeat(61)).errores['1.series']).toMatch(/de 3 a 60/);
    expect(ingreso('AB/123').errores['1.series']).toMatch(/de 3 a 60/);
    expect(ingreso('ABC123 abc123').errores['1.series']).toMatch(/mayúsculas/);
    expect(ingreso('ABC ' + 'y'.repeat(60)).lineas).toEqual([{ productoId: 'tv', cantidad: 2, series: ['ABC', 'y'.repeat(60)] }]);
    expect(revisarLineas([fila('1', 'tv', '', 'A1 B')], PRODUCTOS, 'tienda').lineas).toEqual([{ productoId: 'tv', cantidad: 2, series: ['A1', 'B'] }]);
  });

  it('separa series por coma, punto y coma o espacio', () => {
    expect(separar('a, b;c  d')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('resumen', () => {
  const lineas = [{ productoId: 'cable', cantidad: 3 }, { productoId: 'tv', cantidad: 2, series: ['A1', 'A2'] }];
  it('ingreso y traspaso nombran almacén y productos', () => {
    expect(resumenIngreso(lineas, 'tienda', PRODUCTOS).lineas).toEqual(['Entra a Tienda:', '3 × Cable HDMI 2 m', '2 series de Televisor (A1, A2)']);
    expect(resumenTraspaso(lineas, 'deposito-1', 'tienda', PRODUCTOS).lineas[0]).toBe('De Depósito 1 a Tienda:');
  });
  it('el ajuste dice «Hay 12, quedarán 10»', () => {
    expect(haySeQuedan(PRODUCTOS[0], 'tienda', -2)?.texto).toBe('Hay 12, quedarán 10');
    expect(haySeQuedan(PRODUCTOS[0], null, -2)).toBeNull();
    expect(resumenAjuste(PRODUCTOS[0] as ProductoPanel, 'tienda', -2, ' Rotura ').lineas).toEqual(['Cable HDMI 2 m en Tienda: Hay 12, quedarán 10.', 'Diferencia: -2.', 'Motivo: Rotura.']);
  });
});

describe('revisión del ajuste', () => {
  const cable = PRODUCTOS[0];
  it('diferencia: entero distinto de 0, con o sin signo', () => {
    expect(leerDiferencia('+5')).toBe(5);
    expect(leerDiferencia('-2')).toBe(-2);
    expect(leerDiferencia('0')).toBeNull();
    expect(leerDiferencia('1,5')).toBeNull();
  });
  it('marca cada campo y no deja quedar en negativo', () => {
    expect(Object.keys(revisarAjuste(undefined, null, '', ''))).toEqual(['producto', 'almacen', 'diferencia', 'motivo']);
    expect(revisarAjuste(cable, 'tienda', '1,5', 'x').diferencia).toMatch(/entero/);
    expect(revisarAjuste(cable, 'tienda', '-13', 'x').diferencia).toMatch(/Hay 12, quedarán -1: no puede quedar en negativo/);
    expect(revisarAjuste(cable, 'tienda', '-2', 'x')).toEqual({});
  });
});

describe('aviso de mayúsculas antes de ingresar (D3)', () => {
  const u = (productoId: string, serie: string) => ({ productoId, serie, estado: 'disponible', ubicacionId: 'tienda' }) as const;
  it('avisa si el mismo producto ya tiene la serie con otras mayúsculas, y no si es otro producto o la misma', () => {
    const consultadas = seriesNuevasDe([{ productoId: 'tv', cantidad: 3, series: ['abc123', 'XYZ789', 'QQQ111'] }]);
    const avisos = avisosMayusculas(consultadas, [[u('tv', 'ABC123')], [u('otro', 'xyz789')], [u('tv', 'QQQ111')]]);
    expect(avisos).toEqual(['Aviso: la serie abc123 ya existe como ABC123 (con otras mayúsculas).']);
  });
  it('una consulta fallida no da aviso, y se consultan a lo sumo 50 series', () => {
    expect(avisosMayusculas([{ productoId: 'tv', serie: 'abc' }], [null])).toEqual([]);
    const muchas = Array.from({ length: 80 }, (_, i) => `SER-${String(i)}`);
    expect(seriesNuevasDe([{ productoId: 'tv', cantidad: 80, series: muchas }])).toHaveLength(50);
  });
  it('el resumen del ingreso lleva los avisos al final', () => {
    expect(resumenIngreso([{ productoId: 'cable', cantidad: 3 }], 'tienda', PRODUCTOS, ['Aviso: x']).lineas.at(-1)).toBe('Aviso: x');
  });
});

describe('enLotes', () => {
  it('limita la concurrencia y conserva el orden', async () => {
    let activas = 0;
    let maximo = 0;
    const r = await enLotes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 5, async (x) => {
      activas += 1;
      maximo = Math.max(maximo, activas);
      await Promise.resolve();
      activas -= 1;
      return x * 2;
    });
    expect(maximo).toBe(5);
    expect(r).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
  });
});
