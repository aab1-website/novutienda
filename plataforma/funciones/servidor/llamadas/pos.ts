// Callable `pos`: turno, venta, aprobaciones, anulaciones, caja, créditos, cierre y configuración, más las
// lecturas del vendedor «solo lo mío» y la supervisión en vivo de `sup`/`adm`.
import { HttpsError } from 'firebase-functions/v2/https';
import { AggregateField, FieldPath } from 'firebase-admin/firestore';
import { z } from 'zod';
import {
  abrirTurno, aprobarAnulacion, cancelarCarrito, crearCarrito, guardarCarrito, FILAS_POR_PAGINA, filaTurno, leerAnulacion, leerCarrito, leerCarritosAbiertos, MAX_DOCS_RESUMEN, misCarritos, paginar, resumirTurnoAgregado, resumirCarrito, cerrarTurno, cerrarTurnoForzado, cobrarCredito, confirmarVenta, csvMovimientosCaja, csvVentas, MAX_FILAS_CSV, recortarExportacion,
  guardarConfigPos, leerConfigPos, leerTurno, proyectarTurno, registrarMovimientoCaja, resolverAprobacion, solicitarAnulacion, solicitarAprobacion,
  type AgregadoVentasMoneda, type Carrito, type CobroCreditoEntrada, type MovimientoCaja, type MovimientoCajaEntrada, type SolicitudAprobacion, type VentaPos,
} from '@novutienda/pos';
import { leerCotizacionDe, mercadosDe, SinCotizacionUtilizable, tieneTipoCambio, type CopiaCotizacion } from '@novutienda/nucleo';
import { accion, actorPos, type TablaImplementaciones } from './marco.js';
import { LIMITE, MS, OBJETO, UID, UUID, VACIO, objeto, validarRango, TEXTO } from './comunes.js';


const ruta = (t: string, col: string, id?: string): string => `tenants/${t}/${col}${id === undefined ? '' : `/${id}`}`;
const datosDe = (d: { data(): unknown }): Record<string, unknown> => d.data() as Record<string, unknown>;

export const accionesPos: TablaImplementaciones = {
  // ---- Turno ------------------------------------------------------------------------------------------------
  abrirTurno: accion({
    esquema: objeto({ turnoId: UUID, apertura: OBJETO }),
    ejecutar: async (c, d) => abrirTurno(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.apertura),
  }),
  cerrarTurno: accion({
    esquema: objeto({ turnoId: UUID, contado: OBJETO }),
    ejecutar: async (c, d) => cerrarTurno(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.contado),
  }),
  cerrarTurnoForzado: accion({
    esquema: objeto({ turnoId: UUID, contado: OBJETO, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => cerrarTurnoForzado(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.turnoId, d.contado, d.motivo),
  }),

  // ---- Venta ------------------------------------------------------------------------------------------------
  confirmarVenta: accion({
    maxCaracteres: 128_000,
    esquema: objeto({
      requestId: UUID,
      carrito: OBJETO,
      pagos: z.array(OBJETO).min(1).max(10),
      aprobacionId: UUID.optional(),
      aprobacionCreditoId: UUID.optional(),
      // Cobro de un carrito guardado: los dos campos van juntos.
      carritoId: UUID.optional(),
      carritoVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    }).refine((d) => (d.carritoId === undefined) === (d.carritoVersion === undefined), 'carritoId y carritoVersion van juntos'),
    ejecutar: async (c, d) =>
      confirmarVenta(
        await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.carrito as unknown as Carrito, d.pagos, d.aprobacionId, d.aprobacionCreditoId,
        d.carritoId !== undefined && d.carritoVersion !== undefined ? { carritoId: d.carritoId, carritoVersion: d.carritoVersion } : undefined,
      ),
  }),

  // ---- Carritos guardados (en espera) --------------------------------------------------------------------------
  crearCarrito: accion({
    esquema: objeto({ carritoId: UUID, etiqueta: TEXTO(40).optional() }),
    ejecutar: async (c, d) => ({ carrito: await crearCarrito(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.carritoId, d.etiqueta) }),
  }),
  guardarCarrito: accion({
    maxCaracteres: 64_000,
    esquema: objeto({ carritoId: UUID, version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), contenido: OBJETO.optional(), etiqueta: TEXTO(40).optional() }),
    ejecutar: async (c, d) =>
      ({ carrito: await guardarCarrito(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.carritoId, d.version, { contenido: d.contenido, etiqueta: d.etiqueta }) }),
  }),
  cancelarCarrito: accion({
    esquema: objeto({ carritoId: UUID, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => ({ carrito: await cancelarCarrito(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.carritoId, d.motivo) }),
  }),
  /** Carritos abiertos del turno propio, con su contenido. */
  misCarritos: accion({
    esquema: VACIO,
    ejecutar: async (c) => misCarritos(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c)),
  }),

  // ---- Aprobaciones y anulaciones --------------------------------------------------------------------------
  solicitarAprobacion: accion({
    esquema: objeto({ aprobacionId: UUID, solicitud: OBJETO }),
    ejecutar: async (c, d) => solicitarAprobacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.aprobacionId, d.solicitud as unknown as SolicitudAprobacion),
  }),
  resolverAprobacion: accion({
    esquema: objeto({ aprobacionId: UUID, decision: z.enum(['aprobar', 'rechazar']), motivo: z.string().max(200).optional() }),
    ejecutar: async (c, d) => resolverAprobacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.aprobacionId, d.decision, d.motivo),
  }),
  solicitarAnulacion: accion({
    esquema: objeto({ ventaId: UUID, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => solicitarAnulacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.ventaId, d.motivo),
  }),
  aprobarAnulacion: accion({
    esquema: objeto({ ventaId: UUID, motivo: TEXTO(200) }),
    ejecutar: async (c, d) => aprobarAnulacion(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.ventaId, d.motivo),
  }),

  // ---- Caja y créditos --------------------------------------------------------------------------------------
  registrarMovimientoCaja: accion({
    esquema: objeto({ requestId: UUID, movimiento: OBJETO }),
    ejecutar: async (c, d) =>
      registrarMovimientoCaja(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.movimiento as unknown as MovimientoCajaEntrada),
  }),
  cobrarCredito: accion({
    esquema: objeto({ requestId: UUID, ventaId: UUID, cobro: OBJETO }),
    ejecutar: async (c, d) => cobrarCredito(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.requestId, d.ventaId, d.cobro as unknown as CobroCreditoEntrada),
  }),

  // ---- Configuración ----------------------------------------------------------------------------------------
  leerConfig: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      return { config: await c.e.db.runTransaction((tx) => leerConfigPos(tx, c.tenantId, comercial)) };
    },
  }),
  guardarConfig: accion({
    esquema: objeto({ config: OBJETO }),
    ejecutar: async (c, d) => ({ config: await guardarConfigPos(await c.e.depsPos(c.tenantId), c.tenantId, actorPos(c), d.config) }),
  }),

  // ---- Lecturas «solo lo mío» -------------------------------------------------------------------------------
  /** Turno abierto. El vendedor ve el suyo; si la caja la tiene otro, solo se le dice que está ocupada. */
  miTurno: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const activo = (await c.e.firestore.doc(ruta(c.tenantId, 'pos_config', 'turno_activo')).get()).data();
      if (activo === undefined) return { turno: null, cajaOcupada: false };
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', String(activo['turnoId']))).get()).data();
      if (turno === undefined) return { turno: null, cajaOcupada: false };
      if (c.rol === 'caj' && turno['cajeroUid'] !== c.sesion.uid) return { turno: null, cajaOcupada: true };
      const { monedas } = await c.e.comercialDelTenant(c.tenantId);
      // Lectura validada: una clave que no sea una moneda ISO de tres letras nunca llega a la respuesta.
      const valido = leerTurno(turno, monedas);
      return { turno: { ...turno, apertura: valido.apertura, totales: valido.totales }, cajaOcupada: false, proyeccion: proyectarTurno(valido, monedas) };
    },
  }),
  /**
   * Ventas: el vendedor solo las suyas; `sup`/`adm` todas (o solo las suyas con `soloMias`). Paginadas por cursor
   * `despuesDe {creadoEnMs, ventaId}`: la respuesta trae `siguiente` (o `null` si no hay más).
   * Índices: los de `ventas` ya existentes (cajeroUid/turnoId + creadoEnMs desc); el cursor usa el orden implícito por id.
   */
  misVentas: accion({
    esquema: objeto({
      turnoId: UUID.optional(), desde: MS.optional(), hasta: MS.optional(), limite: LIMITE.optional(), soloMias: z.boolean().optional(),
      despuesDe: objeto({ creadoEnMs: MS, ventaId: UUID }).optional(),
    }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      const limite = d.limite ?? FILAS_POR_PAGINA;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'ventas')).orderBy('creadoEnMs', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (c.rol === 'caj' || d.soloMias === true) q = q.where('cajeroUid', '==', c.sesion.uid);
      if (d.turnoId !== undefined) q = q.where('turnoId', '==', d.turnoId);
      if (d.desde !== undefined) q = q.where('creadoEnMs', '>=', d.desde);
      if (d.hasta !== undefined) q = q.where('creadoEnMs', '<=', d.hasta);
      if (d.despuesDe !== undefined) q = q.startAfter(d.despuesDe.creadoEnMs, d.despuesDe.ventaId);
      const snap = await q.limit(limite + 1).get();
      const { filas, siguiente } = paginar(snap.docs.map(datosDe), limite, (v) => ({ creadoEnMs: Number(v['creadoEnMs']), ventaId: String(v['ventaId']) }));
      return { ventas: filas, siguiente };
    },
  }),
  /**
   * Resumen de un turno (en vivo si está abierto). Sin `turnoId`, el turno abierto; si no hay, `{ resumen: null }`.
   * El vendedor solo pide los suyos; con `cajeroUid` (sup/adm), solo si el turno es de ese cajero. Las ventas se cuentan y suman con agregaciones de Firestore (no se leen documentos), por moneda;
   * las anulaciones (`turnoIdReembolso ==`) se leen, hasta `MAX_DOCS_RESUMEN`, con `truncado`.
   * Índices (ventas): ver docs/produccion/funciones.md.
   */
  resumenTurno: accion({
    esquema: objeto({ turnoId: UUID.optional(), cajeroUid: UID.optional() }),
    ejecutar: async (c, d) => {
      let turnoId = d.turnoId;
      if (turnoId === undefined) {
        const activo = (await c.e.firestore.doc(ruta(c.tenantId, 'pos_config', 'turno_activo')).get()).data();
        if (activo === undefined) return { resumen: null };
        turnoId = String(activo['turnoId']);
      }
      const doc = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', turnoId)).get()).data();
      if (doc === undefined) {
        if (d.turnoId === undefined) return { resumen: null };
        throw new HttpsError('not-found', 'El turno no existe.');
      }
      // `cajeroUid`: «Mi reporte» de sup/adm pide solo lo propio; un turno de otro cajero se trata como el ajeno del vendedor.
      if ((c.rol === 'caj' && doc['cajeroUid'] !== c.sesion.uid) || (d.cajeroUid !== undefined && doc['cajeroUid'] !== d.cajeroUid)) {
        if (d.turnoId === undefined) return { resumen: null };
        throw new HttpsError('permission-denied', 'Solo puede ver sus propios turnos.');
      }
      const { monedas } = await c.e.comercialDelTenant(c.tenantId);
      const turno = leerTurno(doc, monedas);
      const ventasDe = c.e.firestore.collection(ruta(c.tenantId, 'ventas')).where('turnoId', '==', turnoId);
      // Ventas por agregación (sin leer documentos): una consulta por moneda y estado. Las monedas posibles son las del comercio y las del turno.
      const monedasTurno = [...new Set([...monedas, ...Object.keys(turno.totales)])];
      const [agregados, an] = await Promise.all([
        Promise.all(monedasTurno.map(async (m): Promise<[string, AgregadoVentasMoneda]> => {
          const deMoneda = ventasDe.where('moneda', '==', m);
          const [conf, desc, anul] = await Promise.all([
            deMoneda.where('estado', '==', 'confirmada').aggregate({ n: AggregateField.count(), subtotal: AggregateField.sum('subtotal'), total: AggregateField.sum('total') }).get(),
            deMoneda.where('estado', '==', 'confirmada').where('descuento.monto', '>', 0).aggregate({ n: AggregateField.count() }).get(),
            deMoneda.where('estado', '==', 'anulada').aggregate({ n: AggregateField.count(), total: AggregateField.sum('total') }).get(),
          ]);
          const k = conf.data();
          const x = anul.data();
          return [m, { confirmadas: { cantidad: k.n, subtotal: k.subtotal, total: k.total }, conDescuento: desc.data().n, anuladas: { cantidad: x.n, total: x.total } }];
        })),
        c.e.firestore.collection(ruta(c.tenantId, 'anulaciones')).where('turnoIdReembolso', '==', turnoId).limit(MAX_DOCS_RESUMEN + 1).get(),
      ]);
      const truncado = an.size > MAX_DOCS_RESUMEN;
      const anulaciones = an.docs.slice(0, MAX_DOCS_RESUMEN).map((x) => leerAnulacion(datosDe(x)));
      return { resumen: resumirTurnoAgregado(turno, Object.fromEntries(agregados), anulaciones, truncado, monedas) };
    },
  }),
  /**
   * Turnos del vendedor con sus totales (`sup`/`adm`: todos, o los de `cajeroUid`), del más reciente al más antiguo, paginados por cursor
   * `despuesDe {abiertoEnMs, turnoId}`; la respuesta trae `siguiente` (o `null`). Índice nuevo: `turnos(cajeroUid ASC, abiertoEnMs DESC)`.
   */
  misTurnos: accion({
    esquema: objeto({
      desde: MS.optional(), hasta: MS.optional(), limite: z.number().int().min(1).max(FILAS_POR_PAGINA).optional(), cajeroUid: UID.optional(),
      despuesDe: objeto({ abiertoEnMs: MS, turnoId: UUID }).optional(),
    }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      if (c.rol === 'caj' && d.cajeroUid !== undefined && d.cajeroUid !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver sus propios turnos.');
      const limite = d.limite ?? FILAS_POR_PAGINA;
      const cajero = c.rol === 'caj' ? c.sesion.uid : d.cajeroUid;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'turnos')).orderBy('abiertoEnMs', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (cajero !== undefined) q = q.where('cajeroUid', '==', cajero);
      if (d.desde !== undefined) q = q.where('abiertoEnMs', '>=', d.desde);
      if (d.hasta !== undefined) q = q.where('abiertoEnMs', '<=', d.hasta);
      if (d.despuesDe !== undefined) q = q.startAfter(d.despuesDe.abiertoEnMs, d.despuesDe.turnoId);
      const snap = await q.limit(limite + 1).get();
      const { monedas } = await c.e.comercialDelTenant(c.tenantId);
      const { filas, siguiente } = paginar(snap.docs.map((x) => leerTurno(datosDe(x), monedas)), limite, (t) => ({ abiertoEnMs: t.abiertoEnMs, turnoId: t.turnoId }));
      return { turnos: filas.map(filaTurno), siguiente };
    },
  }),
  venta: accion({
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
    esquema: objeto({ aprobacionId: UUID }),
    ejecutar: async (c, d) => {
      const a = (await c.e.firestore.doc(ruta(c.tenantId, 'aprobaciones_descuento', d.aprobacionId)).get()).data();
      if (a === undefined) throw new HttpsError('not-found', 'La solicitud no existe.');
      if (c.rol === 'caj' && a['solicitadoPor'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver sus propias solicitudes.');
      return { aprobacion: a };
    },
  }),
  movimientosCaja: accion({
    esquema: objeto({ turnoId: UUID, limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', d.turnoId)).get()).data();
      if (turno === undefined) throw new HttpsError('not-found', 'El turno no existe.');
      if (c.rol === 'caj' && turno['cajeroUid'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver los movimientos de su turno.');
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'movimientos_caja')).where('turnoId', '==', d.turnoId).orderBy('creadoEnMs', 'desc').limit(d.limite ?? 100).get();
      return { movimientos: snap.docs.map(datosDe) };
    },
  }),
  /**
   * Créditos (estados `pendiente`, `cobrado` y `anulado`). `sup`/`adm` ven todos; el vendedor solo los de SUS ventas:
   * el crédito guarda `cajeroUid` y se consulta por él (índices `cajeroUid` + `creadoEnMs` y `cajeroUid` + `estado`
   * + `creadoEnMs`), sin el tope de ventas recientes.
   */
  creditos: accion({
    esquema: objeto({ estado: z.enum(['pendiente', 'cobrado', 'anulado']).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const limite = d.limite ?? 100;
      let q = c.e.firestore.collection(ruta(c.tenantId, 'creditos')).orderBy('creadoEnMs', 'desc');
      if (c.rol === 'caj') q = q.where('cajeroUid', '==', c.sesion.uid);
      if (d.estado !== undefined) q = q.where('estado', '==', d.estado);
      const snap = await q.limit(limite).get();
      return { creditos: snap.docs.map(datosDe) };
    },
  }),
  /**
   * Cotizaciones vigentes de los mercados declarados (`null` si no hay una utilizable o el mercado no tiene tipo de cambio) y la política de redondeo del tenant,
   * para que el POS calcule el precio final con la misma regla que el servidor. No devuelve nada sensible.
   */
  cotizaciones: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const comercial = await c.e.comercialDelTenant(c.tenantId);
      const cotizaciones: Record<string, CopiaCotizacion<string> | null> = {};
      for (const m of mercadosDe(comercial)) {
        cotizaciones[m] = null;
        if (!tieneTipoCambio(comercial, m)) continue;
        try {
          cotizaciones[m] = await leerCotizacionDe(c.e.almacenCotizaciones, m, c.e.ahora(), { tenantId: c.tenantId, comercial });
        } catch (error) {
          if (!(error instanceof SinCotizacionUtilizable)) throw error;
        }
      }
      return { cotizaciones, redondeo: await c.e.redondeoDelTenant(c.tenantId) };
    },
  }),

  // ---- Supervisión ------------------------------------------------------------------------------------------
  /** Supervisión de caja en vivo: turno abierto, proyección del efectivo esperado y últimas ventas. */
  supervision: accion({
    esquema: VACIO,
    ejecutar: async (c) => {
      const activo = (await c.e.firestore.doc(ruta(c.tenantId, 'pos_config', 'turno_activo')).get()).data();
      if (activo === undefined) return { turno: null };
      const turnoId = String(activo['turnoId']);
      const turno = (await c.e.firestore.doc(ruta(c.tenantId, 'turnos', turnoId)).get()).data();
      if (turno === undefined) return { turno: null };
      const ventas = await c.e.firestore.collection(ruta(c.tenantId, 'ventas')).where('turnoId', '==', turnoId).orderBy('creadoEnMs', 'desc').limit(20).get();
      const { monedas } = await c.e.comercialDelTenant(c.tenantId);
      const valido = leerTurno(turno, monedas);
      // Carritos abiertos del turno (resumen sin cliente, teléfono ni series), por el índice del turno.
      const ahora = c.e.ahora();
      const carritos = [];
      for (const id of leerCarritosAbiertos(turno) ?? []) {
        const doc = (await c.e.firestore.doc(ruta(c.tenantId, 'carritos', id)).get()).data();
        if (doc === undefined) continue;
        const carrito = leerCarrito(doc);
        if (carrito.estado === 'abierto') carritos.push(resumirCarrito(carrito, ahora));
      }
      return {
        turno: { ...turno, apertura: valido.apertura, totales: valido.totales },
        proyeccion: proyectarTurno(valido, monedas),
        ultimasVentas: ventas.docs.map(datosDe),
        carritos,
      };
    },
  }),
  turnos: accion({
    esquema: objeto({ limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'turnos')).orderBy('abiertoEnMs', 'desc').limit(d.limite ?? 30).get();
      return { turnos: snap.docs.map(datosDe) };
    },
  }),

  // ---- Exportaciones (CSV con celdas neutralizadas por el módulo) -------------------------------------------
  exportarVentasCsv: accion({
    esquema: objeto({ desde: MS, hasta: MS }),
    ejecutar: async (c, d) => {
      validarRango(d.desde, d.hasta);
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'ventas')).where('creadoEnMs', '>=', d.desde).where('creadoEnMs', '<=', d.hasta).orderBy('creadoEnMs', 'asc').limit(MAX_FILAS_CSV + 1).get();
      // Si hay más filas que el tope, el CSV lleva las primeras y la respuesta lo avisa con `truncado`.
      const { filas, truncado } = recortarExportacion(snap.docs.map(datosDe));
      return { csv: csvVentas(filas as unknown as VentaPos[]), truncado };
    },
  }),
  exportarMovimientosCajaCsv: accion({
    esquema: objeto({ turnoId: UUID }),
    ejecutar: async (c, d) => {
      const snap = await c.e.firestore.collection(ruta(c.tenantId, 'movimientos_caja')).where('turnoId', '==', d.turnoId).orderBy('creadoEnMs', 'asc').limit(MAX_FILAS_CSV + 1).get();
      const { filas, truncado } = recortarExportacion(snap.docs.map(datosDe));
      return { csv: csvMovimientosCaja(filas as unknown as MovimientoCaja[]), truncado };
    },
  }),
};
