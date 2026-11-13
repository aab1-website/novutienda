// (d) Caja: totales, conversión, pagos y vuelto de ventas del POS en BOB, USD y ARS; movimientos, arqueo y cierre de
// turno por moneda; exportaciones CSV de ventas y movimientos. Usa las funciones reales de `@novutienda/pos` sobre
// el doble de base de integración (reloj y ids inyectados).
import { cerrarTurno, csvMovimientosCaja, csvVentas, type MovimientoCaja, type VentaPos } from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { T, caj, doc } from '../integracion/entorno.js';
import { TURNO, jornada } from './jornada.js';
import { compararConFotoJson, compararConFoto } from './foto.js';

describe('caja de Casa Bermejo en tres monedas', () => {
  it('ventas: totales, conversión, pagos y vuelto por moneda', async () => {
    const { e } = await jornada();
    const ventas = e.db.coleccion(`tenants/${T}/ventas`).sort((a, b) => a.id.localeCompare(b.id)).map((v) => ({ id: v.id, ...v.datos }) as Record<string, unknown>);
    expect(ventas.map((v) => [v['moneda'], v['total']])).toEqual([['BOB', 141035], ['USD', 708], ['ARS', 2290000], ['BOB', 10448]]);
    compararConFotoJson('caja-ventas.json', ventas);
    const eventos = e.db.coleccion(`tenants/${T}/eventos`).filter((x) => x.datos['tipo'] === 'venta.confirmada').map((x) => x.datos);
    compararConFotoJson('caja-eventos-venta.json', eventos);
    const existencias = Object.fromEntries(e.db.coleccion(`tenants/${T}/existencias`).filter((x) => ['p-lapiz__tienda', 'p-celular__tienda', 'p-cable__tienda', 'p-parlante__tienda', 'p-adaptador__tienda'].includes(x.id)).map((x) => [x.id, x.datos]));
    compararConFotoJson('caja-existencias-tras-ventas.json', existencias);
  });

  // Esperado en efectivo por moneda: apertura + efectivo neto de vuelto + ingresos - egresos.
  //   BOB 20 000 + 110 448 = 130 448 (se cuenta 130 548: sobrante de 100)
  //   USD  5 000 +     408 -     400 =   5 008 (se cuenta 5 008: exacto)
  //   ARS 100 000 + 2 000 000 + 50 000 = 2 150 000 (se cuenta 2 145 000: faltante de 5 000)
  it('turno: arqueo esperado y cierre por moneda con faltante, sobrante y exacto', async () => {
    const { e, d } = await jornada();
    const abierto = doc(e, T, `turnos/${TURNO}`);
    const movs = e.db.coleccion(`tenants/${T}/movimientos_caja`).sort((a, b) => a.id.localeCompare(b.id)).map((m) => ({ id: m.id, ...m.datos }));
    const cierre = await cerrarTurno(d, T, caj, TURNO, { BOB: 130548, USD: 5008, ARS: 2145000 });
    compararConFotoJson('caja-turno-cierre.json', { abierto, movimientos: movs, cierre, turnoCerrado: doc(e, T, `turnos/${TURNO}`) });
    expect(cierre.arqueo.BOB?.diferencia).toBe(100);
    expect(cierre.arqueo.USD?.diferencia).toBe(0);
    expect(cierre.arqueo.ARS?.diferencia).toBe(-5000);
  });

  it('exportaciones CSV de ventas y movimientos de caja', async () => {
    const { e } = await jornada();
    const ventas = e.db.coleccion(`tenants/${T}/ventas`).sort((a, b) => a.id.localeCompare(b.id)).map((v) => v.datos as unknown as VentaPos);
    const movs = e.db.coleccion(`tenants/${T}/movimientos_caja`).sort((a, b) => a.id.localeCompare(b.id)).map((m) => m.datos as unknown as MovimientoCaja);
    compararConFoto('caja-ventas.csv', csvVentas(ventas));
    compararConFoto('caja-movimientos.csv', csvMovimientosCaja(movs));
  });
});
