import { describe, expect, it } from 'vitest';
import type { FilaSimulada, ResultadoImportacion, Simulacion } from '../../api/tipos.js';
import { aplicables, encabezadosPlantilla, lineasConfirmacion, MAX_BYTES_ARCHIVO, ordenarFilas, resumenSimulacion, textoError, textoResultado, textoTandas, validarArchivo } from './importar-logica.js';

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
    expect(encabezadosPlantilla(false)).not.toContain('stockTienda');
    expect(encabezadosPlantilla(true)).toContain('stockDeposito2');
    expect(encabezadosPlantilla(false)).toContain('sku');
  });
});
