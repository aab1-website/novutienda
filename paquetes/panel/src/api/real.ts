// CONTRATO REAL con el servidor (docs/produccion/funciones.md §2-§3) y su traducción desde las operaciones del panel.
//
// El servidor expone UNA Cloud Function por módulo (`pos`, `inventarios`, `consola`, `recibos`, `medios`) que se llama
// con `{ accion, tenantId, datos }`. Cada operación del panel (`contrato.ts`) se traduce aquí a una o varias acciones
// reales: nombre, forma de `datos` y forma de la respuesta. El cliente real (`firebase.ts`) y el doble en memoria
// (`doble/transporte.ts`) pasan por esta misma traducción.
//
// Unidades: el panel trabaja en centavos. El servidor espera dólares decimales SOLO en las acciones de `consola` que los
// reciben (§2 de funciones.md); en `inventarios` los precios y costos van en centavos de USD. La conversión vive
// únicamente en `usd()` y se usa solo en esas acciones.
//
// Todas las acciones que el panel usa existen en el servidor (`ROLES_ACCION`); lo que falte se pide al dueño de las
// funciones, nunca se inventa en el panel.
import type { Entrada, NombreCallable, Salida } from './contrato.js';
import { ROLES_ACCION } from './acciones.generado.js';
import { ErrorApi } from './errores.js';
import type {
  AprobacionPos, ConteoVista, CotizacionesVigentes, CreditoVista, Medio, MermaVista, MovimientoVista, ProductoPanel,
  Rol, TurnoPos, UbicacionId, UnidadSerie, UsuarioVista, VentaPos,
} from './tipos.js';
import { fijarRedondeo } from '../util/precio.js';

export type Modulo = 'pos' | 'inventarios' | 'consola' | 'recibos' | 'medios';
export type ClaveAccion = `${Modulo}.${string}`;

const TODOS: readonly Rol[] = ['caj', 'sup', 'adm'];

/** Roles de cada acción real: derivados del registro (`pnpm registro:generar`), sin tabla a mano. */
export { ROLES_ACCION };

export const rolesDeAccion = (clave: string): readonly Rol[] => ROLES_ACCION[clave] ?? [];

/** Lo que una traducción necesita para hablar con el servidor. */
export interface ContextoReal {
  /** Una llamada al callable `modulo` con `{ accion, tenantId, datos }`. */
  llamar(modulo: Modulo, accion: string, datos?: object): Promise<unknown>;
  /** Rol de quien llama (solo para elegir entre acciones; el servidor decide el permiso). */
  readonly rol: Rol | undefined;
  /** Espera entre reintentos (inyectable en las pruebas). */
  esperar(ms: number): Promise<void>;
}

export interface Traduccion<N extends NombreCallable> {
  /** Acciones reales que invoca (para roles y pruebas de conformidad). */
  readonly usa: readonly ClaveAccion[];
  /** Roles de la operación del panel si difieren de las acciones que usa. */
  readonly roles?: readonly Rol[];
  ejecutar(c: ContextoReal, e: Entrada<N>): Promise<Salida<N>>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ayudas de traducción
// ---------------------------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const OK = { ok: true } as const;

/** Centavos de USD → dólares decimales, SOLO para las tres acciones de `consola` que los esperan así (§2). */
export const usd = (centavos: number): number => centavos / 100;

/** aaaa-mm-dd (calendario de La Paz, UTC-4) → milisegundos Unix, al inicio o al final del día. */
export function msDeFecha(fecha: string, fin: boolean): number {
  const t = Date.parse(`${fecha}T${fin ? '23:59:59.999' : '00:00:00.000'}-04:00`);
  if (Number.isNaN(t)) throw new ErrorApi('invalid-argument', 'La fecha debe tener la forma aaaa-mm-dd.');
  return t;
}

const quitar = (o: object, ...claves: string[]): Obj => Object.fromEntries(Object.entries(o).filter(([k]) => !claves.includes(k)));
const lista = (r: unknown, clave: string): Obj[] => {
  const v = (r as Obj | null)?.[clave];
  return Array.isArray(v) ? (v as Obj[]) : [];
};
const campo = <T>(r: unknown, clave: string): T => (r as Obj)[clave] as T;
const sinVacios = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Traducción directa: misma acción, mismos `datos`, misma respuesta. */
const directa = <N extends NombreCallable>(modulo: Modulo, accion: string): Traduccion<N> => ({
  usa: [`${modulo}.${accion}`],
  ejecutar: async (c, e) => (await c.llamar(modulo, accion, e as object)) as Salida<N>,
});

/** Acción de escritura de la consola que responde `{ ok: true }` (o `{ productoId }`/`{ claim }`): el panel solo necesita el éxito. */
const comoOk = <N extends NombreCallable>(modulo: Modulo, accion: string, datos: (e: Entrada<N>) => object): Traduccion<N> => ({
  usa: [`${modulo}.${accion}`],
  ejecutar: async (c, e) => {
    await c.llamar(modulo, accion, datos(e));
    return OK as Salida<N>;
  },
});

export const REINTENTOS_FINALIZAR = 8;
export const ESPERA_FINALIZAR_MS = 1500;
/**
 * Espera máxima a que el servidor termine de procesar una subida cuando la llamada se corta por tiempo o por red
 * (un video de 200 MB tarda más de un minuto y el SDK corta las llamadas largas): se reintenta con retroceso.
 */
export const ESPERA_SUBIDA_MAXIMA_MS = 120_000;
export const ESPERA_SUBIDA_TOPE_MS = 8000;

const ESTADOS_APROBACION = ['pendiente', 'aprobada', 'rechazada', 'usada'] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Lecturas con forma distinta a la del panel
// ---------------------------------------------------------------------------------------------------------------------

function aProducto(p: Obj, costos: ReadonlyMap<string, number> | undefined): ProductoPanel {
  const ex = (p['existencias'] ?? {}) as Record<string, number>;
  const existencias = { tienda: ex['tienda'] ?? 0, 'deposito-1': ex['deposito-1'] ?? 0, 'deposito-2': ex['deposito-2'] ?? 0 } as Record<UbicacionId, number>;
  const id = String(p['id']);
  const costo = costos?.get(id);
  return sinVacios({
    id,
    nombre: String(p['nombre']),
    categoria: String(p['categoria'] ?? ''),
    marca: p['marca'] as string | undefined,
    sku: String(p['sku'] ?? id),
    activo: p['activo'] === true,
    publicado: p['publicado'] === true,
    conSerie: p['conSerie'] === true,
    garantiaMeses: p['garantiaMeses'] as number | undefined,
    minimo: p['minimo'] as number | undefined,
    precioUSD: p['precioCentavosUSD'] as ProductoPanel['precioUSD'],
    costoUSD: costo,
    stockTotal: p['stockTotal'] as number | undefined,
    existencias,
    bajoMinimo: p['bajoMinimo'] === true,
    disponible: p['disponible'] === true,
  }) as ProductoPanel;
}

function aMovimiento(m: Obj): MovimientoVista {
  const ref = (m['referencia'] ?? {}) as Obj;
  const referencia = typeof ref['tipo'] === 'string' ? `${ref['tipo']}:${String(ref['id'] ?? '')}` : undefined;
  return sinVacios({
    id: `${String(m['operacionId'])}~${String(m['productoId'])}~${String(m['ubicacionId'])}`,
    operacionId: String(m['operacionId']),
    productoId: String(m['productoId']),
    ubicacionId: m['ubicacionId'] as UbicacionId,
    tipo: m['tipo'] as MovimientoVista['tipo'],
    delta: Number(m['delta']),
    saldoUbicacion: Number(m['saldoUbicacion']),
    series: (m['series'] as string[] | undefined) ?? [],
    referencia,
    por: String(m['por']),
    rol: m['rol'] as Rol,
    fecha: String(m['fecha']),
    motivo: m['motivo'] as string | undefined,
  }) as MovimientoVista;
}

function aMerma(m: Obj): MermaVista {
  return sinVacios({
    mermaId: String(m['id']),
    productoId: String(m['productoId']),
    ubicacionId: m['ubicacionId'] as UbicacionId,
    cantidad: Number(m['cantidad']),
    series: (m['series'] as string[] | undefined) ?? [],
    motivo: String(m['motivo'] ?? ''),
    estado: m['estado'] as MermaVista['estado'],
    solicitadaPor: String(m['solicitadaPor']),
    resueltaPor: m['resueltaPor'] as string | undefined,
    motivoResolucion: m['resolucionMotivo'] as string | undefined,
    fecha: String(m['solicitadaEn'] ?? ''),
  }) as MermaVista;
}

function aMedio(m: Obj): Medio {
  return { ...(quitar(m, 'id') as unknown as Medio), id: String(m['id']) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tabla de traducciones: una por operación del panel
// ---------------------------------------------------------------------------------------------------------------------

export const TRADUCCION: { readonly [N in NombreCallable]: Traduccion<N> } = {
  // ---- POS ----
  abrirTurno: directa('pos', 'abrirTurno'),
  cerrarTurno: directa('pos', 'cerrarTurno'),
  cerrarTurnoForzado: directa('pos', 'cerrarTurnoForzado'),
  confirmarVenta: directa('pos', 'confirmarVenta'),
  solicitarAprobacion: directa('pos', 'solicitarAprobacion'),
  resolverAprobacion: directa('pos', 'resolverAprobacion'),
  solicitarAnulacion: directa('pos', 'solicitarAnulacion'),
  aprobarAnulacion: directa('pos', 'aprobarAnulacion'),
  registrarMovimientoCaja: directa('pos', 'registrarMovimientoCaja'),
  cobrarCredito: directa('pos', 'cobrarCredito'),
  guardarConfigPos: { usa: ['pos.guardarConfig'], ejecutar: async (c, e) => campo(await c.llamar('pos', 'guardarConfig', { config: e.config }), 'config') },
  leerConfigPos: { usa: ['pos.leerConfig'], ejecutar: async (c) => campo(await c.llamar('pos', 'leerConfig', {}), 'config') },
  turnoActual: { usa: ['pos.miTurno'], ejecutar: async (c) => (campo<TurnoPos | null>(await c.llamar('pos', 'miTurno', {}), 'turno') ?? null) },
  listarTurnos: {
    usa: ['pos.turnos'],
    ejecutar: async (c, e) => {
      const turnos = lista(await c.llamar('pos', 'turnos', { limite: 200 }), 'turnos') as unknown as TurnoPos[];
      return turnos.filter((t) => (e.estado === undefined ? true : e.estado === 'abierto' ? t.estado === 'abierto' : t.estado !== 'abierto'));
    },
  },
  listarVentas: {
    usa: ['pos.misVentas'],
    ejecutar: async (c, e) => {
      const datos = sinVacios({
        turnoId: e.turnoId,
        desde: e.desde === undefined ? undefined : msDeFecha(e.desde, false),
        hasta: e.hasta === undefined ? undefined : msDeFecha(e.hasta, true),
        limite: 200,
      });
      const ventas = lista(await c.llamar('pos', 'misVentas', datos), 'ventas') as unknown as VentaPos[];
      return e.conSolicitudAnulacion === true ? ventas.filter((v) => v.solicitudAnulacion !== undefined && v.estado === 'confirmada') : ventas;
    },
  },
  listarAprobaciones: {
    usa: ['pos.aprobaciones'],
    ejecutar: async (c, e) => {
      // El servidor, sin `estado`, devuelve solo las pendientes: para «todas» se piden los cuatro estados.
      const estados = e.estado === undefined ? ESTADOS_APROBACION : [e.estado];
      const partes = await Promise.all(estados.map(async (estado) => lista(await c.llamar('pos', 'aprobaciones', { estado, limite: 200 }), 'aprobaciones')));
      return (partes.flat() as unknown as AprobacionPos[]).sort((a, b) => b.solicitadoEnMs - a.solicitadoEnMs);
    },
  },
  listarMovimientosCaja: {
    usa: ['pos.movimientosCaja'],
    ejecutar: async (c, e) => {
      if (e.turnoId === undefined) throw new ErrorApi('invalid-argument', 'Indique el turno.');
      return lista(await c.llamar('pos', 'movimientosCaja', { turnoId: e.turnoId, limite: 200 }), 'movimientos') as never;
    },
  },
  listarCreditos: {
    usa: ['pos.creditos'],
    // El vendedor solo recibe los créditos de sus ventas (lo filtra el servidor).
    ejecutar: async (c, e) => {
      const creditos = lista(await c.llamar('pos', 'creditos', e.estado === 'pendiente' || e.estado === 'cobrado' || e.estado === 'anulado' ? { estado: e.estado, limite: 200 } : { limite: 200 }), 'creditos') as unknown as CreditoVista[];
      return creditos;
    },
  },
  exportarVentasCsv: {
    usa: ['pos.exportarVentasCsv'],
    ejecutar: async (c, e) => {
      // El servidor exige un rango acotado (hasta 366 días): sin fechas se pide el último año.
      const hasta = e.hasta === undefined ? Date.now() : msDeFecha(e.hasta, true);
      const desde = e.desde === undefined ? Math.max(0, hasta - 365 * 86_400_000) : msDeFecha(e.desde, false);
      const r = await c.llamar('pos', 'exportarVentasCsv', { desde, hasta });
      return { csv: String(campo(r, 'csv')), truncado: campo(r, 'truncado') === true };
    },
  },
  listarAuditoria: {
    usa: ['consola.auditoria'],
    ejecutar: async (c, e) => lista(await c.llamar('consola', 'auditoria', sinVacios({ desde: e.desde === undefined ? undefined : msDeFecha(e.desde, false), hasta: e.hasta === undefined ? undefined : msDeFecha(e.hasta, true), accion: e.accion, uid: e.uid, limite: e.limite })), 'entradas') as never,
  },

  // ---- Inventarios ----
  // Alta, edición y cambio de precio viven en Inventarios: precios y costo en centavos de USD, sin conversión; `null` vacía
  // marca, garantía, mínimo o costo; la repetición con el mismo `operacionId` devuelve `repetida`.
  crearProducto: directa('inventarios', 'crearProducto'),
  actualizarProducto: {
    usa: ['inventarios.editarProducto'],
    ejecutar: async (c, e) => {
      if (Object.keys(e.cambios).length === 0) throw new ErrorApi('invalid-argument', 'No hay cambios que guardar.');
      return (await c.llamar('inventarios', 'editarProducto', e)) as Salida<'actualizarProducto'>;
    },
  },
  ingresar: directa('inventarios', 'ingresar'),
  traspasar: directa('inventarios', 'traspasar'),
  ajustar: directa('inventarios', 'ajustar'),
  solicitarMerma: directa('inventarios', 'solicitarMerma'),
  resolverMerma: directa('inventarios', 'resolverMerma'),
  abrirConteo: directa('inventarios', 'abrirConteo'),
  registrarLineaConteo: directa('inventarios', 'registrarLineaConteo'),
  cerrarConteo: directa('inventarios', 'cerrarConteo'),
  importarProductosCsv: directa('inventarios', 'importarProductosCsv'),
  exportarProductosCsv: {
    usa: ['inventarios.exportarCsv'],
    ejecutar: async (c) => ({ csv: String(campo(await c.llamar('inventarios', 'exportarCsv', c.rol === 'adm' ? { conCostos: true } : {}), 'csv')) }),
  },
  listarProductos: {
    usa: ['inventarios.listarProductos', 'inventarios.costos'],
    roles: TODOS,
    ejecutar: async (c) => {
      const productos = lista(await c.llamar('inventarios', 'listarProductos', {}), 'productos');
      // Los costos son solo del administrador (`inventarios.costos`): al resto ni se le piden.
      let costos: Map<string, number> | undefined;
      if (c.rol === 'adm') {
        costos = new Map(lista(await c.llamar('inventarios', 'costos', {}), 'costos').map((x) => [String(x['productoId']), Number(x['costoUSD'])]));
      }
      return productos.map((p) => aProducto(p, costos));
    },
  },
  listarSeries: {
    usa: ['inventarios.series'],
    ejecutar: async (c, e) => lista(await c.llamar('inventarios', 'series', sinVacios({ productoId: e.productoId, ubicacionId: e.ubicacionId, soloDisponibles: e.soloDisponibles })), 'unidades') as unknown as UnidadSerie[],
  },
  buscarSerie: {
    usa: ['inventarios.buscarSerie'],
    ejecutar: async (c, e) => lista(await c.llamar('inventarios', 'buscarSerie', { serie: e.serie.trim() }), 'unidades') as unknown as UnidadSerie[],
  },
  listarMovimientos: {
    usa: ['inventarios.movimientos'],
    ejecutar: async (c, e) => {
      const datos = sinVacios({
        productoId: e.productoId,
        desde: e.desde === undefined ? undefined : msDeFecha(e.desde, false),
        hasta: e.hasta === undefined ? undefined : msDeFecha(e.hasta, true),
        tipo: e.tipo,
        uid: e.usuario,
        limite: e.limite ?? 200,
      });
      // El servidor filtra por tipo y por persona; `costoUSDUnit` solo llega al administrador y la vista no lo usa.
      return lista(await c.llamar('inventarios', 'movimientos', datos), 'movimientos').map(aMovimiento);
    },
  },
  listarMermas: {
    usa: ['inventarios.mermas'],
    ejecutar: async (c, e) => lista(await c.llamar('inventarios', 'mermas', sinVacios({ estado: e.estado, limite: 200 })), 'mermas').map(aMerma),
  },
  listarConteos: {
    usa: ['inventarios.conteos', 'inventarios.conteo'],
    roles: TODOS,
    ejecutar: async (c) => {
      const conteos = lista(await c.llamar('inventarios', 'conteos', { limite: 50 }), 'conteos');
      return Promise.all(
        conteos.map(async (k): Promise<ConteoVista> => {
          const detalle = await c.llamar('inventarios', 'conteo', { conteoId: String(k['id']) });
          const lineas = lista(detalle, 'lineas').map((l) => sinVacios({ productoId: String(l['productoId']), contado: Number(l['contado']), series: l['series'] as string[] | undefined }));
          return sinVacios({
            conteoId: String(k['id']), ubicacionId: k['ubicacionId'] as UbicacionId, estado: k['estado'] as ConteoVista['estado'], abiertoPor: String(k['abiertoPor']),
            cerradoPor: k['cerradoPor'] as string | undefined, fecha: String(k['abiertoEn'] ?? ''), lineas,
            // `resultado` (teórico, contado, diferencia) solo llega a sup/adm y con el conteo cerrado.
            resultado: (detalle as Obj)['resultado'] as ConteoVista['resultado'],
          }) as ConteoVista;
        }),
      );
    },
  },
  cotizacionesVigentes: {
    // Para todos los roles; además trae la política de redondeo del negocio, que el panel adopta para calcular precios.
    usa: ['pos.cotizaciones'],
    roles: TODOS,
    ejecutar: async (c) => {
      const r = (await c.llamar('pos', 'cotizaciones', {})) as Obj;
      fijarRedondeo(r['redondeo']);
      return (r['cotizaciones'] ?? { BO: null, AR: null }) as CotizacionesVigentes;
    },
  },

  // ---- Recibos ----
  buscarComprobantes: {
    usa: ['recibos.buscarComprobantes'],
    ejecutar: async (c, e) => lista(await c.llamar('recibos', 'buscarComprobantes', e.consulta), 'recibos') as never,
  },
  enviarRecibo: directa('recibos', 'enviarRecibo'),
  referenciarFacturaSuma: comoOk('recibos', 'referenciarFacturaSuma', (e) => e),
  guardarPlantilla: comoOk('recibos', 'guardarPlantilla', (e) => e),
  leerPlantilla: { usa: ['recibos.leerPlantilla'], ejecutar: async (c) => campo(await c.llamar('recibos', 'leerPlantilla', {}), 'plantilla') },
  obtenerRecibo: {
    usa: ['recibos.leerRecibo'],
    ejecutar: async (c, e) => {
      try {
        // Id determinista del comprobante de una venta (`reciboIdDe` de @novutienda/recibos); el comprobante puede tardar en emitirse.
        return campo(await c.llamar('recibos', 'leerRecibo', { reciboId: `recibo-${e.ventaId}` }), 'recibo');
      } catch (err) {
        if (err instanceof ErrorApi && err.codigoHttps === 'not-found') return null;
        throw err;
      }
    },
  },

  // ---- Consola ----
  obtenerTablero: directa('consola', 'tablero'),
  publicarSitio: directa('consola', 'publicarSitio'),
  cambiarPrecioUSD: comoOk('inventarios', 'cambiarPrecioUSD', (e) => ({ operacionId: e.operacionId, productoId: e.productoId, precioUSD: e.precioUSD })),
  guardarFicha: comoOk('consola', 'guardarFicha', (e) => e),
  reservarSubida: directa('medios', 'reservarSubida'),
  estadoSubida: {
    usa: ['medios.estadoSubida'],
    ejecutar: async (c, e) => {
      const r = (await c.llamar('medios', 'estadoSubida', e)) as Obj;
      const medio = r['medio'];
      return { estado: r['estado'] as never, ...(typeof medio === 'object' && medio !== null ? { medio: aMedio(medio as Obj) } : {}), ...(typeof r['motivo'] === 'string' ? { motivo: r['motivo'] } : {}) };
    },
  },
  finalizarSubida: {
    usa: ['medios.finalizarSubida'],
    ejecutar: async (c, e) => {
      // El disparador de Storage también finaliza la subida al llegar el original: si gana él, esta llamada responde
      // «ya fue resuelta» (failed-precondition) aunque el medio ya esté listo. La acción es idempotente: se reintenta
      // hasta que devuelva el medio; si la subida fue rechazada de verdad, el error persiste y se muestra.
      let intentosResuelta = 0;
      let esperado = 0;
      let espera = ESPERA_FINALIZAR_MS;
      for (;;) {
        try {
          return aMedio(campo(await c.llamar('medios', 'finalizarSubida', e), 'medio') as Obj);
        } catch (err) {
          if (!(err instanceof ErrorApi)) throw err;
          if (err.codigoHttps === 'failed-precondition' && (intentosResuelta += 1) < REINTENTOS_FINALIZAR) {
            await c.esperar(ESPERA_FINALIZAR_MS);
          } else if ((err.codigoHttps === 'deadline-exceeded' || err.codigoHttps === 'unavailable') && esperado < ESPERA_SUBIDA_MAXIMA_MS) {
            // La llamada se cortó, pero el servidor puede seguir procesando: se reintenta con retroceso (hasta ~2 minutos).
            await c.esperar(espera);
            esperado += espera;
            espera = Math.min(Math.round(espera * 1.5), ESPERA_SUBIDA_TOPE_MS);
          } else throw err;
        }
      }
    },
  },
  borrarMedio: comoOk('medios', 'borrarMedio', (e) => e),
  guardarSeccion: comoOk('consola', 'guardarSeccion', (e) => e),
  eliminarSeccion: comoOk('consola', 'eliminarSeccion', (e) => e),
  ordenarSecciones: comoOk('consola', 'ordenarSecciones', (e) => e),
  guardarCarrusel: comoOk('consola', 'guardarCarrusel', (e) => e),
  guardarConfigSitio: comoOk('consola', 'guardarConfigSitio', (e) => e),
  simularImportacion: { usa: ['consola.simularImportacion'], ejecutar: async (c, e) => campo(await c.llamar('consola', 'simularImportacion', { archivo: e.contenidoBase64 }), 'simulacion') },
  importarProductos: {
    usa: ['consola.importarProductos'],
    ejecutar: async (c, e) => (await c.llamar('consola', 'importarProductos', sinVacios({ archivo: e.contenidoBase64, omitirErrores: e.omitirErrores }))) as never,
  },
  exportarProductosCsvSitio: directa('consola', 'exportarProductosCsv'),
  buscarUsuarioPorCorreo: {
    usa: ['consola.buscarUsuarioPorCorreo'],
    ejecutar: async (c, e) => {
      const r = (await c.llamar('consola', 'buscarUsuarioPorCorreo', { correo: e.correo.trim() })) as Obj;
      return { uid: String(r['uid']), correoVerificado: r['correoVerificado'] === true, conContrasena: r['conContrasena'] === true };
    },
  },
  asignarRol: comoOk('consola', 'asignarRol', (e) => e),
  quitarRol: comoOk('consola', 'quitarRol', (e) => e),
  listarFichas: { usa: ['consola.fichas'], ejecutar: async (c) => lista(await c.llamar('consola', 'fichas', {}), 'fichas') as never },
  listarMedios: {
    usa: ['medios.listarMedios'],
    ejecutar: async (c, e) => lista(await c.llamar('medios', 'listarMedios', { productoId: e.productoId }), 'medios').map(aMedio),
  },
  leerConfigSitio: { usa: ['consola.configSitio'], ejecutar: async (c) => (campo(await c.llamar('consola', 'configSitio', {}), 'config') ?? null) as never },
  listarSecciones: { usa: ['consola.secciones'], ejecutar: async (c) => lista(await c.llamar('consola', 'secciones', {}), 'secciones') as never },
  listarCarruseles: { usa: ['consola.carruseles'], ejecutar: async (c) => lista(await c.llamar('consola', 'carruseles', {}), 'carruseles') as never },
  listarUsuarios: {
    usa: ['consola.listarUsuarios'],
    ejecutar: async (c) =>
      lista(await c.llamar('consola', 'listarUsuarios', {}), 'usuarios').map(
        (u): UsuarioVista => ({ uid: String(u['uid']), correo: typeof u['correo'] === 'string' ? u['correo'] : '', rol: u['rol'] as Rol, verificado: u['correoVerificado'] === true }),
      ),
  },
  modulosActivos: {
    usa: ['consola.modulosActivos'],
    ejecutar: async (c) => {
      const m = campo<unknown>(await c.llamar('consola', 'modulosActivos', {}), 'modulos');
      return (Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : []) as never;
    },
  },
};

export const NOMBRES_CALLABLE = Object.keys(TRADUCCION) as NombreCallable[];

const interseccion = (a: readonly Rol[], b: readonly Rol[]): readonly Rol[] => a.filter((r) => b.includes(r));

/** Quién puede pedir cada operación del panel: los roles de la traducción o la intersección de las acciones reales que usa. */
export const ROLES_CALLABLE: Readonly<Record<NombreCallable, readonly Rol[]>> = Object.fromEntries(
  NOMBRES_CALLABLE.map((n) => {
    const t = TRADUCCION[n] as Traduccion<NombreCallable>;
    // Las operaciones de varios pasos (alta + costo) exigen el rol más estricto de sus pasos.
    const roles = t.roles ?? t.usa.map(rolesDeAccion).reduce<readonly Rol[]>((acc, r) => interseccion(acc, r), TODOS);
    return [n, roles];
  }),
) as Record<NombreCallable, readonly Rol[]>;
