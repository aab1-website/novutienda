import {
  publicarEvento,
  registrarAuditoria,
  type MotivoStockCambiado,
  type Resumen,
  type TransaccionBandeja,
  type TransaccionIdentidad,
} from '@novutienda/nucleo';
import { idMovimiento, idUnidad, ruta } from './ids.js';
import { MARCA_SERVIDOR, type Autor, type Datos, type PlanStock, type Referencia } from './motor.js';

export const ORIGEN = 'inventarios';

/** Contexto de la operación que materializa un plan. */
export interface Contexto {
  readonly operacionId: string;
  readonly tipoOperacion: string;
  /** Acción de la bitácora, por ejemplo `inventarios.ingreso`. */
  readonly accion: string;
  /** Documento que origina el movimiento (venta, pedido, ingreso...). */
  readonly referencia: Referencia;
  readonly tipoMovimiento: MotivoStockCambiado;
  readonly por: Autor;
  readonly hashCarga: string;
  /** Resultado guardado en `operaciones/{id}` y devuelto ante un reintento. Solo valores JSON. */
  readonly resultado: Datos;
  readonly motivo?: string;
  readonly resumen?: Resumen;
}

/** Adaptador: la transacción de identidad sirve como transacción de la bandeja de eventos. */
export const comoBandeja = (tx: TransaccionIdentidad): TransaccionBandeja => ({
  create: (r, d) => {
    tx.create(r, d);
  },
  existe: async (r) => (await tx.get(r)).existe,
  marcaTiempoServidor: () => tx.marcaTiempoServidor(),
});

function conMarca(tx: TransaccionIdentidad, datos: Datos): Datos {
  const salida: Datos = {};
  for (const [k, v] of Object.entries(datos)) salida[k] = v === MARCA_SERVIDOR ? tx.marcaTiempoServidor() : v;
  return salida;
}

/**
 * SOLO ESCRITURAS: documentos del plan, unidades, movimientos (`create`), operación (`create`),
 * eventos `stock.cambiado`/`stock.bajo` y auditoría, todo en la transacción recibida.
 */
export function aplicarPlan(tx: TransaccionIdentidad, plan: PlanStock, ctx: Contexto): void {
  const t = plan.tenantId;
  for (const d of plan.docs) {
    if (d.modo === 'create') tx.create(d.ruta, conMarca(tx, d.datos));
    else tx.set(d.ruta, conMarca(tx, d.datos));
  }
  for (const u of plan.unidades) {
    const doc: Datos = { ...(u.base ?? {}) };
    delete doc['ventaRef'];
    delete doc['mermaRef'];
    delete doc['garantiaHasta'];
    doc['productoId'] = u.productoId;
    doc['serie'] = u.serie;
    doc['estado'] = u.estado;
    doc['ubicacionId'] = u.ubicacionId;
    if (u.modo === 'create') {
      doc['ingresadoEn'] = tx.marcaTiempoServidor();
      doc['ingresadoEnIso'] = plan.ahora;
      doc['operacionIngreso'] = ctx.operacionId;
    }
    if (u.estado === 'vendida') {
      doc['ventaRef'] = { ...ctx.referencia };
      if (u.garantiaHasta !== undefined) doc['garantiaHasta'] = u.garantiaHasta;
    }
    if (u.estado === 'merma') doc['mermaRef'] = { ...ctx.referencia };
    const r = ruta(t, 'unidades', idUnidad(u.productoId, u.serie));
    if (u.modo === 'create') tx.create(r, doc);
    else tx.set(r, doc);
  }
  const bandeja = comoBandeja(tx);
  for (const m of plan.movimientos) {
    const id = idMovimiento(ctx.operacionId, m.productoId, m.ubicacionId);
    const tipo = m.tipo ?? ctx.tipoMovimiento;
    tx.create(ruta(t, 'movimientos', id), {
      operacionId: ctx.operacionId,
      productoId: m.productoId,
      ubicacionId: m.ubicacionId,
      tipo,
      delta: m.delta,
      saldoUbicacion: m.saldoUbicacion,
      saldoTotal: m.saldoTotal,
      series: [...m.series],
      ...(m.costoUSDUnit !== undefined ? { costoUSDUnit: m.costoUSDUnit } : {}),
      referencia: { ...ctx.referencia },
      por: ctx.por.uid,
      rol: ctx.por.rol,
      fecha: tx.marcaTiempoServidor(),
    });
    publicarEvento(bandeja, {
      id: `sc-${id}`,
      tipo: 'stock.cambiado',
      version: 1,
      tenantId: t,
      origen: ORIGEN,
      ocurridoEn: plan.ahora,
      claveIdempotencia: `sc-${id}`,
      datos: {
        productoId: m.productoId,
        almacenId: m.ubicacionId,
        delta: m.delta,
        saldo: m.saldoUbicacion,
        movimientoId: id,
        motivo: tipo,
        por: ctx.por.uid,
        referencia: { ...ctx.referencia },
      },
    });
  }
  for (const a of plan.alertas) {
    const id = `sb-${ctx.operacionId}__${a.productoId}`;
    publicarEvento(bandeja, {
      id,
      tipo: 'stock.bajo',
      version: 1,
      tenantId: t,
      origen: ORIGEN,
      ocurridoEn: plan.ahora,
      claveIdempotencia: id,
      datos: { productoId: a.productoId, saldoTotal: a.saldoTotal, minimo: a.minimo },
    });
  }
  tx.create(ruta(t, 'operaciones', ctx.operacionId), {
    tipo: ctx.tipoOperacion,
    hashCarga: ctx.hashCarga,
    resultado: ctx.resultado,
    por: ctx.por.uid,
    rol: ctx.por.rol,
    fecha: tx.marcaTiempoServidor(),
  });
  registrarAuditoria(tx, {
    tenantId: t,
    uid: ctx.por.uid,
    rol: ctx.por.rol,
    accion: ctx.accion,
    ruta: `operaciones/${ctx.operacionId}`,
    resumenDespues: {
      operacionId: ctx.operacionId,
      tipo: ctx.tipoOperacion,
      movimientos: plan.movimientos.length,
      ...(ctx.resumen ?? {}),
    },
    ...(ctx.motivo !== undefined ? { motivo: ctx.motivo } : {}),
  });
}
