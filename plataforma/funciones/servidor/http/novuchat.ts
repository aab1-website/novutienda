// API de solo lectura para NovuChat (catálogo e inventario) y pedido firmado. Contrato:
// docs/integracion-novuchat.md. El tenant sale del token (catálogo e inventario); el token se guarda como
// SHA-256 en `novuchatTokens/{hash}` (rotación: hasta dos documentos activos por tenant) y se compara en
// tiempo constante. Las respuestas llevan ETag y `Cache-Control: private, max-age=60`.
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  esDisponible, leerDocumentoProducto, precioEnMercado, UBICACION_DISPONIBILIDAD, UBICACIONES, confirmarPedidoFirmado,
} from '@novutienda/inventarios';
import {
  esMercadoDe, leerCotizacionDe, mercadoDe, precioDeMercado, SinCotizacionUtilizable, type ConfiguracionComercial, type CopiaCotizacion, type LimiteTasa, type ReglaRedondeo,
} from '@novutienda/nucleo';
import { logger } from 'firebase-functions';
import type { Entorno } from '../entorno.js';
import { ID_PRODUCTO } from '../llamadas/comunes.js';
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

/** Control de encendido que pone el enrutador: `true` si el módulo dueño de la ruta está efectivo para el tenant. */
export type PuedeServir = (tenantId: string) => Promise<boolean>;

/** Con el módulo apagado se responde igual que con un token malo (D2 = A): NovuChat no distingue los dos casos. */
const sinServicio = (): RespuestaApi => json(401, { error: 'credencial_invalida' });

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

/** Largo máximo de `descripcion` en el catálogo: el catálogo de WhatsApp muestra un texto corto. */
export const MAX_DESCRIPCION_CATALOGO = 300;

/** Descripción en una sola línea (espacios y saltos colapsados) y de hasta 300 caracteres; si se corta, termina en «…» sin partir una palabra. */
export function descripcionCorta(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  if (plano.length <= MAX_DESCRIPCION_CATALOGO) return plano;
  // Un espacio en el lugar 300 deja entera la palabra anterior: con el «…» suma 300.
  const espacio = plano.slice(0, MAX_DESCRIPCION_CATALOGO).lastIndexOf(' ');
  let corte = espacio > MAX_DESCRIPCION_CATALOGO / 2 ? plano.slice(0, espacio) : plano.slice(0, MAX_DESCRIPCION_CATALOGO - 1);
  // No dejar medio emoji: una unidad alta de un par sustituto al final se quita.
  if (/[\uD800-\uDBFF]$/.test(corte)) corte = corte.slice(0, -1);
  return `${corte.trimEnd()}…`;
}

type CategoriaPublicada = { readonly nombre: string; readonly orden: number | null; readonly oculta: boolean };

/** Nombre y orden de cada categoría de `publicado/negocio`; una entrada malformada se ignora (la categoría sale con su clave). */
function categoriasPublicadas(negocio: Datos | undefined): ReadonlyMap<string, CategoriaPublicada> {
  const r = new Map<string, CategoriaPublicada>();
  const crudas = negocio?.['categorias'];
  if (typeof crudas !== 'object' || crudas === null || Array.isArray(crudas)) return r;
  for (const [clave, v] of Object.entries(crudas as Datos)) {
    if (typeof v !== 'object' || v === null) continue;
    const c = v as Datos;
    if (typeof c['nombre'] !== 'string' || c['nombre'].trim() === '') continue;
    const orden = c['orden'];
    r.set(clave, {
      nombre: c['nombre'].trim(), oculta: c['oculta'] === true,
      orden: typeof orden === 'number' && Number.isInteger(orden) && orden >= 0 && orden <= 39 ? orden : null,
    });
  }
  return r;
}

/** `area`: nombre visible de la categoría (sin nombre propio, la clave tal cual, como en el sitio); `areaClave`: la clave estable; `ordenArea`: su posición o `null`. */
function areaDe(clave: string, categorias: ReadonlyMap<string, CategoriaPublicada>): { area: string; areaClave: string; ordenArea: number | null } {
  const c = categorias.get(clave);
  return { area: c?.nombre ?? clave, areaClave: clave, ordenArea: c?.orden ?? null };
}

async function catalogo(e: Entorno, tenantId: string, comercial: ConfiguracionComercial, mercadoId: string, cfg: ConfigNovuchat): Promise<{ estable: Record<string, unknown>; generadoEn: string } | RespuestaApi> {
  // `mercadoId` ya se comprobó contra los mercados del tenant (`esMercadoDe`), por eso `mercadoDe` no devuelve `undefined`.
  const mercado = mercadoDe(comercial, mercadoId)!;
  let cot: CopiaCotizacion<string>;
  try {
    cot = await leerCotizacionDe(e.almacenCotizaciones, mercadoId, e.ahora(), { tenantId, comercial });
  } catch (error) {
    if (error instanceof SinCotizacionUtilizable) return json(503, { error: 'sin_cotizacion' }, { 'Retry-After': '300' });
    throw error;
  }
  // Redondeo: la misma fuente y los mismos fallos que en main (`e.redondeo`, `config/redondeo`).
  // Indexado por la moneda de venta del mercado declarado: sin regla para ella el producto se salta antes de llamar a `precioDeMercado`.
  const redondeo: Readonly<Record<string, ReglaRedondeo | undefined>> = await e.redondeo(tenantId);
  // Una sola definición de «publicado» (DS-1): existe la copia `publicado/producto__<id>` que escribe la publicación de la consola.
  // La lista de ids sale de `publicado/estado.productos`; `producto.publicado` de Inventarios no se lee.
  const [estadoDoc, existencias, negocioDoc] = await Promise.all([
    e.firestore.doc(`tenants/${tenantId}/publicado/estado`).get(),
    existenciasPorProducto(e, tenantId),
    // Nombre visible y orden de cada categoría: la copia publicada del negocio, la misma que usa el sitio.
    e.firestore.doc(`tenants/${tenantId}/publicado/negocio`).get(),
  ]);
  const categorias = categoriasPublicadas(negocioDoc.data());
  const lista: unknown = estadoDoc.data()?.['productos'];
  const candidatos = Array.isArray(lista) ? [...new Set(lista.filter((x): x is string => typeof x === 'string'))] : [];
  // Solo ids con la forma de un id de producto (`ID_PRODUCTO`, llamadas/comunes.ts): uno con `/` haría lanzar a `doc()` o leería un documento anidado.
  const idsPublicados = candidatos.filter((id) => ID_PRODUCTO.safeParse(id).success);
  if (idsPublicados.length < candidatos.length) logger.warn('catálogo NovuChat: ids de publicado/estado ignorados por inválidos', { ignorados: candidatos.length - idsPublicados.length });
  const copiaDe = new Map<string, Datos>();
  const productos: ReturnType<typeof leerDocumentoProducto>[] = [];
  const LOTE = 100;
  const lotes: string[][] = [];
  for (let i = 0; i < idsPublicados.length; i += LOTE) lotes.push(idsPublicados.slice(i, i + LOTE));
  const leidos = await Promise.all(
    lotes.map((ids) =>
      e.firestore.getAll(
        ...ids.map((id) => e.firestore.doc(`tenants/${tenantId}/publicado/producto__${id}`)),
        ...ids.map((id) => e.firestore.doc(`tenants/${tenantId}/productos/${id}`)),
      ),
    ),
  );
  lotes.forEach((ids, n) => {
    const docs = leidos[n]!;
    ids.forEach((id, k) => {
      const copia = docs[k];
      const vivo = docs[ids.length + k];
      const datosCopia = copia?.exists === true ? copia.data() : undefined;
      const datosVivo = vivo?.exists === true ? vivo.data() : undefined;
      if (datosCopia === undefined || datosVivo === undefined || datosVivo['activo'] !== true) return; // sin copia o vivo, o desactivado: no se ofrece
      copiaDe.set(id, datosCopia);
      productos.push(leerDocumentoProducto(id, datosVivo, comercial));
    });
  });
  productos.sort((a, b) => a.nombre.localeCompare(b.nombre) || a.productoId.localeCompare(b.productoId));
  // Sin valor por defecto al bucket por defecto: `MEDIOS_BASE_URL` es obligatoria (config.ts) y apunta a un origen público APARTE.
  const urlMedios = cfg.mediosBaseUrl;
  if (urlMedios === '') throw new Error('MEDIOS_BASE_URL no configurada');
  const moneda = mercado.monedaVenta;
  const items: Record<string, unknown>[] = [];
  for (const p of productos) {
    const pub = copiaDe.get(p.productoId);
    if (pub === undefined) continue; // sin copia publicada no hay ficha que mostrar
    // Categoría oculta (decisión del 24/11/2026): igual que en el sitio, sus productos no se ofrecen. Se mira la categoría viva,
    // así un producto que se pasa a una categoría oculta sale de inmediato, sin esperar a la siguiente publicación.
    if (categorias.get(p.categoria ?? '')?.oculta === true) continue;
    // D7: una sola regla de redondeo (0 a 2 decimales o un múltiplo de centavos). Una configuración con otra regla ya falló antes,
    // en `e.redondeo` (`RedondeoInvalido`), y el catálogo no sale: falla cerrado, sin precios.
    const base = precioEnMercado(p, mercadoId);
    if (base === null) continue; // sin precio declarado en este mercado
    const regla = redondeo[mercado.monedaVenta];
    if (regla === undefined) continue; // sin regla de redondeo para la moneda: el precio es inválido, no se ofrece
    const precio = precioDeMercado(base / 100, { ...mercado, redondeo: regla }, cot);
    if (precio.tipo !== 'precio') continue; // sin precio en este mercado
    const por = stockPorAlmacen(existencias.get(p.productoId));
    // Un producto que NO controla stock (sin `stockTotal`) está disponible mientras esté activo: `stock` va en `null` (no 0, que
    // el asistente leería como agotado) y `disponible` lo dice con la regla única de Inventarios.
    const stockTienda = p.stockTotal === undefined ? null : (por[UBICACION_DISPONIBILIDAD] ?? 0);
    const disponible = esDisponible({ activo: p.activo, ...(p.stockTotal !== undefined ? { stockTotal: p.stockTotal } : {}) }, por[UBICACION_DISPONIBILIDAD] ?? 0);
    const medios = (Array.isArray(pub['medios']) ? pub['medios'] : []) as MedioPub[];
    const fotos = medios.filter((m) => m.tipo === 'foto').map((m) => urlFoto(m, urlMedios)).filter((u): u is string => u !== undefined).slice(0, 5);
    items.push({
      id: p.productoId, nombre: p.nombre, precio: precio.monto, precioCentavos: precio.centavos, moneda, stock: stockTienda, disponible, stockPorAlmacen: por,
      foto: fotos[0] ?? null, fotos, activo: true, ...areaDe(p.categoria ?? '', categorias),
      descripcion: descripcionCorta(typeof pub['descripcion'] === 'string' ? pub['descripcion'] : ''),
      urlProducto: cfg.sitioUrl !== '' && typeof pub['slug'] === 'string' ? `${cfg.sitioUrl}/producto/${pub['slug']}` : null,
    });
    if (items.length >= MAX_ITEMS_CATALOGO) break;
  }
  return {
    generadoEn: new Date(e.ahora()).toISOString(),
    estable: {
      version: 1, mercado: mercadoId, moneda,
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
export async function manejarCatalogo(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat, puedeServir: PuedeServir): Promise<RespuestaApi> {
  if (req.metodo !== 'GET') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'GET' });
  const a = await autenticarToken(e, req.cabeceras);
  if (esRespuesta(a)) return a;
  if (!(await puedeServir(a.tenantId))) return sinServicio();
  const limitado = await limitar(cfg, a.hash, e.ahora());
  if (limitado !== undefined) return limitado;
  const mercado = req.consulta['mercado'];
  // El mercado debe ser uno de los del tenant; cualquier otro responde lo mismo que hoy un mercado inválido.
  const comercial = await e.comercialDelTenant(a.tenantId);
  // Hasta B2 los precios de Inventarios existen solo para BO y AR: otro mercado del tenant responde como uno inválido.
  if (!esMercadoDe(comercial, mercado) || (mercado !== 'BO' && mercado !== 'AR')) return json(400, { error: 'mercado_invalido' });
  const c = await catalogo(e, a.tenantId, comercial, mercado, cfg);
  if (esRespuesta(c)) return c;
  const { estable, generadoEn } = c;
  return conEtag(req, estable, { version: 1, mercado: estable['mercado'], moneda: estable['moneda'], generadoEn, cotizacion: estable['cotizacion'], items: estable['items'] });
}

/** `GET /api/novuchat/v1/inventario`: existencias por almacén de todos los productos (sin costos). */
export async function manejarInventario(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat, puedeServir: PuedeServir): Promise<RespuestaApi> {
  if (req.metodo !== 'GET') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'GET' });
  const a = await autenticarToken(e, req.cabeceras);
  if (esRespuesta(a)) return a;
  if (!(await puedeServir(a.tenantId))) return sinServicio();
  const limitado = await limitar(cfg, a.hash, e.ahora());
  if (limitado !== undefined) return limitado;
  // Falla cerrado: sin configuración comercial válida `comercialDelTenant` lanza `ComercialInvalida` y no sale nada.
  const comercial = await e.comercialDelTenant(a.tenantId);
  const [prods, existencias] = await Promise.all([e.firestore.collection(`tenants/${a.tenantId}/productos`).get(), existenciasPorProducto(e, a.tenantId)]);
  const items = prods.docs
    .map((d) => ({ p: leerDocumentoProducto(d.id, d.data(), comercial), bajoMinimo: d.data()['bajoMinimo'] === true }))
    .sort((x, y) => x.p.productoId.localeCompare(y.p.productoId))
    .map(({ p, bajoMinimo }) => ({
      id: p.productoId, nombre: p.nombre, sku: p.sku ?? null, activo: p.activo, conSerie: p.conSerie, stockTotal: p.stockTotal ?? null,
      stockPorAlmacen: stockPorAlmacen(existencias.get(p.productoId)), minimo: p.minimo ?? null, bajoMinimo,
    }));
  const estable = { version: 1, items };
  return conEtag(req, estable, { ...estable, generadoEn: new Date(e.ahora()).toISOString() });
}

/** `POST /api/novuchat/v1/pedidos/confirmar`: HMAC-SHA256 de `{marca}.{cuerpo exacto}`, ventana de 5 minutos. */
export async function manejarPedido(e: Entorno, req: PeticionHttp, cfg: ConfigNovuchat, tenantId: string, autorizado: () => Promise<boolean>): Promise<RespuestaApi> {
  if (req.metodo !== 'POST') return json(405, { error: 'metodo_no_permitido' }, { Allow: 'POST' });
  if (cfg.secretoPedidos === '') return json(503, { error: 'no_configurado' });
  const r = await confirmarPedidoFirmado(
    { db: e.db, secreto: cfg.secretoPedidos, ahora: e.ahora, autorizado },
    { tenantId, marcaTiempo: req.cabeceras['x-marca-tiempo'] ?? '', firma: req.cabeceras['x-firma'] ?? '', cuerpo: req.cuerpoCrudo },
  );
  return json(r.estado, r.cuerpo as Datos);
}
