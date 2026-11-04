import { SerieNoDisponible, StockInsuficiente, calcularFirma, confirmarPedidoFirmado } from '@plataforma/inventarios';
import { abrirTurno, confirmarVenta } from '@plataforma/pos';
import { manejarVentaConfirmada, type Recibo } from '@plataforma/recibos';
import { beforeEach, describe, expect, it } from 'vitest';
import { T, UUID, altaProducto, cargarStock, caj, contar, doc, entornoListo, producto, type Entorno } from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const TURNO = UUID(900);
let e: Entorno;

beforeEach(async () => {
  e = await entornoListo();
  await altaProducto(e, T, producto('ultimo', { nombre: 'Última unidad' }));
  await cargarStock(e, T, 'ultimo', 'tienda', 1);
  await abrirTurno(e.deps, T, caj, TURNO, { BOB: 0 });
});

const unidad = (n: number, productoId = 'ultimo', series?: string[]) =>
  confirmarVenta(
    e.deps, T, caj, UUID(n),
    { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId, cantidad: 1, ...(series !== undefined ? { series } : {}) }] },
    [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }],
  );

describe('concurrencia entre módulos sobre la misma base', () => {
  it('dos ventas de la última unidad: una sola gana, la otra falla por stock y nada queda a medias', async () => {
    const r = await Promise.allSettled([unidad(1), unidad(2)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const perdedora = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(perdedora.reason).toBeInstanceOf(StockInsuficiente);
    expect(e.db.reintentos).toBeGreaterThan(0);
    expect(doc(e, T, 'existencias/ultimo__tienda')?.['cantidad']).toBe(0);
    expect(contar(e, T, 'ventas')).toBe(1);
    // Un ingreso y una sola venta de la última unidad.
    expect(e.db.coleccion(`tenants/${T}/movimientos`).filter((m) => m.datos['productoId'] === 'ultimo')).toHaveLength(2);
    expect(doc(e, T, 'contadores/recibo_A')).toMatchObject({ ultimo: 1 });
    verificarInvariantes(e, T);
  });

  it('la misma serie vendida a la vez: una gana; la otra falla por serie no disponible', async () => {
    await altaProducto(e, T, producto('tv', { nombre: 'TV', conSerie: true }));
    await cargarStock(e, T, 'tv', 'tienda', 2, ['S1', 'S2']);
    const r = await Promise.allSettled([unidad(1, 'tv', ['S1']), unidad(2, 'tv', ['S1'])]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(SerieNoDisponible);
    expect(doc(e, T, 'existencias/tv__tienda')).toMatchObject({ cantidad: 1, series: ['S2'] });
    verificarInvariantes(e, T);
  });

  it('una venta y un pedido de WhatsApp por la última unidad: una sola gana', async () => {
    const cuerpo = JSON.stringify({ pedidoId: 'pd-9', items: [{ productoId: 'ultimo', cantidad: 1 }], confirmadoEn: '2026-11-04T14:59:00Z' });
    const marca = String(e.reloj.ahora);
    const pedido = confirmarPedidoFirmado(
      { db: e.db, secreto: 's', ahora: () => e.reloj.ahora },
      { tenantId: T, marcaTiempo: marca, firma: calcularFirma('s', marca, cuerpo), cuerpo },
    );
    const [v, p] = await Promise.allSettled([unidad(1), pedido]);
    const ganoVenta = v.status === 'fulfilled';
    const ganoPedido = p.status === 'fulfilled' && p.value.estado === 200;
    expect(Number(ganoVenta) + Number(ganoPedido)).toBe(1);
    expect(doc(e, T, 'existencias/ultimo__tienda')?.['cantidad']).toBe(0);
    expect(doc(e, T, 'productos/ultimo')?.['stockTotal']).toBe(0);
    verificarInvariantes(e, T);
  });

  it('varias ventas distintas a la vez numeran sin saltos ni duplicados (POS y Recibos)', async () => {
    const r = await Promise.allSettled([1, 2, 3, 4, 5].map((n) =>
      confirmarVenta(e.deps, T, caj, UUID(n), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
        { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
      ]),
    ));
    expect(r.every((x) => x.status === 'fulfilled')).toBe(true);
    const nrosPos = e.db.coleccion(`tenants/${T}/ventas`).map((v) => v.datos['receiptNo'] as number).sort();
    expect(nrosPos).toEqual([1, 2, 3, 4, 5]);
    // Recibos: los 5 eventos se manejan a la vez sobre la misma base.
    const eventos = await e.bandeja.publicados(T, 'venta.confirmada');
    await Promise.all(eventos.map((ev) => manejarVentaConfirmada(e.recibos, ev, { ahora: () => '2026-11-04T15:00:00Z' })));
    const nrosRecibos = e.db.coleccion(`tenants/${T}/recibos`).map((x) => (x.datos as unknown as Recibo).numero).sort();
    expect(nrosRecibos).toEqual(['A-000001', 'A-000002', 'A-000003', 'A-000004', 'A-000005']);
    expect(e.db.reintentos).toBeGreaterThan(0);
    expect(doc(e, T, 'productos/lapiz')?.['stockTotal']).toBe(10);
    verificarInvariantes(e, T);
  });
});
