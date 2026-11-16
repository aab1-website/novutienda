import { describe, expect, it } from 'vitest';
import { identificadorParaAlta } from './identificador.js';

/** Vectores compartidos con el servidor (`pruebas/inventarios/identificador-automatico.test.ts`): deben coincidir letra por letra. */
const VECTORES: readonly { nombre: string; sku: string; ocupados: string[]; id: string }[] = [
  { nombre: 'Cable HDMI 2 m', sku: 'C-1', ocupados: [], id: 'cable-hdmi-2-m' },
  { nombre: '  Audífonos  inalámbricos! ', sku: 'A-1', ocupados: [], id: 'audifonos-inalambricos' },
  { nombre: 'Cable HDMI', sku: 'C-2', ocupados: ['cable-hdmi'], id: 'cable-hdmi-2' },
  { nombre: 'Cable HDMI', sku: 'C-2', ocupados: ['cable-hdmi', 'cable-hdmi-2'], id: 'cable-hdmi-3' },
  { nombre: '!!', sku: 'AB-12', ocupados: [], id: 'ab-12' },
  { nombre: 'a', sku: 'Z9', ocupados: [], id: 'z9' },
  { nombre: '!!', sku: '#', ocupados: [], id: 'producto' },
  { nombre: '!!', sku: '#', ocupados: ['producto'], id: 'producto-2' },
  { nombre: 'a'.repeat(100), sku: 'X-1', ocupados: [], id: 'a'.repeat(56) },
  { nombre: 'Ñandú', sku: 'N-1', ocupados: [], id: 'nandu' },
];

describe('identificadorParaAlta (copia del servidor)', () => {
  it.each(VECTORES)('vector %#', (v) => {
    const id = identificadorParaAlta(v.nombre, v.sku, new Set(v.ocupados));
    expect(id).toBe(v.id);
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{1,59}$/);
  });
});
