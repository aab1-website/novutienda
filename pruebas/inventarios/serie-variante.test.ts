// Paso 25 (tercera ronda): la regla «una serie que solo cambia en mayúsculas se rechaza» la aplica el borde del servidor
// consultando `serieBusqueda` (prueba en pruebas/funciones/inventarios-serie-variante.test.ts). Aquí se fija lo que el módulo
// garantiza: las variantes comparten la clave de búsqueda y el duplicado exacto sigue rechazado por el módulo.
import { describe, expect, it } from 'vitest';
import { normalizarSerieBusqueda } from './api.js';

describe('serieBusqueda para detectar variantes de mayúsculas', () => {
  it('dos variantes de una misma serie comparten la clave de búsqueda', () => {
    expect(normalizarSerieBusqueda('HUMO2-S001')).toBe(normalizarSerieBusqueda('humo2-s001'));
    expect(normalizarSerieBusqueda('Abc-1')).not.toBe(normalizarSerieBusqueda('Abc-2'));
  });
});
