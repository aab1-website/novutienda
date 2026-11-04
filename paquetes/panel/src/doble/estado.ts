import type { Rol } from '@plataforma/nucleo';
import { ErrorApi } from '../api/errores.js';
import type {
  AprobacionPos, Carrusel, CobroCredito, ConfigPos, ConfigSitio, ConteoVista, CotizacionesVigentes, CreditoVista, EntradaAuditoriaVista,
  FichaWeb, Medio, MermaVista, MovimientoCaja, MovimientoVista, PlantillaRecibo, ProductoPanel, Recibo, Seccion, SubidaVista, TurnoPos,
  UbicacionId, UnidadSerie, UsuarioVista, VentaPos,
} from '../api/tipos.js';

/** Producto interno del doble: igual que ProductoPanel pero con el costo siempre presente. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type ProductoInterno = Mutable<Omit<ProductoPanel, 'bajoMinimo' | 'disponible' | 'costoUSD' | 'existencias'>> & { costoUSD: number; existencias: Record<UbicacionId, number> };

export interface EstadoDoble {
  productos: Map<string, ProductoInterno>;
  unidades: Map<string, UnidadSerie>;
  movimientos: MovimientoVista[];
  operaciones: Map<string, { hash: string; resultado: Record<string, unknown> }>;
  mermas: MermaVista[];
  conteos: Map<string, ConteoVista & { teoricos: Map<string, number> }>;
  cotizaciones: CotizacionesVigentes;
  turnos: Map<string, TurnoPos>;
  ventas: Map<string, VentaPos>;
  aprobaciones: Map<string, AprobacionPos>;
  movCaja: Map<string, MovimientoCaja>;
  creditos: Map<string, CreditoVista & { cobrosPorMedio: Record<string, number> }>;
  cobros: Map<string, CobroCredito>;
  recibos: Map<string, Recibo>;
  contadorRecibo: Map<string, number>;
  configPos: ConfigPos;
  plantilla: PlantillaRecibo;
  auditoria: EntradaAuditoriaVista[];
  fichas: Map<string, FichaWeb>;
  medios: Map<string, Medio>;
  subidas: Map<string, SubidaVista & { productoId: string; bytes: number }>;
  secciones: Seccion[];
  carruseles: Map<string, Carrusel>;
  configSitio: ConfigSitio | null;
  cambiosSinPublicar: number;
  ultimoCambioEn: string;
  publicadoEn: string | null;
  versionPublicada: number;
  usuarios: Mutable<UsuarioVista>[];
  bytesOriginales: number;
}

const HTTPS_DE_MODULO: Readonly<Record<string, string>> = {
  'entrada-invalida': 'invalid-argument', 'no-autorizado': 'permission-denied', 'sin-permiso': 'permission-denied', 'no-encontrado': 'not-found',
  'producto-inexistente': 'not-found', 'venta-inexistente': 'not-found', 'aprobacion-inexistente': 'not-found', 'credito-inexistente': 'not-found',
  'operacion-conflicto': 'already-exists', conflicto: 'already-exists', 'request-en-uso': 'already-exists', limite: 'resource-exhausted',
  'cuota-excedida': 'resource-exhausted', 'limite-del-plan': 'failed-precondition',
};

/** Error del módulo con su código HTTPS (por omisión `failed-precondition`). */
export function fallo(codigo: string, mensaje = codigo, extra: Record<string, unknown> = {}): ErrorApi {
  return new ErrorApi(HTTPS_DE_MODULO[codigo] ?? 'failed-precondition', mensaje, { codigo, ...extra });
}

export interface Contexto {
  readonly e: EstadoDoble;
  readonly uid: string;
  readonly rol: Rol;
  readonly ahora: number;
  readonly tenantId: string;
}

export const iso = (ms: number): string => new Date(ms).toISOString();
/** Fecha de calendario en La Paz (UTC-4) como aaaa-mm-dd. */
export const fechaLaPaz = (ms: number): string => new Date(ms - 4 * 3600_000).toISOString().slice(0, 10);

export function auditar(c: Contexto, accion: string, ruta: string, motivo?: string): void {
  c.e.auditoria.push({
    id: `a-${c.e.auditoria.length + 1}`, fecha: iso(c.ahora), uid: c.uid, rol: c.rol, accion, ruta,
    ...(motivo !== undefined ? { motivo } : {}),
  });
}

export function exigirRol(c: Contexto, permitidos: readonly Rol[]): void {
  if (!permitidos.includes(c.rol)) throw fallo('no-autorizado', 'Sin permiso');
}

export function crearEstado(ahora: number): EstadoDoble {
  const mk = (id: string, nombre: string, categoria: string, marca: string, conSerie: boolean, garantia: number | undefined, bo: number, ar: number, costo: number, minimo: number, ex: [number, number, number]): ProductoInterno => ({
    id, nombre, categoria, marca, sku: id.toUpperCase(), activo: true, publicado: true, conSerie,
    ...(garantia !== undefined ? { garantiaMeses: garantia } : {}), minimo, precioUSD: { bo, ar }, costoUSD: costo,
    stockTotal: ex[0] + ex[1] + ex[2], existencias: { tienda: ex[0], 'deposito-1': ex[1], 'deposito-2': ex[2] },
  });
  const productos = new Map<string, ProductoInterno>();
  for (const p of [
    mk('tv-55', 'Televisor 55 pulgadas', 'Televisores', 'Aurora', true, 12, 45000, 48000, 30000, 2, [3, 2, 0]),
    mk('cel-a1', 'Celular A1 128 GB', 'Celulares', 'Nova', true, 6, 18000, 19000, 12000, 2, [2, 0, 0]),
    mk('cable-hdmi', 'Cable HDMI 2 m', 'Accesorios', 'Cabletec', false, undefined, 800, 900, 300, 10, [25, 10, 0]),
    mk('parlante', 'Parlante portátil', 'Audio', 'Sonar', false, 3, 2500, 2700, 1500, 3, [1, 0, 0]),
    mk('audifonos', 'Audífonos inalámbricos', 'Audio', 'Sonar', false, undefined, 1500, 1600, 800, 2, [0, 0, 5]),
  ]) productos.set(p.id, p);

  const unidades = new Map<string, UnidadSerie>();
  const serie = (productoId: string, s: string, u: UbicacionId): void => void unidades.set(`${productoId}__${s}`, { productoId, serie: s, estado: 'disponible', ubicacionId: u });
  ['TV55-001', 'TV55-002', 'TV55-003'].forEach((s) => serie('tv-55', s, 'tienda'));
  ['TV55-004', 'TV55-005'].forEach((s) => serie('tv-55', s, 'deposito-1'));
  ['CELA1-001', 'CELA1-002'].forEach((s) => serie('cel-a1', s, 'tienda'));

  return {
    productos, unidades, movimientos: [], operaciones: new Map(), mermas: [], conteos: new Map(),
    cotizaciones: {
      BO: { cotizacionId: 'BO-demo', par: 'BOB/USD', valor: 6.96, fecha: iso(ahora).slice(0, 10), fuente: 'BCB', estado: 'vigente' },
      AR: { cotizacionId: 'AR-demo', par: 'ARS/USD', valor: 1000, fecha: iso(ahora).slice(0, 10), fuente: 'BNA', estado: 'vigente' },
    },
    turnos: new Map(), ventas: new Map(), aprobaciones: new Map(), movCaja: new Map(), creditos: new Map(), cobros: new Map(),
    recibos: new Map(), contadorRecibo: new Map(),
    configPos: {
      negocio: { nombre: 'Negocio de ejemplo', direccion: 'Calle Ejemplo 123', telefono: '70000000' },
      colores: { primario: '#0077b3', secundario: '#f4f6f9' },
      mediosHabilitados: ['efectivo', 'qr', 'transferencia', 'credito'], monedaPorDefecto: 'BOB',
      topesDescuentoBp: { caj: 500, sup: 10000, adm: 10000 }, textoRecibo: 'Gracias por su compra.', serieRecibo: 'A',
    },
    plantilla: { negocio: { nombre: 'Negocio de ejemplo', direccion: 'Calle Ejemplo 123', telefono: '70000000' }, pie: 'Comprobante no fiscal.', politicaGarantia: 'Garantía según ficha del producto.', politicaCambios: 'Cambios dentro de 7 días con el comprobante.' },
    auditoria: [], fichas: new Map(), medios: new Map(), subidas: new Map(), secciones: [], carruseles: new Map(),
    configSitio: { plantillaActiva: 'marfil', whatsappNovuchat: '59170000000', medicion: {} },
    cambiosSinPublicar: 0, ultimoCambioEn: iso(ahora), publicadoEn: null, versionPublicada: 0,
    usuarios: [
      { uid: 'u-adm', correo: 'adm@ejemplo.test', rol: 'adm', verificado: true },
      { uid: 'u-sup', correo: 'sup@ejemplo.test', rol: 'sup', verificado: true },
      { uid: 'u-caj', correo: 'caj@ejemplo.test', rol: 'caj', verificado: true },
    ],
    bytesOriginales: 0,
  };
}

export function vistaProducto(p: ProductoInterno, verCosto: boolean): ProductoPanel {
  const { costoUSD, ...resto } = p;
  const sinStock = p.stockTotal === undefined;
  return {
    ...resto,
    ...(verCosto ? { costoUSD } : {}),
    bajoMinimo: !sinStock && p.minimo !== undefined && (p.stockTotal ?? 0) <= p.minimo,
    disponible: p.activo && (sinStock || p.existencias.tienda > 0),
  };
}

export function recalcular(p: ProductoInterno): void {
  if (p.stockTotal !== undefined) p.stockTotal = p.existencias.tienda + p.existencias['deposito-1'] + p.existencias['deposito-2'];
}
