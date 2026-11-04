import { validarEvento, type DatosVentaConfirmadaV1 } from '@novutienda/nucleo';
import {
  abrirTurno, aprobarAnulacion, cerrarTurno, confirmarVenta, registrarMovimientoCaja, resolverAprobacion, solicitarAnulacion,
  solicitarAprobacion, type Carrito,
} from '@novutienda/pos';
import type { Recibo } from '@novutienda/recibos';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  T, UUID, caj, contar, cotizacionVigente, doc, entornoListo, eventosDe, sup, type Entorno,
} from './entorno.js';
import { verificarInvariantes } from './invariantes.js';

const TURNO = UUID(900);
const VENTA = UUID(1);
const APROBACION = UUID(50);

// celular x2 (series A, B) a 700,00 Bs + lápiz x1 a 70,00 Bs; subtotal 1 470,00 Bs.
const carrito: Carrito = {
  mercado: 'BO',
  moneda: 'BOB',
  lineas: [
    { productoId: 'celular', cantidad: 2, series: ['A', 'B'] },
    { productoId: 'lapiz', cantidad: 1 },
  ],
  descuento: { monto: 10000, motivo: 'cliente frecuente' },
  cliente: { nombre: 'Ana Pérez', telefono: '70000000' },
  totalMostrado: 137000,
};
// Pago mixto en bolivianos: efectivo 1 100,00 con 100,00 de cambio + QR 370,00 = 1 370,00.
const pagos = [
  { medio: 'efectivo', moneda: 'BOB', monto: 110000, cambio: 10000 },
  { medio: 'qr', moneda: 'BOB', monto: 37000, referencia: 'QR-0001' },
];

let e: Entorno;
const recibo = (ventaId: string): Recibo => doc(e, T, `recibos/recibo-${ventaId}`) as unknown as Recibo;

async function venderConDescuentoAprobado(): Promise<void> {
  await abrirTurno(e.deps, T, caj, TURNO, { BOB: 10000 });
  await solicitarAprobacion(e.deps, T, caj, APROBACION, { tipo: 'descuento', moneda: 'BOB', monto: 10000, motivo: 'cliente frecuente' });
  await resolverAprobacion(e.deps, T, sup, APROBACION, 'aprobar');
  await confirmarVenta(e.deps, T, caj, VENTA, carrito, pagos, APROBACION);
}

beforeEach(async () => {
  e = await entornoListo();
});

describe('venta con serie, pago mixto y descuento aprobado', () => {
  it('descuenta stock y unidades, y publica un venta.confirmada con el nombre del producto', async () => {
    await venderConDescuentoAprobado();
    const venta = doc(e, T, `ventas/${VENTA}`) as { total: number; subtotal: number; receiptNo: number; descuento: { aprobadoPor: string } };
    expect(venta).toMatchObject({ subtotal: 147000, total: 137000, receiptNo: 1, descuento: { aprobadoPor: 'u-sup' } });
    // Stock: lápiz 10 -> 9 en tienda (depósito intacto); celular 3 -> 1.
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(9);
    expect(doc(e, T, 'existencias/lapiz__deposito-1')?.['cantidad']).toBe(5);
    expect(doc(e, T, 'productos/lapiz')?.['stockTotal']).toBe(14);
    expect(doc(e, T, 'existencias/celular__tienda')).toMatchObject({ cantidad: 1, series: ['C'] });
    expect(doc(e, T, 'productos/celular')?.['stockTotal']).toBe(1);
    // Unidades vendidas con garantía y referencia a la venta.
    for (const s of ['A', 'B']) {
      expect(doc(e, T, `unidades/celular__${s}`)).toMatchObject({ estado: 'vendida', ventaRef: { tipo: 'venta', id: VENTA }, garantiaHasta: '2027-11-04' });
    }
    expect(doc(e, T, 'unidades/celular__C')?.['estado']).toBe('disponible');
    // Movimientos y operación de Inventarios con la misma referencia.
    expect(doc(e, T, `operaciones/venta-${VENTA}`)).toMatchObject({ tipo: 'salida' });
    expect(doc(e, T, `movimientos/venta-${VENTA}__celular__tienda`)).toMatchObject({ tipo: 'venta', delta: -2, series: ['A', 'B'] });
    // Evento.
    const ev = eventosDe(e, T, 'venta.confirmada');
    expect(ev).toHaveLength(1);
    expect(validarEvento(ev[0]).ok).toBe(true);
    const datos = ev[0]?.['datos'] as DatosVentaConfirmadaV1;
    expect(datos.lineas.map((l) => l.nombre)).toEqual(['Celular X1', 'Lápiz HB']);
    expect(datos.pagos.map((p) => p.medio)).toEqual(['efectivo', 'qr']);
    verificarInvariantes(e, T);
  });

  it('la cotización de la venta es la copia que produce leerCotizacion sobre el almacén de cotizaciones', async () => {
    await venderConDescuentoAprobado();
    const copia = await cotizacionVigente(e, 'BO');
    const venta = doc(e, T, `ventas/${VENTA}`) as { cotizacion: unknown };
    expect(venta.cotizacion).toEqual(copia);
    expect(copia).toMatchObject({ par: 'BOB/USD', valor: 7, fuente: 'manual', estado: 'vigente' });
    // La copia viaja igual en el evento y en el recibo.
    const datos = eventosDe(e, T, 'venta.confirmada')[0]?.['datos'] as DatosVentaConfirmadaV1;
    expect(datos.cotizacion).toEqual(copia);
    await e.bandeja.entregar(T);
    expect(recibo(VENTA).cotizacion).toEqual(copia);
  });

  it('el evento llega a Recibos: recibo con número correlativo y recibo.emitido válido', async () => {
    await venderConDescuentoAprobado();
    const r = await e.bandeja.entregar(T);
    expect(r.fallidas).toEqual([]);
    const rec = recibo(VENTA);
    expect(rec).toMatchObject({
      numero: 'A-000001', estado: 'EMITIDO', moneda: 'BOB', total: 137000, fecha: '2026-11-04',
      descuento: { monto: 10000, motivo: 'cliente frecuente' }, cliente: { nombre: 'Ana Pérez' },
    });
    expect(rec.lineas.map((l) => [l.nombre, l.cantidad, l.series])).toEqual([['Celular X1', 2, ['A', 'B']], ['Lápiz HB', 1, []]]);
    // La garantía del recibo coincide con la de las unidades en Inventarios.
    expect(rec.lineas[0]?.garantiaHasta).toBe(doc(e, T, 'unidades/celular__A')?.['garantiaHasta']);
    // Sin referencias de pago en el comprobante.
    expect(JSON.stringify(rec)).not.toContain('QR-0001');
    const emitidos = eventosDe(e, T, 'recibo.emitido');
    expect(emitidos).toHaveLength(1);
    expect(validarEvento(emitidos[0]).ok).toBe(true);
    expect(emitidos[0]?.['datos']).toMatchObject({
      reciboId: `recibo-${VENTA}`, ventaId: VENTA, numero: 'A-000001',
      garantias: [{ serie: 'A', hasta: '2027-11-04' }, { serie: 'B', hasta: '2027-11-04' }],
    });
    // Numeración: el número del POS (receiptNo) y el de Recibos coinciden mientras la entrega es ordenada.
    expect((doc(e, T, `ventas/${VENTA}`) as { receiptNo: number }).receiptNo).toBe(1);
    expect(rec.numero).toBe('A-000001');
  });

  it('reintentar la misma venta no duplica stock, eventos, operaciones ni recibos', async () => {
    await venderConDescuentoAprobado();
    await e.bandeja.entregar(T);
    const antes = {
      movimientos: contar(e, T, 'movimientos'), operaciones: contar(e, T, 'operaciones'), eventos: contar(e, T, 'eventos'),
      recibos: contar(e, T, 'recibos'), stock: doc(e, T, 'productos/lapiz')?.['stockTotal'],
    };
    const otra = await confirmarVenta(e.deps, T, caj, VENTA, carrito, pagos, APROBACION);
    expect(otra.repetida).toBe(true);
    const r = await e.bandeja.entregar(T, { duplicados: 2 });
    expect(r.fallidas).toEqual([]);
    expect(r.aplicadas).toBe(0);
    expect({
      movimientos: contar(e, T, 'movimientos'), operaciones: contar(e, T, 'operaciones'), eventos: contar(e, T, 'eventos'),
      recibos: contar(e, T, 'recibos'), stock: doc(e, T, 'productos/lapiz')?.['stockTotal'],
    }).toEqual(antes);
    expect(doc(e, T, 'contadores/recibo_A')).toMatchObject({ ultimo: 1 });
    expect(doc(e, T, 'contadores_recibo/A')).toBeUndefined();
    verificarInvariantes(e, T);
  });

  it('la aprobación del descuento es de un solo uso: la segunda venta falla y no toca el stock', async () => {
    await venderConDescuentoAprobado();
    const antes = { stock: doc(e, T, 'productos/lapiz')?.['stockTotal'], movimientos: contar(e, T, 'movimientos'), ventas: contar(e, T, 'ventas') };
    await expect(
      confirmarVenta(
        e.deps, T, caj, UUID(2),
        { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 2 }], descuento: { monto: 10000, motivo: 'otra vez' } },
        [{ medio: 'efectivo', moneda: 'BOB', monto: 4000 }],
        APROBACION,
      ),
    ).rejects.toMatchObject({ codigo: 'aprobacion-usada' });
    expect({ stock: doc(e, T, 'productos/lapiz')?.['stockTotal'], movimientos: contar(e, T, 'movimientos'), ventas: contar(e, T, 'ventas') }).toEqual(antes);
    verificarInvariantes(e, T);
  });
});

describe('anulación aprobada por el supervisor', () => {
  it('revierte stock y series, reembolsa en el turno abierto y marca el recibo ANULADO sin borrarlo', async () => {
    await venderConDescuentoAprobado();
    await e.bandeja.entregar(T);
    // El reembolso es en efectivo: la caja necesita efectivo suficiente (ingreso justificado).
    await registrarMovimientoCaja(e.deps, T, caj, UUID(60), { tipo: 'ingreso', moneda: 'BOB', monto: 40000, motivo: 'fondo adicional' });
    await solicitarAnulacion(e.deps, T, caj, VENTA, 'cliente se arrepintió');
    const r = await aprobarAnulacion(e.deps, T, sup, VENTA);
    // Se devuelve por los medios originales: 100000 en efectivo (neto de cambio) y 37000 por QR.
    expect(r.reembolsos).toEqual([
      { medio: 'efectivo', moneda: 'BOB', monto: 100000 },
      { medio: 'qr', moneda: 'BOB', monto: 37000 },
    ]);
    expect(r.turnoIdReembolso).toBe(TURNO);
    // Stock y series de vuelta, ya dentro de la transacción del POS.
    expect(doc(e, T, 'existencias/lapiz__tienda')?.['cantidad']).toBe(10);
    expect(doc(e, T, 'existencias/celular__tienda')?.['cantidad']).toBe(3);
    expect(doc(e, T, 'unidades/celular__A')).toMatchObject({ estado: 'disponible' });
    expect(doc(e, T, 'unidades/celular__A')?.['ventaRef']).toBeUndefined();
    expect(doc(e, T, `operaciones/venta-anula-${VENTA}`)).toMatchObject({ tipo: 'reversion' });
    verificarInvariantes(e, T);
    // Entrega duplicada y desordenada de venta.anulada: Inventarios no revierte dos veces; Recibos marca.
    const movimientos = contar(e, T, 'movimientos');
    const entrega = await e.bandeja.entregar(T, { duplicados: 1, orden: 'inverso' });
    expect(entrega.fallidas).toEqual([]);
    expect(entrega.ignoradas).toBeGreaterThan(0);
    expect(doc(e, T, 'existencias/celular__tienda')).toMatchObject({ cantidad: 3, series: ['C', 'A', 'B'] });
    expect(contar(e, T, 'movimientos')).toBe(movimientos);
    const rec = recibo(VENTA);
    expect(rec).toMatchObject({ estado: 'ANULADO', numero: 'A-000001', anulacion: { motivo: 'cliente se arrepintió', aprobadoPor: 'u-sup' } });
    expect(rec.lineas).toHaveLength(2);
    // El reembolso entró en el turno abierto: esperado = apertura + efectivo neto (+100000 - 100000) + ingresos; el QR devuelto no resta del efectivo.
    const cierre = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 50000 });
    expect(cierre.arqueo['BOB']).toMatchObject({ apertura: 10000, esperado: 50000, contado: 50000, diferencia: 0, qr: 0 });
    verificarInvariantes(e, T);
  });

  it('una venta anulada no se anula dos veces ni vuelve a mover stock', async () => {
    await venderConDescuentoAprobado();
    await registrarMovimientoCaja(e.deps, T, caj, UUID(60), { tipo: 'ingreso', moneda: 'BOB', monto: 40000, motivo: 'fondo adicional' });
    await solicitarAnulacion(e.deps, T, caj, VENTA, 'error');
    await aprobarAnulacion(e.deps, T, sup, VENTA);
    await expect(aprobarAnulacion(e.deps, T, sup, VENTA)).rejects.toMatchObject({ codigo: 'venta-ya-anulada' });
    expect(doc(e, T, 'productos/celular')?.['stockTotal']).toBe(3);
    expect(contar(e, T, 'anulaciones')).toBe(1);
    verificarInvariantes(e, T);
  });
});

describe('cierre de turno con arqueo por moneda', () => {
  it('cuadra contra lo vendido en BOB, USD y ARS, y el QR se informa aparte', async () => {
    await abrirTurno(e.deps, T, caj, TURNO, { BOB: 10000, USD: 5000, ARS: 100000 });
    // BOB: 2 lápices en efectivo (140,00 Bs) con cambio; QR de 1 lápiz (70,00 Bs).
    await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 2 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 15000, cambio: 1000 },
    ]);
    await confirmarVenta(e.deps, T, caj, UUID(2), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
      { medio: 'qr', moneda: 'BOB', monto: 7000, referencia: 'QR-2' },
    ]);
    // USD: 1 lápiz a 10,00 USD en efectivo, sin cotización.
    await confirmarVenta(e.deps, T, caj, UUID(3), { mercado: 'BO', moneda: 'USD', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
      { medio: 'efectivo', moneda: 'USD', monto: 1000 },
    ]);
    // ARS: 1 lápiz a 10 USD x 1 000 = 10 000,00 ARS en efectivo.
    await confirmarVenta(e.deps, T, caj, UUID(4), { mercado: 'AR', moneda: 'ARS', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
      { medio: 'efectivo', moneda: 'ARS', monto: 1000000 },
    ]);
    const cierre = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 + 14000, USD: 5000 + 1000, ARS: 100000 + 1000000 });
    expect(cierre.arqueo['BOB']).toMatchObject({ esperado: 24000, diferencia: 0, efectivo: 14000, qr: 7000 });
    expect(cierre.arqueo['USD']).toMatchObject({ esperado: 6000, diferencia: 0 });
    expect(cierre.arqueo['ARS']).toMatchObject({ esperado: 1100000, diferencia: 0 });
    const ev = eventosDe(e, T, 'turno.cerrado');
    expect(ev).toHaveLength(1);
    expect(validarEvento(ev[0]).ok).toBe(true);
    // Lo vendido en el turno (4 lápices menos 1 depósito intacto): stock coherente.
    expect(doc(e, T, 'productos/lapiz')?.['stockTotal']).toBe(10);
    verificarInvariantes(e, T);
    // Tras el cierre ya no se vende.
    await expect(confirmarVenta(e.deps, T, caj, UUID(5), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
    ])).rejects.toMatchObject({ codigo: 'sin-turno' });
  });

  it('una falta de efectivo queda como diferencia negativa, sin taparse', async () => {
    await abrirTurno(e.deps, T, caj, TURNO, { BOB: 10000 });
    await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 7000 },
    ]);
    const cierre = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 16500 });
    expect(cierre.arqueo['BOB']).toMatchObject({ esperado: 17000, contado: 16500, diferencia: -500 });
  });
});
