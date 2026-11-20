// Formato de la serie al dar de alta (humo2: D1, D2, D3) y campo auxiliar `serieBusqueda`. Doble en memoria, sin emulador.
import { beforeEach, describe, expect, it } from 'vitest';
import { EntradaInvalida, esSerie, esSerieNueva, exigirSeriesNuevas, normalizarSerieBusqueda, traspasar } from './api.js';
import type { DobleDb } from './doble-db.js';
import { altaProducto, cargar, doc, nuevoEntorno, op, producto, SUP, T, verificarInvariantes } from './entorno.js';

let db: DobleDb;
beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('celular', { conSerie: true }));
});

describe('formato de la serie nueva', () => {
  it('de 3 a 60 caracteres: letras, números y - . _ (sin «/» ni espacios)', () => {
    for (const ok of ['ABC', 'a1-b.c_d', 'x'.repeat(60)]) expect(esSerieNueva(ok), ok).toBe(true);
    for (const mal of ['AB', 'A', '', 'x'.repeat(61), 'AB/CD', 'AB CD', '-ABC', 'A__BC', 'ñandú']) expect(esSerieNueva(mal), mal).toBe(false);
  });

  it('el ingreso rechaza 2 y 61 caracteres y acepta 3 y 60', async () => {
    await expect(cargar(db, 'celular', 'tienda', 1, ['AB'])).rejects.toThrow(/de 3 a 60 caracteres/);
    await expect(cargar(db, 'celular', 'tienda', 1, ['x'.repeat(61)])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'celular', 'tienda', 1, ['AB/123'])).rejects.toBeInstanceOf(EntradaInvalida);
    await cargar(db, 'celular', 'tienda', 2, ['ABC', 'y'.repeat(60)]);
    expect(doc(db, 'unidades', 'celular__ABC')).toMatchObject({ estado: 'disponible' });
    verificarInvariantes(db);
  });

  it('en la misma operación se rechazan las repetidas, también si solo cambian las mayúsculas', async () => {
    await expect(cargar(db, 'celular', 'tienda', 2, ['ABC123', 'ABC123'])).rejects.toBeInstanceOf(EntradaInvalida);
    await expect(cargar(db, 'celular', 'tienda', 2, ['ABC123', 'abc123'])).rejects.toThrow(/mayúsculas/);
    expect(doc(db, 'unidades', 'celular__ABC123')).toBeUndefined();
  });

  it('frente a lo guardado solo rige el duplicado exacto (las mayúsculas distintas se admiten)', async () => {
    await cargar(db, 'celular', 'tienda', 1, ['ABC123']);
    await expect(cargar(db, 'celular', 'deposito-1', 1, ['ABC123'])).rejects.toThrow(/ya está registrada/);
    await cargar(db, 'celular', 'deposito-1', 1, ['abc123']);
    expect(doc(db, 'unidades', 'celular__abc123')).toMatchObject({ serie: 'abc123' });
  });

  it('exigirSeriesNuevas rechaza lo que no es lista', () => {
    expect(() => exigirSeriesNuevas('ABC')).toThrow(EntradaInvalida);
  });
});

describe('las series ya guardadas siguen valiendo (D2)', () => {
  it('una serie vieja de 1 carácter se sigue pudiendo traspasar', async () => {
    await cargar(db, 'celular', 'tienda', 1, ['TEMPORAL']);
    // Se reescribe como dato anterior: serie de un carácter, sin `serieBusqueda`.
    const u = doc(db, 'unidades', 'celular__TEMPORAL') as Record<string, unknown>;
    db.poner(`tenants/${T}/unidades/celular__TEMPORAL`, undefined);
    const { serieBusqueda: _aux, ...vieja } = u;
    void _aux;
    db.poner(`tenants/${T}/unidades/celular__A`, { ...vieja, serie: 'A' });
    db.poner(`tenants/${T}/existencias/celular__tienda`, { ...(doc(db, 'existencias', 'celular__tienda') as Record<string, unknown>), series: ['A'] });
    expect(esSerie('A')).toBe(true);
    await db.runTransaction((tx) =>
      traspasar(tx, { tenantId: T, operacionId: op('tr'), por: SUP, origenId: 'tienda', destinoId: 'deposito-1', lineas: [{ productoId: 'celular', cantidad: 1, series: ['A'] }] }),
    );
    expect(doc(db, 'unidades', 'celular__A')).toMatchObject({ ubicacionId: 'deposito-1', serie: 'A', serieBusqueda: 'a' });
  });
});

describe('serieBusqueda', () => {
  it('toda unidad nueva la lleva, en minúsculas, y se mantiene al cambiar de lugar', async () => {
    await cargar(db, 'celular', 'tienda', 1, ['AbC-123']);
    expect(normalizarSerieBusqueda('AbC-123')).toBe('abc-123');
    expect(doc(db, 'unidades', 'celular__AbC-123')).toMatchObject({ serie: 'AbC-123', serieBusqueda: 'abc-123' });
    await db.runTransaction((tx) =>
      traspasar(tx, { tenantId: T, operacionId: op('tr'), por: SUP, origenId: 'tienda', destinoId: 'deposito-1', lineas: [{ productoId: 'celular', cantidad: 1, series: ['AbC-123'] }] }),
    );
    expect(doc(db, 'unidades', 'celular__AbC-123')).toMatchObject({ ubicacionId: 'deposito-1', serieBusqueda: 'abc-123' });
  });
});
