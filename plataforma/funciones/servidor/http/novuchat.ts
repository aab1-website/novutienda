// API de solo lectura para NovuChat (catálogo e inventario) y pedido firmado. Contrato:
// docs/integracion-novuchat.md. El tenant sale del token (catálogo e inventario); el token se guarda como
// SHA-256 en `novuchatTokens/{hash}` (rotación: hasta dos documentos activos por tenant) y se compara en
// tiempo constante. Las respuestas llevan ETag y `Cache-Control: private, max-age=60`.
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  esDisponible, leerDocumentoProducto, UBICACION_DISPONIBILIDAD, UBICACIONES, confirmarPedidoFirmado,
} from '@novutienda/inventarios';
import {
  esMercado, leerCotizacion, MONEDA_DE, precioFinal, SinCotizacionUtilizable, type CopiaCotizacion, type Mercado, type Redondeo,
} from '@novutienda/nucleo';
import type { LimiteTasa } from '@novutienda/website';
import type { Entorno } from '../entorno.js';
import { json, type PeticionHttp, type RespuestaApi } from './tipos.js';

export const COLECCION_TOKENS = 'novuchatTokens';
export const MAX_ITEMS_CATALOGO = 200;
export const CACHE_NOVUCHAT = 'private, max-age=60';

export const sha256Hex = (texto: string): string => createHash('sha256').update(texto).digest('hex');

export interface ConfigNovuchat {
  readonly sitioUrl: string;
  readonly mediosBaseUrl: string;
  readonly limite: LimiteTasa;
  /** Secreto HMAC del pedido firmado. */
  readonly secretoPedidos: string;
  /** Tenant de las rutas firmadas, que no llevan token de tenant. */
  readonly tenantPedidos: string;
}

type Datos = Readonly<Record<string, unknown>>;

/** Tenant dueño del token, o la respuesta de error. */
export async function autenticarToken(e: Entorno, cabeceras: PeticionHttp['cabeceras']): Promise<{ tenantId: string; hash: string } | RespuestaApi> {
  const auth = cabeceras['authorization'];
  const m = auth === undefined ? null : /^Bearer\s+(\S+)$/i.exec(auth);
  if (m?.[1] === undefined) return json(401, { error: 'sin_credencial' });
  const hash = sha256Hex(m[1]);
  const doc = (await e.firestore.collection(COLECCION_TOKENS).doc(hash).get()).data();
  const guardado = typeof doc?.['hash'] === 'string' && /^[0-9a-f]{64}$/.test(doc['hash']) ? Buffer.from(doc['hash'], 'hex') : undefined;
  const presentado = Buffer.from(hash, 'hex');
  const tenantId = doc?.['tenantId'];
  if (guardado === undefined || guardado.length !== presentado.length || !timingSafeEqual(guardado, presentado) || doc?.['activo'] !== true || typeof tenantId !== 'string') {
    return json(401, { error: 'credencial_invalida' });
  }
  return { tenantId, hash };
}

const esRespuesta = (x: unknown): x is RespuestaApi => typeof x === 'object' && x !== null && 'status' in x;

function conEtag(req: PeticionHttp, estable: unknown, completo: unknown): RespuestaApi {
  const etag = `"${sha256Hex(JSON.stringify(estable)).slice(0, 32)}"`;
  const cabeceras = { ETag: etag, 'Cache-Control': CACHE_NOVUCHAT, Vary: 'Authorization' };
  if (req.cabeceras['if-none-match'] === etag) return { status: 304, headers: cabeceras };
  return json(200, completo, cabeceras);
}

interface MedioPub {
  readonly tipo: string;
  readonly versiones: readonly { readonly clase: string; readonly lado: number; readonly formato: string; readonly ruta: string }[];
}

/** URL de la foto: preferimos WebP de 960 px (la más cercana si no existe). */
function urlFoto(m: MedioPub, base: string): string | undefined {
  const imgs = m.versiones.filter((v) => v.clase === 'imagen' && v.formato === 'webp');
  const mejor = [...imgs].sort((a, b) => Math.abs(a.lado - 960) - Math.abs(b.lado - 960))[0];
  return mejor === undefined ? undefined : `${base}/${mejor.ruta}`;
}

async function existenciasPorProducto(e: Entorno, tenantId: string): Promise<Map<string, Record<string, number>>> {
  const exis = await e.firestore.collection(`tenants/${tenantId}/existencias`).get();
  const salida = new Map<string, Record<string, number>>();
  for (const x of exis.docs) {
    const d = x.data();
    if (typeof d['productoId'] === 'string' && typeof d['ubicacionId'] === 'string' && typeof d['cantidad'] === 'number') {
      salida.set(d['productoId'], { ...(salida.get(d['productoId']) ?? {}), [d['ubicacionId']]: d['cantidad'] });
    }
  }
  return salida;
}

const stockPorAlmacen = (por: Record<string, number> | undefined): Record<string, number> =>
  Object.fromEntries(UBICACIONES.map((u) => [u, por?.[u] ?? 0]));

async function catalogo(e: Entorno, tenantId: string, mercado: Mercado, cfg: ConfigNovuchat): Promise<{ estable: Record<string, unknown>; generadoEn: string } | RespuestaApi> {
  let cot: CopiaCotizacion;
  try {
    cot = await leerCotizacion(e.almacenCotizaciones, mercado, e.ahora(), { tenantId });
  } catch (error) {
    if (error instanceof SinCotizacionUtilizable) return json(503, { error: 'sin_cotizacion' }, { 'Retry-After': '300' });
    throw error;
  }
  const redondeo: Redondeo = await e.redondeo(tenantId);
  const [prods, existencias] = await Promise.all([
    e.firestore.collection(`tenants/${tenantId}/productos`).where('publicado', '==', true).where('activo', '==', true).get(),
    existenciasPorProducto(e, tenantId),
  ]);
  const productos = prods.docs.map((p) => leerDocumentoProducto(p.id, p.data())).sort((a, b) => a.nombre.localeCompare(b.nombre) || a.productoId.localeCompare(b.productoId));
  const copias = productos.length === 0 ? [] : await e.firestore.getAll(...productos.map((p) => e.firestore.doc(`tenants/${tenantId}/publicado/producto__${p.productoId}`)));
  const copiaDe = new Map(copias.map((d) => [d.id.replace('producto__', ''), d.data()]));
  // Sin valor por defecto al bucket por defecto: `MEDIOS_BASE_URL` es obligatoria (config.ts) y apunta a un origen público APARTE.
  const base = cfg.mediosBaseUrl;
  if (base === '') throw new Error('MEDIOS_BASE_URL no configurada');
  const moneda = MONEDA_DE[mercado];
  const clave = mercado === 'BO' ? 'bo' : 'ar';
  const items: Record<string, unknown>[] = [];
  for (const p of productos) {
    const pub = copiaDe.get(p.productoId);
    if (pub === undefined) continue; // sin copia publicada no hay ficha que mostrar
    const precio = precioFinal(p.precioCentavos[clave] / 100, mercado, cot, redondeo);
    if (precio.tipo !== 'precio') continue; // sin precio en este mercado
    const por = stockPorAlmacen(existencias.get(p.productoId));
    // Un producto que NO controla stock (sin `stockTotal`) está disponible mientras esté activo: `stock` va en `null` (no 0, que
    // el asistente leería como agotado) y `disponible` lo dice con la regla única de Inventarios.
    const stockTienda = p.stockTotal === undefined ? null : (por[UBICACION_DISPONIBILIDAD] ?? 0);
    const disponible = esDisponible({ activo: p.activo, ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}) }, por[UBICACION_DISPONIBILIDAD] ?? 0);
    const medios = (Array.isArray(pub['medios']) ? pub['medios'] : []) as MedioPub[];
    const fotos = medios.filter((m) => m.tipo === 'foto').map((m) => urlFoto(m, base)).filter((u): u is string => u !== undefined).slice(0, 5);
    items.push({
      id: p.productoId, nombre: p.nombre, precio: precio.monto, precioCentavos: precio.centavos, moneda, stock: stockTienda, disponible, stockPorAlmacen: por,
      foto: fotos[0] ?? null, fotos, activo: true, area: p.categoria ?? '', descripcion: typeof pub['descripcion'] === 'string' ? pub['descripcion'] : '',
      urlProducto: cfg.sitioUrl !== '' && typeof pub['slug'] === 'string' ? `${cfg.sitioUrl}/producto/${pub['slug']}` : null,
    });
    if (items.length >= MAX_ITEMS_CATALOGO) break;
  }
  return {
    generadoEn: new Date(e.ahora()).toISOString(),
    estable: {
      version: 1, mercado, moneda,
      cotizacion: { id: cot.cotizacionId, par: cot.par, valor: cot.valor, fecha: cot.fecha, fuente: cot.fuente, estado: cot.estado },
      items,
    },
  };
}

async function limitar(cfg: ConfigNovuchat, hash: string, ahora: number): Promise<RespuestaApi | undefined> {
  const r = await cfg.limite.intentar(`novuchat:${hash}`, ahora);
  return r.permitido ? undefined : json(429, { error: 'limite' }, { 'Retry-After': String(r.reintentarEnSeg) });
}

/** `GET /api/novuchat/v1/catalogo?mercado=BO|AR`. */
export async function manejarCatalogo(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat): Promise<RespuestaApi> {
  if (req.metodo !== 'GET') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'GET' });
  const a = await autenticarToken(e, req.cabeceras);
  if (esRespuesta(a)) return a;
  const limitado = await limitar(cfg, a.hash, e.ahora());
  if (limitado !== undefined) return limitado;
  const mercado = req.consulta['mercado'];
  if (!esMercado(mercado)) return json(400, { error: 'mercado_invalido' });
  const c = await catalogo(e, a.tenantId, mercado, cfg);
  if (esRespuesta(c)) return c;
  const { estable, generadoEn } = c;
  return conEtag(req, estable, { version: 1, mercado: estable['mercado'], moneda: estable['moneda'], generadoEn, cotizacion: estable['cotizacion'], items: estable['items'] });
}

/** `GET /api/novuchat/v1/inventario`: existencias por almacén de todos los productos (sin costos). */
export async function manejarInventario(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat): Promise<RespuestaApi> {
  if (req.metodo !== 'GET') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'GET' });
  const a = await autenticarToken(e, req.cabeceras);
  if (esRespuesta(a)) return a;
  const limitado = await limitar(cfg, a.hash, e.ahora());
  if (limitado !== undefined) return limitado;
  const [prods, existencias] = await Promise.all([e.firestore.collection(`tenants/${a.tenantId}/productos`).get(), existenciasPorProducto(e, a.tenantId)]);
  const items = prods.docs
    .map((d) => ({ p: leerDocumentoProducto(d.id, d.data()), bajoMinimo: d.data()['bajoMinimo'] === true }))
    .sort((x, y) => x.p.productoId.localeCompare(y.p.productoId))
    .map(({ p, bajoMinimo }) => ({
      id: p.productoId, nombre: p.nombre, sku: p.sku ?? null, activo: p.activo, conSerie: p.conSerie, stockTotal: p.stockTotal ?? null,
      stockPorAlmacen: stockPorAlmacen(existencias.get(p.productoId)), minimo: p.minimo ?? null, bajoMinimo,
    }));
  const estable = { version: 1, items };
  return conEtag(req, estable, { ...estable, generadoEn: new Date(e.ahora()).toISOString() });
}

/** `POST /api/novuchat/v1/pedidos/confirmar`: HMAC-SHA256 de `{marca}.{cuerpo exacto}`, ventana de 5 minutos. */
export async function manejarPedido(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat): Promise<RespuestaApi> {
  if (req.metodo !== 'POST') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'POST' });
  if (cfg.secretoPedidos === '') return json(503, { error: 'no_configurado' });
  const r = await confirmarPedidoFirmado(
    { db: e.db, secreto: cfg.secretoPedidos, ahora: e.ahora },
    { tenantId: cfg.tenantPedidos, marcaTiempo: req.cabeceras['x-marca-tiempo'] ?? '', firma: req.cabeceras['x-firma'] ?? '', cuerpo: req.cuerpoCrudo },
  );
  return json(r.estado, r.cuerpo as Datos);
}
