import { calcularDisponibilidadPublica, cambiarPrecioUSD, crearProductoConsola, editarProductoConsola, obtenerTablero, preciosDelDia } from '@plataforma/consola';
import { LimiteDelPlan, verificarYReservar, type Actor } from '@plataforma/nucleo';
import { abrirTurno, confirmarVenta } from '@plataforma/pos';
import { beforeEach, describe, expect, it } from 'vitest';
import { REDONDEO, T, UUID, cargarStock, caj, cotizacionVigente, doc, entornoListo, type Entorno } from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const admin: Actor = { uid: 'u-adm', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: 'adm' }, v: 1 } } };
let e: Entorno;
let deps: Parameters<typeof crearProductoConsola>[0];

const datos = (extra: object = {}) => ({ nombre: 'Taladro 500 W', categoria: 'herramientas', activo: true, ...extra });

beforeEach(async () => {
  e = await entornoListo();
  deps = { db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora } };
});

describe('consola -> Inventarios -> POS: el precio y los datos del producto viajan completos', () => {
  it('un producto creado en la consola se vende en el POS al precio calculado con la cotización', async () => {
    await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'taladro', datos: datos({ garantiaMeses: 6 }), precioUSD: { bo: 12.5, ar: 13.25 } });
    // Inventarios lo guarda en centavos de USD, con el id como SKU (la consola no pide SKU).
    expect(doc(e, T, 'productos/taladro')).toMatchObject({ nombre: 'Taladro 500 W', sku: 'taladro', precioUSD: { bo: 1250, ar: 1325 }, stockTotal: 0, garantiaMeses: 6 });
    expect(doc(e, T, 'skus/taladro')).toBeDefined();
    // Se le carga stock por Inventarios y se vende en el POS.
    await cargarStock(e, T, 'taladro', 'tienda', 2);
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0, ARS: 0 });
    const bo = await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'taladro', cantidad: 1 }] }, [
      { medio: 'transferencia', moneda: 'BOB', monto: 8750 },
    ]);
    expect(bo.venta.lineas[0]).toMatchObject({ nombre: 'Taladro 500 W', precioUnitario: 8750, garantiaMeses: 6 }); // 12,50 USD x 7
    const ar = await confirmarVenta(e.deps, T, caj, UUID(2), { mercado: 'AR', moneda: 'ARS', lineas: [{ productoId: 'taladro', cantidad: 1 }] }, [
      { medio: 'transferencia', moneda: 'ARS', monto: 1325000 },
    ]);
    expect(ar.venta.lineas[0]?.precioUnitario).toBe(1325000); // 13,25 USD x 1 000
    // El editor de la consola calcula con la misma función y llega al mismo precio.
    const precios = preciosDelDia({ bo: 12.5, ar: 13.25 }, { BO: await cotizacionVigente(e, 'BO'), AR: await cotizacionVigente(e, 'AR') }, REDONDEO);
    expect(precios).toMatchObject({ BO: { tipo: 'precio', centavos: 8750 }, AR: { tipo: 'precio', centavos: 1325000 } });
    verificarInvariantes(e, T);
  });

  it('cambiar el precio en la consola cambia lo que cobra el POS (y un precio mostrado viejo se rechaza)', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await cambiarPrecioUSD(deps, { tenantId: T, actor: admin, productoId: 'lapiz', precioUSD: { bo: 20, ar: 20 } });
    expect(doc(e, T, 'productos/lapiz')).toMatchObject({ precioUSD: { bo: 2000, ar: 2000 } });
    await expect(
      confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1, precioMostrado: 7000 }] }, [
        { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
      ]),
    ).rejects.toMatchObject({ codigo: 'precio-alterado' });
    const ok = await confirmarVenta(e.deps, T, caj, UUID(2), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1, precioMostrado: 14000 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 14000 },
    ]);
    expect(ok.venta.total).toBe(14000);
  });

  it('un producto inactivado en la consola ya no se vende', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await editarProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'lapiz', cambios: { activo: false } });
    await expect(
      confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
        { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
      ]),
    ).rejects.toMatchObject({ codigo: 'producto-inactivo' });
  });

  it('lectura del catálogo: productos con precio decimal y existencias por almacén', async () => {
    const lista = await e.catalogoConsola.listarProductos(T);
    expect(lista.map((p) => p.id).sort()).toEqual(['celular', 'lapiz']);
    expect(lista.find((p) => p.id === 'lapiz')).toMatchObject({ precioUSD: { bo: 10, ar: 10 }, stockTotal: 15, activo: true });
    expect(await e.catalogoConsola.existenciasPorAlmacen(T, 'lapiz')).toEqual([
      { ubicacionId: 'tienda', cantidad: 10 },
      { ubicacionId: 'deposito-1', cantidad: 5 },
    ]);
    expect(await e.catalogoConsola.leerProducto(T, 'no-existe')).toBeUndefined();
  });

  it('repetir el alta con el mismo contenido no gasta otro cupo; con otro contenido es conflicto', async () => {
    const alta = (nombre: string) =>
      e.db.runTransaction((tx) => e.catalogoConsola.crearProducto(tx, T, 'sierra', { nombre, categoria: 'herramientas', activo: true }, { bo: 5, ar: 5 }, 'u-adm'));
    await alta('Sierra');
    const usado = (doc(e, T, 'contadores/uso') as { productos: number }).productos;
    await alta('Sierra');
    expect((doc(e, T, 'contadores/uso') as { productos: number }).productos).toBe(usado);
    await expect(alta('Sierra circular')).rejects.toMatchObject({ codigo: 'already-exists' });
  });

  it('la marca se guarda, se edita y llega al catálogo; el SKU no se edita', async () => {
    await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'con-marca', datos: datos({ marca: 'Bosch', minimo: 2, conSerie: true, publicado: true }), precioUSD: { bo: 1, ar: 1 } });
    expect(doc(e, T, 'productos/con-marca')).toMatchObject({ marca: 'Bosch', minimo: 2, conSerie: true, publicado: true, sku: 'con-marca' });
    await editarProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'con-marca', cambios: { marca: 'Makita' } });
    expect(await e.catalogoConsola.leerProducto(T, 'con-marca')).toMatchObject({ marca: 'Makita', conSerie: true, minimo: 2, publicado: true });
    await expect(editarProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'lapiz', cambios: { sku: 'OTRO' } })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
    // El adaptador también lo rechaza si se lo llama sin pasar por la consola.
    await expect(e.db.runTransaction((tx) => e.catalogoConsola.actualizarDatosProducto(tx, T, 'lapiz', { sku: 'OTRO' }, 'u-adm'))).rejects.toMatchObject({ codigo: 'invalid-argument' });
  });
});

describe('disponibilidad pública: una sola regla (I-07 corregida)', () => {
  it('la consola y existenciasPublicas dan lo mismo: activo y existencia en tienda > 0', async () => {
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 10 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 70000 },
    ]);
    // tienda = 0, deposito-1 = 5: ambos dicen agotado.
    expect(await calcularDisponibilidadPublica(e.catalogoConsola, T)).toMatchObject({ lapiz: { disponible: false }, celular: { disponible: true } });
    expect(doc(e, T, 'existenciasPublicas/lapiz')).toMatchObject({ disponible: false });
    expect(doc(e, T, 'existenciasPublicas/celular')).toMatchObject({ disponible: true });
    // Inactivar el producto desde la consola actualiza ambos.
    await editarProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'celular', cambios: { activo: false } });
    expect(await calcularDisponibilidadPublica(e.catalogoConsola, T)).toMatchObject({ celular: { disponible: false } });
    expect(doc(e, T, 'existenciasPublicas/celular')).toMatchObject({ disponible: false });
    verificarInvariantes(e, T);
  });
});

describe('límite de 200 productos en la misma transacción del alta', () => {
  it('el producto 201 se rechaza, el contador es el mismo que usa verificarYReservar y el tablero lo muestra', async () => {
    // Ya hay 2 productos (lapiz y celular): 198 más llegan al tope.
    for (let i = 0; i < 198; i++) {
      await crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: `prod-${String(i).padStart(3, '0')}`, datos: datos({ nombre: `Producto ${String(i)}` }), precioUSD: { bo: 1, ar: 1 } });
    }
    expect(doc(e, T, 'contadores/uso')).toMatchObject({ productos: 200 });
    await expect(
      crearProductoConsola(deps, { tenantId: T, actor: admin, productoId: 'prod-201', datos: datos(), precioUSD: { bo: 1, ar: 1 } }),
    ).rejects.toBeInstanceOf(LimiteDelPlan);
    // No quedó nada a medias: ni producto, ni SKU, ni cupo gastado.
    expect(doc(e, T, 'productos/prod-201')).toBeUndefined();
    expect(doc(e, T, 'skus/prod-201')).toBeUndefined();
    expect(doc(e, T, 'contadores/uso')).toMatchObject({ productos: 200 });
    // Mismo contador que el del núcleo.
    await expect(e.db.runTransaction((tx) => verificarYReservar(tx, T, 'productos'))).rejects.toBeInstanceOf(LimiteDelPlan);
    const tablero = await obtenerTablero({ db: e.db, cotizaciones: e.almacen, reloj: { ahora: () => e.reloj.ahora } }, { tenantId: T, actor: admin });
    expect(tablero.uso.productos).toEqual({ usados: 200, tope: 200 });
    expect(tablero.cotizaciones.map((c) => c.estado)).toEqual(['vigente', 'vigente']);
  }, 60_000);
});
