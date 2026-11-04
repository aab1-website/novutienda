// Callable `pos`: turno, venta, aprobaciones, anulaciones, caja, créditos, cierre y configuración, más las
// lecturas del vendedor «solo lo mío» y la supervisión en vivo de `sup`/`adm`.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  abrirTurno, aprobarAnulacion, cerrarTurno, cerrarTurnoForzado, cobrarCredito, confirmarVenta, csvMovimientosCaja, csvVentas,
  guardarConfigPos, leerConfigPos, proyectarTurno, registrarMovimientoCaja, resolverAprobacion, solicitarAnulacion, solicitarAprobacion,
  type Carrito, type CobroCreditoEntrada, type MovimientoCaja, type MovimientoCajaEntrada, type SolicitudAprobacion, type VentaPos,
} from '@plataforma/pos';
import { accion, actorPos, type TablaAcciones } from './marco.js';
import { LIMITE, MS, OBJETO, UUID, VACIO, objeto, validarRango, TEXTO } from './comunes.js';

const TODOS = ['caj', 'sup', 'adm'] as const;
const SUPERVISION = ['sup', 'adm'] as const;

const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;

export const accionesPos: TablaAcciones = {
  // ---- Turno ------------------------------------------------------------------------------------------------
  abrirTurno: accion({
    roles: TODOS,
    esquema: objeto({ turnoId: UUID, apertura: OBJETO }),
    ejecutar: async (c, d) => abrirTurno(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.apertura),
  }),
  cerrarTurno: accion({
    roles: TODOS,
    esquema: objeto({ turnoId: UUID, contado: OBJETO }),
    ejecutar: async (c, d) => cerrarTurno(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.contado),
  }),
  cerrarTurnoForzado: accion({
    roles: ['adm'],
    esquema: objeto({ turnoId: UUID, contado: OBJETO, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => cerrarTurnoForzado(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.contado, d.motivo),
  }),

  // ---- Venta ------------------------------------------------------------------------------------------------
  confirmarVenta: accion({
    roles: TODOS,
    maxCaracteres: 128_000,
    esquema: objeto({ requestId: UUID, carrito: OBJETO, pagos: z.array(OBJETO).min(1).max(10), aprobacionId: UUID.optional(), aprobacionCreditoId: UUID.optional() }),
    ejecutar: async (c, d) =>
      confirmarVenta(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.carrito as unknown as Carrito, d.pagos, d.aprobacionId, d.aprobacionCreditoId),
  }),

  // ---- Aprobaciones y anulaciones --------------------------------------------------------------------------
  solicitarAprobacion: accion({
    roles: TODOS,
    esquema: objeto({ aprobacionId: UUID, solicitud: OBJETO }),
    ejecutar: async (c, d) => solicitarAprobacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.aprobacionId, d.solicitud as unknown as SolicitudAprobacion),
  }),
  resolverAprobacion: accion({
    roles: SUPERVISION,
    esquema: objeto({ aprobacionId: UUID, decision: z.enum(['aprobar', 'rechazar']) }),
    ejecutar: async (c, d) => resolverAprobacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.aprobacionId, d.decision),
  }),
  solicitarAnulacion: accion({
    roles: TODOS,
    esquema: objeto({ ventaId: UUID, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => solicitarAnulacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.ventaId, d.motivo),
  }),
  aprobarAnulacion: accion({
    roles: SUPERVISION,
    esquema: objeto({ ventaId: UUID }),
    ejecutar: async (c, d) => aprobarAnulacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.ventaId),
  }),

  // ---- Caja y créditos --------------------------------------------------------------------------------------
  registrarMovimientoCaja: accion({
    roles: TODOS,
    esquema: objeto({ requestId: UUID, movimiento: OBJETO }),
    ejecutar: async (c, d) =>
      registrarMovimientoCaja(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.movimiento as unknown as MovimientoCajaEntrada),
  }),
  cobrarCredito: accion({
    roles: TODOS,
    esquema: objeto({ requestId: UUID, ventaId: UUID, cobro: OBJETO }),
    ejecutar: async (c, d) => cobrarCredito(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.ventaId, d.cobro as unknown as CobroCreditoEntrada),
  }),

  // ---- Configuración ----------------------------------------------------------------------------------------
  leerConfig: accion({
    roles: TODOS,
    esquema: VACIO,
    ejecutar: async (c) => ({ config: await c.e.db.runTransaction((tx) => leerConfigPos(tx, c.tenantId)) }),
  }),
  guardarConfig: accion({
    roles: ['adm'],
    esquema: objeto({ config: OBJETO }),
    ejecutar: async (c, d) => ({ config: await guardarConfigPos(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.config) }),
  }),

  // ---- Lecturas «solo lo mío» -------------------------------------------------------------------------------
  /** Turno abierto. El vendedor ve el suyo; si la caja la tiene otro, solo se le dice que está ocupada. */
  miTurno: accion({
    roles: TODOS,
    esquema: VACIO,
    ejecutar: async (c) => {
      const activo = (await c.e.firestore.doc(ruta(c.tenantId, 'pos_config', 'turno_activo')).get()).data();
      if (activo === undefined) return { turno: null, cajaOcupada: false };
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', String(activo['turnoId']))).get()).data();
      if (turno === undefined) return { turno: null, cajaOcupada: false };
      if (c.rol === 'caj' && turno['cajeroUid'] !== c.sesion.uid) return { turno: null, cajaOcupada: true };
      return { turno, cajaOcupada: false, proyeccion: proyectarTurno({ apertura: turno['apertura'] as never, totales: turno['totales'] as never }) };
    },
  }),
  /** Ventas: el vendedor solo las suyas; `sup`/`adm` todas (o solo las suyas con `soloMias`). */
  misVentas: accion({
    roles: TODOS,
    esquema: objeto({ turnoId: UUID.optional(), desde: MS.optional(), hasta: MS.optional(), limite: LIMITE.optional(), soloMias: z.boolean().optional() }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      let q = c.e.firestore.collection(ruta(c.tenantId, 'ventas')).orderBy('creadoEnMs', 'desc');
      if (c.rol === 'caj' || d.soloMias === true) q = q.where('cajeroUid', '==', c.sesion.uid);
      if (d.turnoId !== undefined) q = q.where('turnoId', '==', d.turnoId);
      if (d.desde !== undefined) q = q.where('creadoEnMs', '>=', d.desde);
      if (d.hasta !== undefined) q = q.where('creadoEnMs', '<=', d.hasta);
      const snap = await q.limit(d.limite ?? 50).get();
      return { ventas: snap.docs.map(datosDe) };
    },
  }),
  venta: accion({
    roles: TODOS,
    esquema: objeto({ ventaId: UUID }),
    ejecutar: async (c, d) => {
      const venta = (await c.e.firestore.doc(ruta(c.tenantId, 'ventas', d.ventaId)).get()).data();
      if (venta === undefined) throw new HttpsError('not-found', 'La venta no existe.');
      if (c.rol === 'caj' && venta['cajeroUid'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver sus propias ventas.');
      return { venta };
    },
  }),
  /** Aprobaciones: `sup`/`adm` ven las pendientes; el vendedor, las que él solicitó. */
  aprobaciones: accion({
    roles: TODOS,
    esquema: objeto({ estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'usada']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'aprobaciones_descuento')).orderBy('solicitadoEnMs', 'desc');
      if (c.rol === 'caj') q = q.where('solicitadoPor', '==', c.sesion.uid);
      q = q.where('estado', '==', d.estado ?? 'pendiente');
      const snap = await q.limit(d.limite ?? 50).get();
      return { aprobaciones: snap.docs.map(datosDe) };
    },
  }),
  aprobacion: accion({
    roles: TODOS,
    esquema: objeto({ aprobacionId: UUID }),
    ejecutar: async (c, d) => {
      const a = (await c.e.firestore.doc(ruta(c.tenantId, 'aprobaciones_descuento', d.aprobacionId)).get()).data();
      if (a === undefined) throw new HttpsError('not-found', 'La solicitud no existe.');
      if (c.rol === 'caj' && a['solicitadoPor'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver sus propias solicitudes.');
      return { aprobacion: a };
    },
  }),
  movimientosCaja: accion({
    roles: TODOS,
    esquema: objeto({ turnoId: UUID, limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', d.turnoId)).get()).data();
      if (turno === undefined) throw new HttpsError('not-found', 'El turno no existe.');
      if (c.rol === 'caj' && turno['cajeroUid'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver los movimientos de su turno.');
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'movimientos_caja')).where('turnoId', '==', d.turnoId).orderBy('creadoEnMs', 'desc').limit(d.limite ?? 100).get();
      return { movimientos: snap.docs.map(datosDe) };
    },
  }),
  creditos: accion({
    roles: SUPERVISION,
    esquema: objeto({ estado: z.enum(['pendiente', 'cobrado']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      let q = c.e.firestore.collection(ruta(c.tenantId, 'creditos')).orderBy('creadoEnMs', 'desc');
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      const snap = await q.limit(d.limite ?? 100).get();
      return { creditos: snap.docs.map(datosDe) };
    },
  }),

  // ---- Supervisión ------------------------------------------------------------------------------------------
  /** Supervisión de caja en vivo: turno abierto, proyección del efectivo esperado y últimas ventas. */
  supervision: accion({
    roles: SUPERVISION,
    esquema: VACIO,
    ejecutar: async (c) => {
      const activo = (await c.e.firestore.doc(ruta(c.tenantId, 'pos_config', 'turno_activo')).get()).data();
      if (activo === undefined) return { turno: null };
      const turnoId = String(activo['turnoId']);
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', turnoId)).get()).data();
      if (turno === undefined) return { turno: null };
      const ventas = await c.e.firestore.collection(ruta(c.tenantId, 'ventas')).where('turnoId', '==', turnoId).orderBy('creadoEnMs', 'desc').limit(20).get();
      return {
        turno,
        proyeccion: proyectarTurno({ apertura: turno['apertura'] as never, totales: turno['totales'] as never }),
        ultimasVentas: ventas.docs.map(datosDe),
      };
    },
  }),
  turnos: accion({
    roles: SUPERVISION,
    esquema: objeto({ limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'turnos')).orderBy('abiertoEnMs', 'desc').limit(d.limite ?? 30).get();
      return { turnos: snap.docs.map(datosDe) };
    },
  }),

  // ---- Exportaciones (CSV con celdas neutralizadas por el módulo) -------------------------------------------
  exportarVentasCsv: accion({
    roles: SUPERVISION,
    esquema: objeto({ desde: MS, hasta: MS }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'ventas')).where('creadoEnMs', '>=', d.desde).where('creadoEnMs', '<=', d.hasta).orderBy('creadoEnMs', 'asc').limit(5000).get();
      return { csv: csvVentas(snap.docs.map(datosDe) as unknown as VentaPos[]) };
    },
  }),
  exportarMovimientosCajaCsv: accion({
    roles: SUPERVISION,
    esquema: objeto({ turnoId: UUID }),
    ejecutar: async (c, d) => {
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'movimientos_caja')).where('turnoId', '==', d.turnoId).orderBy('creadoEnMs', 'asc').limit(5000).get();
      return { csv: csvMovimientosCaja(snap.docs.map(datosDe) as unknown as MovimientoCaja[]) };
    },
  }),
};

