import { ErrorApi } from '../api/errores.js';
import { rolesDeAccion, type Modulo } from '../api/real.js';
import type { Sobre, Transporte } from '../api/transporte.js';
import { ID_NEGOCIO, type ProductoPanel, type Rol } from '../api/tipos.js';
import { esReglaRedondeoValida, type RedondeoPorMoneda } from '@novutienda/nucleo';
import { auditar, fechaLaPaz, fallo, marcaDoble, type Contexto } from './estado.js';
import { exportarTotalDoble } from './inventario/exportacion-total.js';
import { handlersInventario } from './inventario/inventario.js';
import { handlersOtros } from './otros.js';
import { carritosDeSupervision, handlersPos } from './pos/pos.js';

type Obj = Record<string, unknown>;
type Legado = (c: Contexto, e: never) => unknown;
type WireHandler = (c: Contexto, d: Obj) => unknown | Promise<unknown>;

const LEGADO = { ...handlersPos, ...handlersInventario, ...handlersOtros } as unknown as Record<string, Legado>;
const legado = (c: Contexto, nombre: string, entrada: object): Promise<unknown> => Promise.resolve((LEGADO[nombre] as Legado)(c, entrada as never));

/** Monedas de venta del comercio, en el orden de sus mercados y sin repetir. */
const monedasDeVenta = (c: Contexto): string[] => [...new Set(c.e.comercial.mercados.map((m) => m.monedaVenta))];
/** Acciones que solo ejecuta el operador de NovuTienda (propietario), sea cual sea el rol de la sesión en el comercio. */
const SOLO_OPERADOR: ReadonlySet<string> = new Set(['consola.cambiarRedondeo']);

/** Misma acción y mismos datos que la operación del doble. */
const igual = (nombre: string): WireHandler => (c, d) => legado(c, nombre, d);
/** Operación del doble cuya respuesta real es `{ ok: true }`. */
const ok = (nombre: string, datos: (d: Obj) => object = (d) => d): WireHandler => async (c, d) => {
  await legado(c, nombre, datos(d));
  return { ok: true };
};
const msAFecha = (ms: unknown): string => fechaLaPaz(Number(ms));
const sin = (o: Obj, ...claves: string[]): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !claves.includes(k)));
const lim = <T>(x: T[], d: Obj, por = 50): T[] => x.slice(0, typeof d['limite'] === 'number' ? d['limite'] : por);

/** El servidor real nunca entrega costos en `listarProductos` y da el precio como `precioCentavosUSD`. */
function productoReal(p: ProductoPanel): Obj {
  const { costoUSD: _costo, precioUSD, ...resto } = p;
  void _costo;
  return { ...resto, precioCentavosUSD: precioUSD };
}

/**
 * Acciones reales atendidas por el doble: nombre `modulo.accion` → entrada y salida con la forma del servidor
 * (docs/produccion/funciones.md §3).
 */
const ACCIONES: Readonly<Record<string, WireHandler>> = {
  // pos
  'pos.abrirTurno': igual('abrirTurno'), 'pos.cerrarTurno': igual('cerrarTurno'), 'pos.cerrarTurnoForzado': igual('cerrarTurnoForzado'),
  'pos.confirmarVenta': igual('confirmarVenta'), 'pos.solicitarAprobacion': igual('solicitarAprobacion'), 'pos.resolverAprobacion': igual('resolverAprobacion'),
  'pos.crearCarrito': async (c, d) => ({ carrito: await legado(c, 'crearCarrito', d) }),
  'pos.guardarCarrito': async (c, d) => ({ carrito: await legado(c, 'guardarCarrito', d) }),
  'pos.cancelarCarrito': async (c, d) => ({ carrito: await legado(c, 'cancelarCarrito', d) }),
  // Misma forma que el servidor (turno abierto, o `turno: null`); aquí solo los carritos, que es lo que cambió.
  'pos.supervision': (c) => {
    const abierto = [...c.e.turnos.values()].find((t) => t.estado === 'abierto');
    return abierto === undefined ? { turno: null } : { turno: abierto, carritos: carritosDeSupervision(c) };
  },
  'pos.misCarritos': async (c) => ({ carritos: await legado(c, 'misCarritos', {}) }),
  'pos.solicitarAnulacion': igual('solicitarAnulacion'), 'pos.aprobarAnulacion': igual('aprobarAnulacion'),
  'pos.registrarMovimientoCaja': igual('registrarMovimientoCaja'), 'pos.cobrarCredito': igual('cobrarCredito'),
  'pos.leerConfig': async (c) => ({ config: await legado(c, 'leerConfigPos', {}) }),
  'pos.guardarConfig': async (c, d) => ({ config: await legado(c, 'guardarConfigPos', d) }),
  // El servidor devuelve el turno del vendedor; si la caja la tiene otra persona, solo `cajaOcupada`.
  'pos.miTurno': async (c) => {
    const abierto = [...c.e.turnos.values()].find((t) => t.estado === 'abierto');
    const turno = await legado(c, 'turnoActual', {});
    return { turno: turno ?? null, cajaOcupada: turno === null && abierto !== undefined };
  },
  'pos.misVentas': (c, d) =>
    legado(c, 'misVentas', {
      ...(d['turnoId'] !== undefined ? { turnoId: d['turnoId'] } : {}),
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}),
      ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
      ...(d['despuesDe'] !== undefined ? { despuesDe: d['despuesDe'] } : {}),
    }),
  'pos.resumenTurno': async (c, d) => ({ resumen: await legado(c, 'resumenTurno', { ...(d['turnoId'] !== undefined ? { turnoId: d['turnoId'] } : {}), ...(d['cajeroUid'] !== undefined ? { cajeroUid: d['cajeroUid'] } : {}) }) }),
  'pos.misTurnos': (c, d) =>
    legado(c, 'misTurnos', {
      ...(d['cajeroUid'] !== undefined ? { cajeroUid: d['cajeroUid'] } : {}),
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}),
      ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
      ...(d['despuesDe'] !== undefined ? { despuesDe: d['despuesDe'] } : {}),
    }),
  // Sin `estado`, el servidor devuelve solo las pendientes.
  'pos.aprobaciones': async (c, d) => ({ aprobaciones: lim((await legado(c, 'listarAprobaciones', { estado: d['estado'] ?? 'pendiente' })) as Obj[], d) }),
  'pos.movimientosCaja': async (c, d) => ({ movimientos: lim((await legado(c, 'listarMovimientosCaja', { turnoId: d['turnoId'] })) as Obj[], d, 100) }),
  'pos.creditos': async (c, d) => ({ creditos: lim((await legado(c, 'listarCreditos', d['estado'] === undefined ? {} : { estado: d['estado'] })) as Obj[], d, 100) }),
  'pos.turnos': async (c, d) => ({ turnos: lim((await legado(c, 'listarTurnos', {})) as Obj[], d, 30) }),
  'pos.cotizaciones': (c) => ({ cotizaciones: c.e.cotizaciones, redondeo: c.e.redondeo }),
  // inventarios
  'inventarios.ingresar': igual('ingresar'), 'inventarios.traspasar': igual('traspasar'), 'inventarios.ajustar': igual('ajustar'),
  'inventarios.solicitarMerma': igual('solicitarMerma'), 'inventarios.resolverMerma': igual('resolverMerma'), 'inventarios.abrirConteo': igual('abrirConteo'),
  'inventarios.registrarLineaConteo': igual('registrarLineaConteo'), 'inventarios.cerrarConteo': igual('cerrarConteo'), 'inventarios.cancelarConteo': igual('cancelarConteo'),
  // Una sola acción real: con `simular: true` devuelve la simulación; sin ella, el resultado por tandas.
  'inventarios.importarProductosCsv': async (c, d) => {
    const { simular, ...resto } = d;
    return simular === true
      ? { simular: true, simulacion: await legado(c, 'simularImportacionProductos', resto) }
      : { simular: false, ...((await legado(c, 'importarProductosCsv', resto)) as Obj) };
  },
  'inventarios.crearProducto': igual('crearProducto'),
  'inventarios.editarProducto': igual('actualizarProducto'),
  'inventarios.cambiarPrecioUSD': (c, d) => legado(c, 'actualizarProducto', { operacionId: d['operacionId'], productoId: d['productoId'], cambios: { precioUSD: d['precioUSD'] } }),
  'inventarios.listarProductos': async (c, d) => {
    const marca = marcaDoble(c);
    // Como el servidor: con existencias ocultas, filtrar por «bajo el mínimo» revelaría qué productos lo están.
    if (marca !== undefined && d['soloBajoMinimo'] === true) throw fallo('existencias-ocultas', 'El filtro «bajo el mínimo» no está disponible mientras hay un conteo abierto.', { ...marca });
    // `listarProductos` del doble ya aplica el rol (y quita costos `productoReal`).
    const ps = (await legado(c, 'listarProductos', {})) as ProductoPanel[];
    return { productos: ps.filter((p) => d['soloBajoMinimo'] !== true || p.bajoMinimo).map(productoReal), ...marca };
  },
  'inventarios.costos': async (c) => ({
    costos: ((await legado({ ...c, rol: 'adm' }, 'listarProductos', {})) as ProductoPanel[]).map((p) => ({ productoId: p.id, costoUSD: p.costoUSD })),
  }),
  'inventarios.buscarSerie': async (c, d) => ({ unidades: await legado(c, 'buscarSerie', { serie: d['serie'], ...(d['porInicio'] === true ? { porInicio: true } : {}) }) }),
  'inventarios.series': async (c, d) => ({ unidades: [...((await legado(c, 'listarSeries', d)) as unknown[])], ...marcaDoble(c) }),
  'inventarios.movimientos': async (c, d) => {
    const lista = (await legado(c, 'listarMovimientos', {
      ...(d['productoId'] !== undefined ? { productoId: d['productoId'] } : {}),
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}),
      ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
      ...(d['tipo'] !== undefined ? { tipo: d['tipo'] } : {}),
      ...(d['uid'] !== undefined ? { usuario: d['uid'] } : {}),
      limite: d['limite'] ?? 100,
    })) as { movimientos: Obj[]; cortada: boolean; existenciasOcultas?: true; conteosAbiertos?: unknown };
    // Forma del documento real: sin `id`, con `referencia` como objeto.
    return { cortada: lista.cortada, ...marcaDoble(c), movimientos: lista.movimientos.map((x) => ({ ...sin(x, 'id', 'referencia'), ...(typeof x['referencia'] === 'string' ? { referencia: { tipo: x['referencia'].split(':')[0], id: x['referencia'].split(':')[1] } } : {}) })) };
  },
  'inventarios.mermas': async (c, d) => {
    const lista = (await legado(c, 'listarMermas', d['estado'] === undefined ? {} : { estado: d['estado'] })) as { mermas: Obj[]; cortada: boolean };
    return {
      cortada: lista.cortada,
      mermas: lista.mermas.map(({ mermaId, motivoResolucion, fecha, ...r }) => ({
        id: mermaId, ...r, ...(motivoResolucion !== undefined ? { resolucionMotivo: motivoResolucion } : {}), solicitadaEn: fecha,
      })),
    };
  },
  'inventarios.conteos': async (c, d) => ({
    conteos: lim((await legado(c, 'listarConteos', {})) as Obj[], d).map((k) => ({ id: k['conteoId'], ...sin(k, 'conteoId', 'lineas', 'resultado', 'fecha', 'productos', 'motivoCancelacion'), ...(k['motivoCancelacion'] !== undefined ? { motivo: k['motivoCancelacion'] } : {}), abiertoEn: k['fecha'] })),
  }),
  'inventarios.conteo': async (c, d) => {
    const k = ((await legado(c, 'listarConteos', {})) as Obj[]).find((x) => x['conteoId'] === d['conteoId']);
    if (k === undefined) throw fallo('no-encontrado', 'El conteo no existe');
    const { lineas, conteoId, resultado, productos, motivoCancelacion, ...r } = k;
    // `resultado` (teórico, contado, diferencia) solo llega a sup/adm y con el conteo cerrado (el doble ya lo filtra).
    return { conteo: { id: conteoId, ...r, ...(motivoCancelacion !== undefined ? { motivo: motivoCancelacion } : {}) }, lineas, ...(resultado !== undefined ? { resultado } : {}), ...(productos !== undefined ? { productos } : {}) };
  },
  'inventarios.exportarCsv': (c, d) => legado({ ...c, rol: d['conCostos'] === true ? 'adm' : 'sup' }, 'exportarProductosCsv', {}),
  // Descarga total: las mismas cinco hojas que arma el servidor, con el estado del doble (`inventario/exportacion-total.ts`).
  'inventarios.exportarTotal': (c) => exportarTotalDoble(c),
  // recibos
  'recibos.buscarComprobantes': async (c, d) => ({ recibos: await legado(c, 'buscarComprobantes', { consulta: d }) }),
  'recibos.leerRecibo': (c, d) => {
    const r = c.e.recibos.get(String(d['reciboId']));
    const venta = r === undefined ? undefined : c.e.ventas.get(r.ventaId);
    if (r === undefined) throw fallo('recibo-no-encontrado', 'El comprobante no existe.');
    if (c.rol === 'caj' && venta?.cajeroUid !== c.uid) throw fallo('no-autorizado', 'Solo puede ver los comprobantes de sus ventas.');
    return { recibo: r };
  },
  'recibos.enviarRecibo': igual('enviarRecibo'),
  'recibos.referenciarFacturaSuma': ok('referenciarFacturaSuma'),
  'recibos.guardarPlantilla': ok('guardarPlantilla'),
  'recibos.leerPlantilla': async (c) => ({ plantilla: await legado(c, 'leerPlantilla', {}) }),
  // consola
  'consola.tablero': igual('obtenerTablero'),
  'consola.publicarSitio': igual('publicarSitio'),
  'consola.guardarFicha': async (c, d) => {
    await legado(c, 'guardarFicha', d);
    return { productoId: d['productoId'] };
  },
  'consola.guardarSeccion': ok('guardarSeccion'), 'consola.eliminarSeccion': ok('eliminarSeccion'), 'consola.ordenarSecciones': ok('ordenarSecciones'),
  'consola.guardarCarrusel': ok('guardarCarrusel'), 'consola.guardarConfigSitio': ok('guardarConfigSitio'),
  'consola.listarUsuarios': async (c) => ({
    usuarios: ((await legado(c, 'listarUsuarios', {})) as Obj[]).map((u) =>
      u['estado'] === 'invitado'
        ? { uid: u['uid'], estado: 'invitado', rolReservado: u['rol'], venceEnMs: u['venceEnMs'], correo: u['correo'] }
        : { uid: u['uid'], rol: u['rol'], correo: u['correo'], correoVerificado: u['verificado'], deshabilitado: false },
    ),
  }),
  'consola.modulosActivos': async (c) => ({ modulos: (await legado(c, 'modulosActivos', {})) as string[] }),
  'consola.configuracionComercial': (c) => legado(c, 'configuracionComercial', {}),
  'consola.verTipoCambio': async (c) => ({ mercados: await legado(c, 'verTipoCambio', {}) }),
  'consola.cotizacionManual': ok('cotizacionManual'),
  'consola.quitarCotizacionManual': ok('quitarCotizacionManual'),
  'consola.verRedondeo': (c) => ({ monedas: monedasDeVenta(c), reglas: c.e.redondeo, puedeEditar: c.e.operador }),
  'consola.cambiarRedondeo': (c, d) => {
    const monedas = monedasDeVenta(c);
    const reglas = (d['reglas'] ?? {}) as Record<string, unknown>;
    const reparando = d['esperadas'] === null;
    const esperadas = (d['esperadas'] ?? {}) as Record<string, unknown>;
    const mismas = (k: string[]): boolean => k.length === monedas.length && monedas.every((m) => k.includes(m));
    if (!mismas(Object.keys(reglas)) || !monedas.every((m) => esReglaRedondeoValida(reglas[m]))) {
      throw fallo('redondeo-regla-invalida', 'Alguna de las reglas de redondeo no es válida.');
    }
    const clave = (r: unknown): string => JSON.stringify(r, Object.keys((r ?? {}) as object).sort());
    if (!reparando && (!mismas(Object.keys(esperadas)) || monedas.some((m) => clave(esperadas[m]) !== clave(c.e.redondeo[m])))) {
      throw fallo('redondeo-conflicto', 'El redondeo cambió mientras se editaba.');
    }
    const cambiadas = monedas.filter((m) => clave(reglas[m]) !== clave(c.e.redondeo[m]));
    if (cambiadas.length === 0) return { estado: 'sin-cambios' };
    const nuevas = Object.fromEntries(monedas.map((m) => [m, reglas[m]])) as RedondeoPorMoneda;
    c.e.redondeo = nuevas;
    auditar(c, 'redondeo.fijar', 'config/redondeo');
    return { estado: 'fijado', cambiadas, reglas: nuevas };
  },
  'consola.asignarRol': async (c, d) => {
    await legado(c, 'asignarRol', d);
    return { claim: {} };
  },
  'consola.quitarRol': async (c, d) => {
    await legado(c, 'quitarRol', d);
    return { claim: {} };
  },
  'consola.invitarUsuario': async (c, d) => legado(c, 'invitarUsuario', d),
  'consola.anularInvitacion': ok('anularInvitacion'),
  'consola.reenviarInvitacion': async (c, d) => legado(c, 'reenviarInvitacion', { ...d, correo: '' }),
  'consola.auditoria': async (c, d) => ({
    entradas: await legado(c, 'listarAuditoria', {
      ...sin(d, 'desde', 'hasta'), ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}), ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
    }),
  }),
  'consola.buscarUsuarioPorCorreo': async (c, d) => legado(c, 'buscarUsuarioPorCorreo', d),
  'pos.exportarVentasCsv': async (c, d) =>
    legado(c, 'exportarVentasCsv', {
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}), ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
    }),
  'consola.fichas': (c) => legado(c, 'listarFichas', {}).then((fichas) => ({ fichas })),
  'consola.secciones': (c) => legado(c, 'listarSecciones', {}).then((secciones) => ({ secciones })),
  'consola.carruseles': (c) => legado(c, 'listarCarruseles', {}).then((carruseles) => ({ carruseles })),
  'consola.leerLogo': (c) => legado(c, 'leerLogo', {}).then((logo) => ({ logo })),
  'consola.quitarLogo': igual('quitarLogo'),
  'consola.leerNegocioSitio': igual('leerNegocioSitio'),
  'consola.guardarNegocioSitio': igual('guardarNegocioSitio'),
  'consola.configSitio': (c) => legado(c, 'leerConfigSitio', {}).then((config) => ({ config })),
  // medios
  'medios.reservarSubida': (c, d) => (d['tipo'] === 'logo'
    ? (d['productoId'] === ID_NEGOCIO ? legado(c, 'reservarSubidaLogo', { subidaId: d['subidaId'], bytes: d['bytes'] }) : Promise.reject(fallo('entrada-invalida', 'productoId inválido')))
    : legado(c, 'reservarSubida', d)),
  'medios.estadoSubida': (c, d) => legado(c, c.e.subidas.get(String(d['subidaId']))?.tipo === 'logo' ? 'estadoSubidaLogo' : 'estadoSubida', d),
  'medios.finalizarSubida': async (c, d) => {
    // El servidor decide por la subida; el doble, por su tipo.
    const logo = c.e.subidas.get(String(d['subidaId']))?.tipo === 'logo';
    return { medio: await legado(c, logo ? 'finalizarSubidaLogo' : 'finalizarSubida', d) };
  },
  'medios.borrarMedio': ok('borrarMedio'),
  'medios.listarMedios': async (c, d) => ({ medios: lim((await legado(c, 'listarMedios', { productoId: d['productoId'] })) as Obj[], d, 20) }),
};

export const ACCIONES_DOBLE: readonly string[] = Object.keys(ACCIONES);

export interface OpcionesTransporteDoble {
  readonly contexto: () => Contexto;
  /** Retraso artificial por llamada, en ms. */
  readonly retrasoMs?: number;
}

/**
 * Servidor doble: atiende `{ accion, tenantId, datos }` por módulo con las reglas del doble en memoria, aplicando los
 * roles REALES de cada acción y devolviendo la forma real de la respuesta. El `details.codigo` es el de las
 * reglas del doble (el servidor real lo envía siempre; ver `api/errores.ts`).
 */
export class TransporteDoble implements Transporte {
  invocaciones: { modulo: Modulo; accion: string; tenantId: string; datos: unknown }[] = [];

  constructor(private readonly o: OpcionesTransporteDoble) {}

  async invocar(modulo: Modulo, sobre: Sobre): Promise<unknown> {
    if (this.o.retrasoMs !== undefined && this.o.retrasoMs > 0) await new Promise((r) => setTimeout(r, this.o.retrasoMs));
    this.invocaciones.push({ modulo, accion: sobre.accion, tenantId: sobre.tenantId, datos: sobre.datos });
    const clave = `${modulo}.${sobre.accion}`;
    const h = Object.hasOwn(ACCIONES, clave) ? ACCIONES[clave] : undefined;
    if (h === undefined) throw new ErrorApi('invalid-argument', 'Acción desconocida.');
    const c = this.o.contexto();
    const roles: readonly Rol[] = rolesDeAccion(clave);
    if (SOLO_OPERADOR.has(clave) ? !c.e.operador : !roles.includes(c.rol)) throw new ErrorApi('permission-denied', 'Su rol no permite esta acción.', { codigo: 'no-autorizado' });
    try {
      // Clon profundo: el servidor nunca comparte objetos con el cliente.
      const r = await h(c, structuredClone(sobre.datos ?? {}) as Obj);
      return structuredClone(r ?? { ok: true });
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
      throw fallo('estado', e instanceof Error ? e.message : 'error');
    }
  }
}
