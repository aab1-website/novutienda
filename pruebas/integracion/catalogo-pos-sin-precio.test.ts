// El adaptador real del puerto de catálogo de la caja (`catalogoParaPos`) contra la base de las pruebas de integración: un producto
// sin la clave de precio de un mercado declarado se vende en el otro y se rechaza en ese con `sin-precio`; un precio presente pero
// inválido sigue siendo dato corrupto en ambos.
import { abrirTurno, confirmarVenta, type Carrito } from '@novutienda/pos';
import { beforeEach, describe, expect, it } from 'vitest';
import { T, UUID, altaProducto, cargarStock, caj, contar, doc, entornoListo, producto, type Entorno } from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const TURNO = UUID(900);
let e: Entorno;

/** Crea `id` con los dos precios y le quita o le corrompe la clave de `ar` directamente en la base (como un producto anterior al mercado). */
async function productoConPrecioAjustado(id: string, ajuste: 'sin-clave' | 'null' | 'negativo' | 'completo'): Promise<void> {
  await altaProducto(e, T, producto(id, { precioUSD: { bo: 1000, ar: 1000 } }));
  await cargarStock(e, T, id, 'tienda', 5);
  const ruta = `tenants/${T}/productos/${id}`;
  const d = e.db.dato(ruta) as Record<string, unknown>;
  const precios = { ...(d['precioUSD'] as Record<string, unknown>) };
  if (ajuste === 'sin-clave') delete precios['ar'];
  if (ajuste === 'null') precios['ar'] = null;
  if (ajuste === 'negativo') precios['ar'] = -1;
  e.db.poner(ruta, { ...d, precioUSD: precios });
}

const carritoDe = (mercado: 'BO' | 'AR', productoId: string): Carrito => ({
  mercado, moneda: mercado === 'BO' ? 'BOB' : 'ARS', lineas: [{ productoId, cantidad: 1 }], totalMostrado: 0,
});

/** Vende y devuelve el total registrado; el total esperado sale del mismo producto completo. */
async function vender(mercado: 'BO' | 'AR', productoId: string, ventaId: string) {
  const moneda = mercado === 'BO' ? 'BOB' : 'ARS';
  const total = mercado === 'BO' ? 7000 : 1_000_000; // 10 USD x cotización (7 BOB; 1 000 ARS), en centavos
  return confirmarVenta(e.deps, T, caj, ventaId, { ...carritoDe(mercado, productoId), totalMostrado: total }, [{ medio: 'efectivo', moneda, monto: total }]);
}

beforeEach(async () => {
  e = await entornoListo();
  await abrirTurno(e.deps, T, caj, TURNO, { BOB: 10000, ARS: 10000 });
});

describe('producto sin la clave de precio de un mercado declarado', () => {
  it('se vende en el mercado con precio, con el mismo total que un producto completo', async () => {
    await productoConPrecioAjustado('completo', 'completo');
    await productoConPrecioAjustado('sin-ar', 'sin-clave');
    await vender('BO', 'completo', UUID(1));
    await vender('BO', 'sin-ar', UUID(2));
    expect(doc(e, T, `ventas/${UUID(2)}`)?.['total']).toBe(doc(e, T, `ventas/${UUID(1)}`)?.['total']);
    expect(doc(e, T, 'productos/sin-ar')?.['stockTotal']).toBe(4);
    verificarInvariantes(e, T);
  });

  it('se rechaza en el otro mercado con «sin-precio», sin descontar stock ni escribir la venta', async () => {
    await productoConPrecioAjustado('sin-ar', 'sin-clave');
    const ventas = contar(e, T, 'ventas');
    const movimientos = contar(e, T, 'movimientos');
    await expect(vender('AR', 'sin-ar', UUID(3))).rejects.toMatchObject({ codigo: 'sin-precio' });
    expect(contar(e, T, 'ventas')).toBe(ventas);
    expect(contar(e, T, 'movimientos')).toBe(movimientos);
    expect(doc(e, T, 'productos/sin-ar')?.['stockTotal']).toBe(5);
    expect(doc(e, T, 'existencias/sin-ar__tienda')?.['cantidad']).toBe(5);
    expect(doc(e, T, `ventas/${UUID(3)}`)).toBeUndefined();
    verificarInvariantes(e, T);
  });
});

describe('precio presente pero inválido', () => {
  it.each(['null', 'negativo'] as const)('«%s» falla como dato corrupto en ambos mercados, sin tocar stock', async (ajuste) => {
    await productoConPrecioAjustado('roto', ajuste);
    for (const [i, mercado] of (['BO', 'AR'] as const).entries()) {
      await expect(vender(mercado, 'roto', UUID(10 + i))).rejects.toMatchObject({ name: 'ProductoCorrupto' });
    }
    expect(contar(e, T, 'ventas')).toBe(0);
    expect(doc(e, T, 'productos/roto')?.['stockTotal']).toBe(5);
  });
});
