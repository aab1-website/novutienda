import { expect } from 'vitest';
import type { Entorno } from './entorno.js';

/**
 * Invariantes de Inventarios (spec): suma de existencias = stockTotal; con serie, la cantidad de cada
 * almacén = unidades disponibles ahí (y la lista de series coincide); ningún saldo negativo.
 */
export function verificarInvariantes(e: Entorno, tenantId: string): void {
  const productos = e.db.coleccion(`tenants/${tenantId}/productos`);
  const existencias = e.db.coleccion(`tenants/${tenantId}/existencias`);
  const unidades = e.db.coleccion(`tenants/${tenantId}/unidades`);
  for (const { id, datos } of productos) {
    if (typeof datos['stockTotal'] !== 'number') continue;
    let suma = 0;
    for (const x of existencias.filter((y) => y.datos['productoId'] === id)) {
      const cantidad = x.datos['cantidad'] as number;
      expect(Number.isInteger(cantidad) && cantidad >= 0, `saldo inválido en ${x.ruta}`).toBe(true);
      suma += cantidad;
      if (datos['conSerie'] === true) {
        const series = x.datos['series'] as string[];
        expect(series.length, `series vs cantidad en ${x.ruta}`).toBe(cantidad);
        const disponibles = unidades
          .filter((u) => u.datos['productoId'] === id && u.datos['ubicacionId'] === x.datos['ubicacionId'] && u.datos['estado'] === 'disponible')
          .map((u) => u.datos['serie'] as string)
          .sort();
        expect(disponibles, `unidades disponibles vs series en ${x.ruta}`).toEqual([...series].sort());
      }
    }
    expect(suma, `suma de existencias vs stockTotal de ${id}`).toBe(datos['stockTotal']);
  }
}
