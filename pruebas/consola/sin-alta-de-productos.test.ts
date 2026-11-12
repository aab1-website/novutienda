import { describe, expect, it } from 'vitest';
import * as consola from '@novutienda/consola';
import { exportarProductosCsv, manifiestoConsola, PANTALLAS } from '@novutienda/consola';

/**
 * Regla de negocio: no pueden existir ítems en el catálogo que no existan en Inventario. La consola no da de alta,
 * edita ni cambia el precio de productos: eso es de Inventarios.
 */
describe('la consola no crea productos', () => {
  it('el paquete no exporta ninguna función de alta, edición, precio ni importación de productos', () => {
    const prohibidas = /^(crear|editar|actualizar|importar|simular|cambiarPrecio|validarDatosProducto|validarPrecioUSD)/i;
    const sospechosas = Object.keys(consola).filter((n) => prohibidas.test(n) && /producto|precio|importa/i.test(n));
    expect(sospechosas).toEqual([]);
  });

  it('el manifiesto no declara acciones de alta, edición, precio ni importación de productos', () => {
    const nombres = manifiestoConsola.acciones?.map((a) => a.nombre) ?? [];
    expect(nombres.length).toBeGreaterThan(0);
    expect(nombres.filter((n) => /^(crearProducto|editarProducto|cambiarPrecioUSD|simularImportacion|importarProductos)$/.test(n))).toEqual([]);
  });

  it('las pantallas no listan llamadas que escriban productos', () => {
    const llamadas = PANTALLAS.flatMap((p) => p.llamadas);
    expect(llamadas.filter((l) => /^(crearProducto|editarProducto|cambiarPrecio|importarProductos|simularImportacion)/.test(l))).toEqual([]);
  });

  it('conserva la exportación del catálogo: neutraliza fórmulas y no incluye stock', () => {
    const csv = exportarProductosCsv([{ id: 'cam-1', nombre: '=EVIL()', categoria: 'video', activo: true, disponible: true, precioUSD: { bo: 1.5, ar: 2 }, stockTotal: 99 }]);
    expect(csv.startsWith('﻿id,nombre')).toBe(true);
    expect(csv).toContain("'=EVIL()");
    expect(csv).not.toContain('99');
  });
});
