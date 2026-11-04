import { ErrorApi } from '../api/errores.js';
import { esPropuesta, rolesDeAccion, type Modulo } from '../api/real.js';
import type { Sobre, Transporte } from '../api/transporte.js';
import type { ProductoPanel, Rol } from '../api/tipos.js';
import { fechaLaPaz, fallo, type Contexto } from './estado.js';
import { handlersInventario } from './inventario.js';
import { crearProductoConsola, editarProductoConsola, handlersOtros } from './otros.js';
import { handlersPos } from './pos.js';

type Obj = Record<string, unknown>;
type Legado = (c: Contexto, e: never) => unknown;
type WireHandler = (c: Contexto, d: Obj) => unknown | Promise<unknown>;

const LEGADO = { ...handlersPos, ...handlersInventario, ...handlersOtros } as unknown as Record<string, Legado>;
const legado = (c: Contexto, nombre: string, entrada: object): Promise<unknown> => Promise.resolve((LEGADO[nombre] as Legado)(c, entrada as never));

/** Misma acción y mismos datos que la operación del doble. */
const igual = (nombre: string): WireHandler => (c, d) => legado(c, nombre, d);
/** Operación del doble cuya respuesta real es `{ ok: true }`. */
const ok = (nombre: string, datos: (d: Obj) => object = (d) => d): WireHandler => async (c, d) => {
  await legado(c, nombre, datos(d));
  return { ok: true };
};
/** La consola recibe dólares con hasta 2 decimales (§2 de funciones.md); más decimales se rechazan. */
const centavos = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw fallo('entrada-invalida', 'Precio: hasta 2 decimales');
  return Math.round(n * 100);
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
 * (docs/produccion/funciones.md §3). `PROPUESTAS` está vacía: todas existen en el servidor.
 */
const ACCIONES: Readonly<Record<string, WireHandler>> = {
  // pos
  'pos.abrirTurno': igual('abrirTurno'), 'pos.cerrarTurno': igual('cerrarTurno'), 'pos.cerrarTurnoForzado': igual('cerrarTurnoForzado'),
  'pos.confirmarVenta': igual('confirmarVenta'), 'pos.solicitarAprobacion': igual('solicitarAprobacion'), 'pos.resolverAprobacion': igual('resolverAprobacion'),
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
  'pos.misVentas': async (c, d) => {
    const ventas = (await legado(c, 'listarVentas', {
      ...(d['turnoId'] !== undefined ? { turnoId: d['turnoId'] } : {}),
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}),
      ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
    })) as Obj[];
    return { ventas: lim(ventas, d) };
  },
  // Sin `estado`, el servidor devuelve solo las pendientes.
  'pos.aprobaciones': async (c, d) => ({ aprobaciones: lim((await legado(c, 'listarAprobaciones', { estado: d['estado'] ?? 'pendiente' })) as Obj[], d) }),
  'pos.movimientosCaja': async (c, d) => ({ movimientos: lim((await legado(c, 'listarMovimientosCaja', { turnoId: d['turnoId'] })) as Obj[], d, 100) }),
  'pos.creditos': async (c, d) => ({ creditos: lim((await legado(c, 'listarCreditos', d['estado'] === undefined ? {} : { estado: d['estado'] })) as Obj[], d, 100) }),
  'pos.turnos': async (c, d) => ({ turnos: lim((await legado(c, 'listarTurnos', {})) as Obj[], d, 30) }),
  'pos.cotizaciones': (c) => ({ cotizaciones: c.e.cotizaciones }),
  // inventarios
  'inventarios.ingresar': igual('ingresar'), 'inventarios.traspasar': igual('traspasar'), 'inventarios.ajustar': igual('ajustar'),
  'inventarios.solicitarMerma': igual('solicitarMerma'), 'inventarios.resolverMerma': igual('resolverMerma'), 'inventarios.abrirConteo': igual('abrirConteo'),
  'inventarios.registrarLineaConteo': igual('registrarLineaConteo'), 'inventarios.cerrarConteo': igual('cerrarConteo'),
  'inventarios.importarProductosCsv': igual('importarProductosCsv'),
  'inventarios.fijarCosto': (c, d) => legado(c, 'actualizarProducto', { operacionId: d['operacionId'], productoId: d['productoId'], cambios: { costoUSD: d['costoUSD'] } }),
  'inventarios.listarProductos': async (c, d) => {
    const ps = (await legado({ ...c, rol: 'sup' }, 'listarProductos', {})) as ProductoPanel[];
    return { productos: ps.filter((p) => d['soloBajoMinimo'] !== true || p.bajoMinimo).map(productoReal) };
  },
  'inventarios.costos': async (c) => ({
    costos: ((await legado({ ...c, rol: 'adm' }, 'listarProductos', {})) as ProductoPanel[]).map((p) => ({ productoId: p.id, costoUSD: p.costoUSD })),
  }),
  'inventarios.buscarSerie': async (c, d) => ({ unidades: await legado(c, 'buscarSerie', { serie: d['serie'] }) }),
  'inventarios.series': async (c, d) => ({ unidades: await legado(c, 'listarSeries', d) }),
  'inventarios.movimientos': async (c, d) => {
    const m = (await legado(c, 'listarMovimientos', {
      ...(d['productoId'] !== undefined ? { productoId: d['productoId'] } : {}),
      ...(d['desde'] !== undefined ? { desde: msAFecha(d['desde']) } : {}),
      ...(d['hasta'] !== undefined ? { hasta: msAFecha(d['hasta']) } : {}),
      ...(d['tipo'] !== undefined ? { tipo: d['tipo'] } : {}),
      ...(d['uid'] !== undefined ? { usuario: d['uid'] } : {}),
      limite: d['limite'] ?? 100,
    })) as Obj[];
    // Forma del documento real: sin `id`, con `referencia` como objeto.
    return { movimientos: m.map((x) => ({ ...sin(x, 'id', 'referencia'), ...(typeof x['referencia'] === 'string' ? { referencia: { tipo: x['referencia'].split(':')[0], id: x['referencia'].split(':')[1] } } : {}) })) };
  },
  'inventarios.mermas': async (c, d) => ({
    mermas: ((await legado(c, 'listarMermas', d['estado'] === undefined ? {} : { estado: d['estado'] })) as Obj[]).map(({ mermaId, motivoResolucion, fecha, ...r }) => ({
      id: mermaId, ...r, ...(motivoResolucion !== undefined ? { resolucionMotivo: motivoResolucion } : {}), solicitadaEn: fecha,
    })),
  }),
  'inventarios.conteos': async (c, d) => ({
    conteos: lim((await legado(c, 'listarConteos', {})) as Obj[], d).map((k) => ({ id: k['conteoId'], ...sin(k, 'conteoId', 'lineas', 'resultado', 'fecha'), abiertoEn: k['fecha'] })),
  }),
  'inventarios.conteo': async (c, d) => {
    const k = ((await legado(c, 'listarConteos', {})) as Obj[]).find((x) => x['conteoId'] === d['conteoId']);
    if (k === undefined) throw fallo('no-encontrado', 'El conteo no existe');
    const { lineas, conteoId, resultado, ...r } = k;
    // `resultado` (teórico, contado, diferencia) solo llega a sup/adm y con el conteo cerrado (el doble ya lo filtra).
    return { conteo: { id: conteoId, ...r }, lineas, ...(resultado !== undefined ? { resultado } : {}) };
  },
  'inventarios.exportarCsv': (c, d) => legado({ ...c, rol: d['conCostos'] === true ? 'adm' : 'sup' }, 'exportarProductosCsv', {}),
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
  'consola.crearProducto': async (c, d) => {
    const p = d['precioUSD'] as Obj;
    // Mismo cambio de unidades que el servidor: dólares decimales → centavos de Inventarios.
    crearProductoConsola(c, { ...d, precioUSD: { bo: centavos(p['bo']) / 100, ar: centavos(p['ar']) / 100 } } as never);
    return { productoId: d['productoId'] };
  },
  'consola.editarProducto': async (c, d) => {
    editarProductoConsola(c, d as never);
    return { productoId: d['productoId'] };
  },
  'consola.cambiarPrecioUSD': async (c, d) => {
    const p = d['precioUSD'] as Obj;
    await legado(c, 'cambiarPrecioUSD', { productoId: d['productoId'], precioUSD: { bo: centavos(p['bo']), ar: centavos(p['ar']) } });
    return { productoId: d['productoId'] };
  },
  'consola.guardarFicha': async (c, d) => {
    await legado(c, 'guardarFicha', d);
    return { productoId: d['productoId'] };
  },
  'consola.guardarSeccion': ok('guardarSeccion'), 'consola.eliminarSeccion': ok('eliminarSeccion'), 'consola.ordenarSecciones': ok('ordenarSecciones'),
  'consola.guardarCarrusel': ok('guardarCarrusel'), 'consola.guardarConfigSitio': ok('guardarConfigSitio'),
  'consola.simularImportacion': async (c, d) => ({ simulacion: await legado(c, 'simularImportacion', { contenidoBase64: d['archivo'] }) }),
  'consola.importarProductos': (c, d) => legado(c, 'importarProductos', { contenidoBase64: d['archivo'], ...(d['omitirErrores'] !== undefined ? { omitirErrores: d['omitirErrores'] } : {}) }),
  'consola.exportarProductosCsv': igual('exportarProductosCsvSitio'),
  'consola.listarUsuarios': async (c) => ({
    usuarios: ((await legado(c, 'listarUsuarios', {})) as Obj[]).map((u) => ({ uid: u['uid'], rol: u['rol'], correo: u['correo'], correoVerificado: u['verificado'], deshabilitado: false })),
  }),
  'consola.asignarRol': async (c, d) => {
    await legado(c, 'asignarRol', d);
    return { claim: {} };
  },
  'consola.quitarRol': async (c, d) => {
    await legado(c, 'quitarRol', d);
    return { claim: {} };
  },
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
  'consola.configSitio': (c) => legado(c, 'leerConfigSitio', {}).then((config) => ({ config })),
  // medios
  'medios.reservarSubida': igual('reservarSubida'),
  'medios.finalizarSubida': async (c, d) => ({ medio: await legado(c, 'finalizarSubida', d) }),
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
    if (!roles.includes(c.rol)) throw new ErrorApi('permission-denied', 'Su rol no permite esta acción.', { codigo: 'no-autorizado' });
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

export const esAccionPropuesta = esPropuesta;
