import {
  agregarVentas, aprobarAnulacion, cerrarTurno, confirmarVenta, resumirTurnoAgregado, FILAS_POR_PAGINA, leerAnulacion, leerTurno, leerVenta, paginar, reconstruirTotales, registrarMovimientoCaja, resumirTurno, solicitarAnulacion, type VentaPos,
} from '@novutienda/pos';
import { resumirTurnoDoble } from '@novutienda/panel/pos';
import { describe, expect, it } from 'vitest';
import { T, TURNO, UUID, abrir, caj, carritoP1, crearEntorno, efectivo, sup, venderP1 } from './ayudas.js';

async function escenario() {
  const e = crearEntorno();
  await abrir(e);
  await venderP1(e, 1);
  await venderP1(e, 2, caj, 2);
  await venderP1(e, 3);
  await registrarMovimientoCaja(e.deps, T, caj, UUID(50), { tipo: 'ingreso', moneda: 'BOB', monto: 500, motivo: 'cambio inicial' });
  await solicitarAnulacion(e.deps, T, caj, UUID(2), 'error');
  await aprobarAnulacion(e.deps, T, sup, UUID(2), 'verificado');
  const turno = leerTurno(e.db.dato(`tenants/${T}/turnos/${TURNO}`));
  const ventas = e.db.coleccion(`tenants/${T}/ventas`).map((d) => leerVenta(d));
  const anulaciones = e.db.coleccion(`tenants/${T}/anulaciones`).map((d) => leerAnulacion(d));
  return { e, turno, ventas, anulaciones };
}

describe('resumirTurno', () => {
  it('cuenta ventas, anuladas, reembolsos, ingresos y cobros contra lo sembrado', async () => {
    const { turno, ventas, anulaciones } = await escenario();
    const r = resumirTurno(turno, ventas, anulaciones, false);
    expect(r.monedas).toEqual(['BOB']);
    expect(r.truncado).toBe(false);
    const b = r.porMoneda['BOB'];
    expect(b).toMatchObject({
      ventas: 2, bruto: 14000, neto: 14000, descuentos: { cantidad: 0, monto: 0 },
      anuladas: { cantidad: 1, monto: 14000 }, ingresos: 500, egresos: 0,
    });
    expect(b?.reembolsos).toEqual({ efectivo: 14000, qr: 0, transferencia: 0, credito: 0 });
    // Efectivo cobrado: 7000 + 14000 + 7000 - 14000 devuelto.
    expect(b?.porMedio.efectivo).toBe(14000);
    // Coincide con la reconstrucción independiente de los totales del turno.
    expect(b?.porMedio).toMatchObject({ efectivo: reconstruirTotales(TURNO, { ventas, cobrosCredito: [], movimientos: [{ turnoId: TURNO, moneda: 'BOB', tipo: 'ingreso', monto: 500 }], anulaciones })['BOB']?.efectivo });
  });

  it('suma descuentos con su cantidad y deja el neto como lo vendido', async () => {
    const { turno, ventas } = await escenario();
    const con: VentaPos[] = ventas.map((v) => (v.ventaId === UUID(1) ? { ...v, subtotal: 7500, descuento: { monto: 500, motivo: 'cliente frecuente' } } : v));
    const b = resumirTurno(turno, con, [], false).porMoneda['BOB'];
    expect(b).toMatchObject({ bruto: 14500, neto: 14000, descuentos: { cantidad: 1, monto: 500 } });
  });

  it('ignora ventas y anulaciones de otro turno y marca truncado', async () => {
    const { turno, ventas, anulaciones } = await escenario();
    const otro = ventas.map((v) => ({ ...v, turnoId: 'otro' }));
    const r = resumirTurno(turno, otro, anulaciones.map((a) => ({ ...a, turnoIdReembolso: 'otro' })), true);
    expect(r.porMoneda['BOB']).toMatchObject({ ventas: 0, anuladas: { cantidad: 0 }, reembolsos: { efectivo: 0 } });
    expect(r.truncado).toBe(true);
  });
});

describe('resumirTurno: casos de borde', () => {
  it('una venta anulada en un turno posterior cuenta como anulada en su turno y como reembolso en el posterior', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    const cierre = await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 17000 });
    expect(cierre).toBeTruthy();
    const TURNO2 = UUID(901);
    await abrir(e, caj, { BOB: 20000 }, TURNO2);
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error de precio');
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'verificado');
    const ventas = e.db.coleccion(`tenants/${T}/ventas`).map((d) => leerVenta(d));
    const anulaciones = e.db.coleccion(`tenants/${T}/anulaciones`).map((d) => leerAnulacion(d));
    expect(anulaciones[0]?.turnoIdReembolso).toBe(TURNO2);
    const t1 = resumirTurno(leerTurno(e.db.dato(`tenants/${T}/turnos/${TURNO}`)), ventas, anulaciones, false).porMoneda['BOB'];
    const t2 = resumirTurno(leerTurno(e.db.dato(`tenants/${T}/turnos/${TURNO2}`)), ventas, anulaciones, false).porMoneda['BOB'];
    // La venta pertenece al turno 1: ahí figura anulada y no confirmada; el dinero devuelto sale del turno 2.
    expect(t1).toMatchObject({ ventas: 0, neto: 0, anuladas: { cantidad: 1, monto: 7000 }, reembolsos: { efectivo: 0 } });
    expect(t2).toMatchObject({ ventas: 0, neto: 0, anuladas: { cantidad: 0, monto: 0 }, reembolsos: { efectivo: 7000, qr: 0, transferencia: 0, credito: 0 } });
    expect(t2?.porMedio.efectivo).toBe(-7000);
  });

  it('porMedio completo (efectivo, QR, transferencia y crédito) coincide con reconstruirTotales', async () => {
    const e = crearEntorno();
    await abrir(e);
    await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(1), [
      { medio: 'qr', moneda: 'BOB', monto: 3000, referencia: 'REF-1' }, { medio: 'transferencia', moneda: 'BOB', monto: 2000 }, efectivo(2500, 500),
    ]);
    await venderP1(e, 2);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(50), { tipo: 'egreso', moneda: 'BOB', monto: 300, motivo: 'compra de bolsas' });
    const turno = leerTurno(e.db.dato(`tenants/${T}/turnos/${TURNO}`));
    const ventas = e.db.coleccion(`tenants/${T}/ventas`).map((d) => leerVenta(d));
    const b = resumirTurno(turno, ventas, [], false).porMoneda['BOB'];
    const real = reconstruirTotales(TURNO, { ventas, cobrosCredito: [], movimientos: [{ turnoId: TURNO, moneda: 'BOB', tipo: 'egreso', monto: 300 }], anulaciones: [] })['BOB'];
    expect(b?.porMedio).toEqual({ efectivo: real?.efectivo ?? 0, qr: real?.qr ?? 0, transferencia: real?.transferencia ?? 0, credito: real?.credito ?? 0 });
    expect(b?.porMedio).toEqual({ efectivo: 2000 + 7000, qr: 3000, transferencia: 2000, credito: 0 });
    expect(b?.egresos).toBe(300);
  });

  it('el resumen por agregados es el mismo que el calculado sobre las ventas leídas', async () => {
    const { turno, ventas, anulaciones } = await escenario();
    expect(resumirTurnoAgregado(turno, agregarVentas(turno.turnoId, ventas), anulaciones, false)).toEqual(resumirTurno(turno, ventas, anulaciones, false));
  });
});

describe('doble del panel', () => {
  it('el resumen del doble es idéntico al de resumirTurno sobre las mismas ventas y anulaciones', async () => {
    const { turno, ventas, anulaciones } = await escenario();
    const con: VentaPos[] = ventas.map((v) => (v.ventaId === UUID(1) ? { ...v, subtotal: 7500, descuento: { monto: 500, motivo: 'cliente frecuente' } } : v));
    const esperado = resumirTurno(turno, con, anulaciones, false);
    const doble = resumirTurnoDoble(turno as never, con as never, anulaciones as never, ['BOB', 'USD', 'ARS']);
    expect(JSON.parse(JSON.stringify(doble))).toEqual(JSON.parse(JSON.stringify(esperado)));
  });
});

describe('paginar', () => {
  const docs = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}` }));
  it('devuelve el cursor de la última fila cuando sobra un documento', () => {
    expect(paginar(docs, 6, (d) => d.id)).toEqual({ filas: docs.slice(0, 6), siguiente: 'd5' });
  });
  it('sin sobrante no hay siguiente', () => {
    expect(paginar(docs, 7, (d) => d.id)).toEqual({ filas: docs, siguiente: null });
    expect(paginar([], 3, (d: { id: string }) => d.id).siguiente).toBeNull();
  });
  it('la página por omisión es de 50', () => {
    expect(FILAS_POR_PAGINA).toBe(50);
  });
});

describe('leerAnulacion', () => {
  it('rechaza documentos corruptos', () => {
    expect(() => leerAnulacion(undefined)).toThrow();
    expect(() => leerAnulacion({ turnoIdReembolso: 'x', moneda: 'bob', reembolsos: [], creditoCancelado: 0 })).toThrow();
    expect(() => leerAnulacion({ turnoIdReembolso: 'x', moneda: 'BOB', reembolsos: [{ medio: 'oro', monto: 1 }], creditoCancelado: 0 })).toThrow();
  });
});
