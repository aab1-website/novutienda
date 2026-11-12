import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumirProductoCambiado, crearProductoConsola, ejecutorConsola, editarProductoConsola,
} from '@novutienda/consola';
import { ErrorEvento, type SobreEvento } from '@novutienda/nucleo';
import { actor, CatalogoDoble, nuevaDb, RelojFijo, T } from './dobles.js';

const ESTADO = `tenants/${T}/sitio/estado`;
const evento = (id: string, datos: unknown = { productoId: 'p1', cambio: 'creado' }): SobreEvento => ({
  id, tipo: 'producto.cambiado', version: 1, tenantId: T, origen: 'inventarios',
  ocurridoEn: '2026-11-12T10:00:00.000Z', claveIdempotencia: `k-${id}`, datos,
});

describe('consumirProductoCambiado', () => {
  let db: ReturnType<typeof nuevaDb>;
  beforeEach(() => {
    db = nuevaDb();
  });

  it('el evento incrementa el contador una vez', async () => {
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'))).toBe(true);
    expect(db.dato(ESTADO)).toEqual({ cambios: 1, ultimoCambioEn: '2026-11-12T10:00:00.000Z' });
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e2', { productoId: 'p1', cambio: 'precio' }))).toBe(true);
    expect(db.dato(ESTADO)?.['cambios']).toBe(2);
  });

  it('la reentrega del mismo evento no vuelve a contar', async () => {
    await consumirProductoCambiado(ejecutorConsola(db), evento('e1'));
    expect(await consumirProductoCambiado(ejecutorConsola(db), evento('e1'))).toBe(false);
    expect(await consumirProductoCambiado(ejecutorConsola(db), { ...evento('e1b'), claveIdempotencia: 'k-e1' })).toBe(false);
    expect(db.dato(ESTADO)?.['cambios']).toBe(1);
  });

  it('un evento inválido se rechaza y no cuenta', async () => {
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e3', { productoId: 'p1', cambio: 'borrado' }))).rejects.toBeInstanceOf(ErrorEvento);
    await expect(consumirProductoCambiado(ejecutorConsola(db), evento('e4', {}))).rejects.toBeInstanceOf(ErrorEvento);
    expect(db.dato(ESTADO)).toBeUndefined();
  });

  it('las operaciones de producto por consola no anotan el cambio: lo cuenta solo el evento de Inventarios', async () => {
    const deps = { db, catalogo: new CatalogoDoble(), reloj: new RelojFijo() };
    const adm = actor('adm');
    await crearProductoConsola(deps, {
      tenantId: T, actor: adm, productoId: 'p1', datos: { nombre: 'A', categoria: 'C', sku: 'S1' }, precioUSD: { bo: 1, ar: 1 },
    });
    await editarProductoConsola(deps, { tenantId: T, actor: adm, productoId: 'p1', cambios: { nombre: 'B' } });
    expect(db.dato(ESTADO)).toBeUndefined();
    // El evento que publica la biblioteca de Inventarios en esas mismas transacciones es la única vía: suma una vez por evento.
    await consumirProductoCambiado(ejecutorConsola(db), evento('pc-consola-crear-p1', { productoId: 'p1', cambio: 'creado' }));
    await consumirProductoCambiado(ejecutorConsola(db), evento('e5', { productoId: 'p1', cambio: 'editado' }));
    expect(db.dato(ESTADO)?.['cambios']).toBe(2);
  });
});
