// Incoherencias entre módulos que hoy se comportan así. Cada prueba documenta el estado actual con
// el código de la lista del informe de integración; si se corrige la causa, la prueba debe actualizarse.
import { StockInsuficiente } from '@plataforma/inventarios';
import { ErrorPos, abrirTurno, confirmarVenta } from '@plataforma/pos';
import type { Recibo } from '@plataforma/recibos';
import { describe, expect, it } from 'vitest';
import { T, UUID, caj, doc, entornoListo } from './entorno.js';

describe('incoherencias documentadas', () => {
  it('I-02: la fecha de fin de garantía difiere entre Inventarios (UTC) y Recibos (La Paz) cerca de la medianoche', async () => {
    const e = await entornoListo();
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    // 22:00 del 4/11 en La Paz = 02:00 UTC del 5/11.
    e.reloj.ahora = Date.UTC(2026, 10, 5, 2, 0, 0);
    await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'celular', cantidad: 1, series: ['A'] }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 70000 },
    ]);
    await e.bandeja.entregar(T);
    const recibo = doc(e, T, `recibos/recibo-${UUID(1)}`) as unknown as Recibo;
    expect(doc(e, T, 'unidades/celular__A')?.['garantiaHasta']).toBe('2027-11-05');
    expect(recibo.fecha).toBe('2026-11-04');
    expect(recibo.lineas[0]?.garantiaHasta).toBe('2027-11-04');
  });

  it('I-05: el POS lanza ErrorPos, pero stock insuficiente llega como StockInsuficiente de Inventarios (el borde debe traducir ambos)', async () => {
    const e = await entornoListo();
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    const error = await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 11 }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 77000 },
    ]).catch((x: unknown) => x);
    expect(error).toBeInstanceOf(StockInsuficiente);
    expect(error).not.toBeInstanceOf(ErrorPos);
    expect((error as StockInsuficiente).codigo).toBe('failed-precondition');
  });
});
