// `listarProductosParaRol` (coordinador): la regla de ocultamiento de Inventarios aplicada al catálogo de la consola.
import { abrirConteo } from '@novutienda/inventarios';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADM, T, entornoListo, op, type Entorno } from './entorno.js';

let e: Entorno;
const abrir = (ubicacionId: string): Promise<unknown> =>
  e.db.runTransaction((tx) => abrirConteo(tx, { tenantId: T, operacionId: op('ct'), por: ADM, conteoId: `conteo-${ubicacionId}`, ubicacionId }));
const lapiz = async (rol: 'adm' | 'sup' | 'caj' | undefined) => {
  const r = await e.catalogoConsola.listarProductosParaRol(T, rol);
  return { r, p: r.productos.find((x) => x.id === 'lapiz') };
};

beforeEach(async () => {
  e = await entornoListo();
});

describe('catálogo de la consola por rol con un conteo abierto', () => {
  it('sin conteo: todos ven todo y no hay marca', async () => {
    for (const rol of ['adm', 'sup', 'caj'] as const) {
      const { r, p } = await lapiz(rol);
      expect(p).toMatchObject({ stockTotal: 15, disponible: true });
      expect(r.existenciasOcultas).toBeUndefined();
      expect(r.conteosAbiertos).toBeUndefined();
    }
  });

  it('conteo en la tienda: sup y caj reciben null y la marca; adm ve todo', async () => {
    await abrir('tienda');
    for (const rol of ['sup', 'caj', undefined] as const) {
      const { r, p } = await lapiz(rol);
      expect(p).toMatchObject({ stockTotal: null, disponible: null });
      expect(r.productos).toHaveLength(2);
      expect(r.existenciasOcultas).toBe(true);
      expect(r.conteosAbiertos).toMatchObject([{ ubicacionId: 'tienda', conteoId: 'conteo-tienda' }]);
      expect(JSON.stringify(r)).not.toMatch(/"stockTotal":(15|3)\b/);
    }
    const { r, p } = await lapiz('adm');
    expect(p).toMatchObject({ stockTotal: 15, disponible: true });
    expect(r.existenciasOcultas).toBeUndefined();
  });

  it('conteo en otro almacén: la disponibilidad (tienda) se conserva pero stockTotal sale null', async () => {
    await abrir('deposito-1');
    const { r, p } = await lapiz('sup');
    expect(p).toMatchObject({ stockTotal: null, disponible: true });
    expect(r.existenciasOcultas).toBe(true);
  });

  it('listarProductos sin proyectar sigue entregando las cantidades (uso interno del servidor)', async () => {
    await abrir('tienda');
    expect((await e.catalogoConsola.listarProductos(T)).find((x) => x.id === 'lapiz')).toMatchObject({ stockTotal: 15, disponible: true });
  });
});
