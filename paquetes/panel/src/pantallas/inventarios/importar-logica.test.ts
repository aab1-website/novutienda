import { describe, expect, it } from 'vitest';
import type { FilaSimulada, MercadoDeclarado, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { aplicables, columnasArchivo, encabezadosPlantilla, lineasConfirmacion, MAX_BYTES_ARCHIVO, notaPrecios, ordenarFilas, resumenSimulacion, textoError, textoResultado, textoTandas, validarArchivo } from './importar-logica.js';

const REF: readonly MercadoDeclarado[] = [
  { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
  { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
];
const UNO: readonly MercadoDeclarado[] = [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', tieneTipoCambio: false }];
const fila = (linea: number, accion: FilaSimulada['accion']): FilaSimulada => ({ linea, id: `p${String(linea)}`, accion, errores: [], advertencias: [], cambios: [] });
const sim = (resumen: Simulacion['resumen']): Simulacion => ({ filas: [], resumen, columnasIgnoradas: [] });

describe('validarArchivo', () => {
  it('admite CSV y Excel, sin importar mayúsculas', () => {
    expect(validarArchivo({ name: 'p.csv', size: 10 })).toBeNull();
    expect(validarArchivo({ name: 'P.XLSX', size: 10 })).toBeNull();
  });
  it('rechaza otros tipos, .xls, vacío y más de 2 MB con un motivo', () => {
    expect(validarArchivo({ name: 'p.pdf', size: 10 })).toMatch(/CSV|Excel/);
    expect(validarArchivo({ name: 'sin-extension', size: 10 })).toMatch(/CSV|Excel/);
    expect(validarArchivo({ name: 'p.xls', size: 10 })).toMatch(/xls/);
    expect(validarArchivo({ name: 'p.csv', size: 0 })).toMatch(/vacío/);
    expect(validarArchivo({ name: 'p.csv', size: MAX_BYTES_ARCHIVO + 1 })).toMatch(/máximo es 2,0 MB/);
    expect(validarArchivo({ name: 'p.csv', size: MAX_BYTES_ARCHIVO })).toBeNull();
  });
});

describe('simulación', () => {
  it('ordena errores primero, luego lo que cambia y al final lo que no, por línea', () => {
    const o = ordenarFilas([fila(2, 'sin-cambios'), fila(3, 'crear'), fila(4, 'error'), fila(5, 'actualizar'), fila(6, 'error')]);
    expect(o.map((f) => f.linea)).toEqual([4, 6, 5, 3, 2]);
  });
  it('resume con las cuatro cifras y concuerda en singular', () => {
    expect(resumenSimulacion({ crear: 3, actualizar: 2, sinCambios: 5, errores: 1 })).toBe('3 se crearán, 2 se actualizarán, 5 sin cambios, 1 con error');
    expect(resumenSimulacion({ crear: 1, actualizar: 1, sinCambios: 0, errores: 0 })).toBe('1 se creará, 1 se actualizará, 0 sin cambios, 0 con error');
    expect(aplicables({ crear: 3, actualizar: 2, sinCambios: 5, errores: 1 })).toBe(5);
  });
  it('el error por columna nombra la columna y el de fila entera solo el motivo', () => {
    expect(textoError({ columna: 'sku', motivo: 'es obligatorio para crear' })).toBe('Columna «sku»: es obligatorio para crear');
    expect(textoError({ columna: null, motivo: 'columnas de más' })).toBe('columnas de más');
  });
});

describe('confirmación y resultado', () => {
  const s = sim({ crear: 2, actualizar: 1, sinCambios: 0, errores: 3 });
  it('al omitir errores lo dice con el número; sin omitir, no', () => {
    expect(lineasConfirmacion(s, true, false).join(' ')).toContain('se omiten 3 filas con error');
    expect(lineasConfirmacion(s, false, false).join(' ')).not.toContain('omiten');
  });
  it('distingue la carga inicial de la actualización', () => {
    expect(lineasConfirmacion(s, false, true).join(' ')).toContain('carga inicial');
    expect(lineasConfirmacion(s, false, false).join(' ')).toContain('no modifica el stock');
  });
  it('el resultado cuenta lo aplicado y las tandas', () => {
    const r: ResultadoImportacion = { completa: false, creados: 80, actualizados: 2, sinCambios: 0, omitidas: 3, lotes: { total: 5, aplicados: 2 }, productos: [], simulacion: s };
    expect(textoResultado(r)).toBe('80 productos creados, 2 actualizados, 0 sin cambios, 3 filas omitidas por error');
    expect(textoTandas(r)).toBe('2 de 5 tandas aplicadas');
  });
  it('la plantilla de carga inicial suma las columnas de existencias y la normal no', () => {
    expect(encabezadosPlantilla(false, REF, 'USD')).not.toContain('stockTienda');
    expect(encabezadosPlantilla(true, REF, 'USD')).toContain('stockDeposito2');
    expect(encabezadosPlantilla(false, REF, 'USD')).toContain('sku');
  });
  it('el comercio de referencia ve las mismas columnas, textos y orden de siempre', () => {
    expect(encabezadosPlantilla(false, REF, 'USD')).toEqual(['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioBO', 'precioAR', 'costo', 'activo', 'publicado']);
    const c = columnasArchivo(REF, 'USD');
    expect(c.find((x) => x.nombre === 'precioBO')?.texto).toBe('precio del mercado de Bolivia, en dólares con hasta 2 decimales (por ejemplo 1234.50).');
    expect(c.find((x) => x.nombre === 'precioAR')?.texto).toBe('precio del mercado de Argentina, en dólares con hasta 2 decimales.');
    expect(c.find((x) => x.nombre === 'costo')?.texto).toBe('costo en dólares con hasta 2 decimales (opcional).');
    expect(notaPrecios(REF)).toBe('Los precios van en dólares, con decimales.');
  });
  it('un comercio de un mercado y una moneda: una sola columna de precio, en su moneda', () => {
    expect(encabezadosPlantilla(false, UNO, 'PEN')).toEqual(['id', 'nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', 'precioPE', 'costo', 'activo', 'publicado']);
    const c = columnasArchivo(UNO, 'PEN');
    expect(c.find((x) => x.nombre === 'precioPE')?.texto).toBe('precio del mercado de Perú, en PEN con hasta 2 decimales (por ejemplo 1234.50).');
    expect(c.find((x) => x.nombre === 'costo')?.texto).toBe('costo en PEN con hasta 2 decimales (opcional).');
    expect(notaPrecios(UNO)).toBe('Los precios van en PEN, con decimales.');
  });
  it('sin moneda de costo conocida no se nombra ninguna', () => {
    expect(columnasArchivo(UNO).find((x) => x.nombre === 'costo')?.texto).toBe('costo con hasta 2 decimales (opcional).');
  });
});
