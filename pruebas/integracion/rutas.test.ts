import { abrirTurno, aprobarAnulacion, cerrarTurno, confirmarVenta, registrarMovimientoCaja, solicitarAnulacion } from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { T, UUID, caj, entornoListo, sup } from './entorno.js';

/** Colección de primer nivel de un documento `tenants/{t}/{coleccion}/...`. */
const coleccionDe = (ruta: string): string => ruta.split('/')[2] ?? '';

describe('rutas que escriben los módulos frente a los manifiestos registrados', () => {
  it('todo documento escrito en un flujo completo pertenece a una colección declarada, y cada colección tiene un solo dueño', async () => {
    const e = await entornoListo();
    await abrirTurno(e.deps, T, caj, UUID(900), { BOB: 0 });
    await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'celular', cantidad: 1, series: ['A'] }] }, [
      { medio: 'efectivo', moneda: 'BOB', monto: 70000 },
    ]);
    await registrarMovimientoCaja(e.deps, T, caj, UUID(60), { tipo: 'ingreso', moneda: 'BOB', monto: 100, motivo: 'm' });
    await solicitarAnulacion(e.deps, T, caj, UUID(1), 'error');
    await aprobarAnulacion(e.deps, T, sup, UUID(1), 'aprobada por supervisión');
    await e.bandeja.entregar(T);
    await cerrarTurno(e.deps, T, caj, UUID(900), { BOB: 100 });

    const duenos = new Map<string, string>();
    for (const m of manifiestosEnOrden()) for (const c of m.colecciones) duenos.set(c.ruta.split('/')[0] ?? '', m.id);
    const escritas = new Set([...e.db.docs.keys()].filter((r) => r.startsWith(`tenants/${T}/`)).map(coleccionDe));
    escritas.delete('');
    const sinDueno = [...escritas].filter((c) => !duenos.has(c)).sort();
    expect(sinDueno).toEqual([]);
    // Las colecciones esperadas de cada módulo sí aparecieron.
    for (const c of ['productos', 'existencias', 'unidades', 'movimientos', 'operaciones', 'ventas', 'turnos', 'anulaciones', 'recibos', 'eventos', 'procesados', 'auditoria', 'contadores', 'cotizaciones']) {
      expect(escritas.has(c), c).toBe(true);
    }
  });
});
