import { describe, expect, it } from 'vitest';
import type { Rol } from '@novutienda/nucleo';
import { exportarProductosCsv, proyectarDisponibilidad } from '@novutienda/consola';
import { accionesConsola } from '../../plataforma/funciones/servidor/llamadas/consola.js';
import { CatalogoDoble } from './dobles.js';

const CONTEO = { ubicacionId: 'tienda', conteoId: 'c1', abiertoEn: '2026-11-12T10:00:00.000Z' };

function catalogo(conteo: boolean): CatalogoDoble {
  const c = new CatalogoDoble();
  c.agregar('a', { stockTotal: 5, disponible: true });
  c.agregar('b'); // no controla stock: sin stockTotal
  if (conteo) c.conteosAbiertos = [CONTEO];
  return c;
}
const llamar = (c: CatalogoDoble, rol: Rol | undefined): Promise<Record<string, unknown>> =>
  accionesConsola['catalogo']!.ejecutar({ e: { catalogo: c }, tenantId: 't1', rol } as never, {}) as Promise<Record<string, unknown>>;

describe('consola.catalogo y el conteo abierto', () => {
  it.each(['caj', 'sup', 'adm'] as const)('sin conteo, %s ve existencias y disponibilidad', async (rol) => {
    const r = await llamar(catalogo(false), rol);
    expect(r['productos']).toEqual([expect.objectContaining({ id: 'a', stockTotal: 5, disponible: true }), expect.objectContaining({ id: 'b', disponible: true })]);
    expect(r).not.toHaveProperty('existenciasOcultas');
  });

  it.each(['caj', 'sup'] as const)('con conteo, %s recibe null y la marca, sin omitir los campos', async (rol) => {
    const r = await llamar(catalogo(true), rol);
    expect(r['existenciasOcultas']).toBe(true);
    expect(r['conteosAbiertos']).toEqual([CONTEO]);
    const [a, b] = r['productos'] as Record<string, unknown>[];
    expect(a).toHaveProperty('stockTotal', null);
    expect(a).toHaveProperty('disponible', null);
    expect(b).not.toHaveProperty('stockTotal'); // sin control de stock: ausente
  });

  it('con conteo, adm sigue viendo todo', async () => {
    const r = await llamar(catalogo(true), 'adm');
    expect(r['productos']).toEqual([expect.objectContaining({ id: 'a', stockTotal: 5, disponible: true }), expect.objectContaining({ id: 'b' })]);
    expect(r).not.toHaveProperty('existenciasOcultas');
  });

  it('lo que se publica no cambia con el conteo: usa la lista interna sin proyectar', async () => {
    const c = catalogo(true);
    expect(proyectarDisponibilidad(await c.listarProductos())).toEqual({ a: { disponible: true }, b: { disponible: true } });
  });

  it('la exportación CSV no trae existencias ni disponibilidad', async () => {
    const csv = exportarProductosCsv(await catalogo(true).listarProductos());
    expect(csv).not.toMatch(/stock|existenc|disponible|agotado/i);
  });
});
