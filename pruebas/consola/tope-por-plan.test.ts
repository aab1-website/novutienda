// El tope de productos y usuarios del tablero sale del plan del tenant, no de `base`.
import { obtenerTablero } from '@novutienda/consola';
import { COMERCIAL_LEGADO_TRES_MONEDAS, PLANES } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';
import { actor, nuevaDb, RelojFijo, T, tenantOk } from './dobles.js';

const cotizaciones = { leer: async () => null, transaccion: () => Promise.reject(new Error('no usada')) } as never;

async function tableroConPlan(plan: unknown) {
  const db = nuevaDb();
  db.poner(`tenants/${T}`, { ...tenantOk, plan });
  return obtenerTablero({ db, reloj: new RelojFijo(), comercial: COMERCIAL_LEGADO_TRES_MONEDAS, cotizaciones }, { tenantId: T, actor: actor('sup') });
}

describe('tope del tablero por plan del tenant', () => {
  it.each(['base', 'multimercado', 'pruebas'] as const)('plan %s: muestra los topes de ese plan', async (plan) => {
    const t = await tableroConPlan(plan);
    expect(t.uso.productos.tope).toBe(PLANES[plan].productos);
    expect(t.uso.usuarios.tope).toBe(PLANES[plan].usuarios);
  });

  it('el plan pruebas permite más usuarios que base', async () => {
    const t = await tableroConPlan('pruebas');
    expect(t.uso.usuarios.tope).toBeGreaterThan(PLANES.base.usuarios);
  });

  it('un plan ausente o desconocido cae a base', async () => {
    const t = await tableroConPlan('inexistente');
    expect(t.uso.usuarios.tope).toBe(PLANES.base.usuarios);
  });
});
