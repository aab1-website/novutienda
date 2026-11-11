// Contenido del sitio de un tenant: cola de reconstrucción y generación del JSON que compila el sitio.
//
//   node scripts/contenido-sitio.mjs pendiente --tenant <t> --url <https://origen>
//   node scripts/contenido-sitio.mjs estado <id> <en_curso|completada|fallida> --tenant <t> --url <https://origen>
//   node scripts/contenido-sitio.mjs generar --salida <ruta> --tenant <t> --url <https://origen>
//
// Contrato (docs/produccion/reconstruccion-sitio.md):
// - Entorno: SITIO_RECONSTRUCCION_SECRETO (obligatorio; firma HMAC-SHA256 hex con `node:crypto`, idéntica a `calcularFirma` del
//   núcleo —`{marca}.{MÉTODO}\n{ruta con consulta}\n{cuerpo}`, ventana de 5 minutos— para no importar el núcleo). Solo `generar`: MEDIOS_BASE_URL (https, obligatorio),
//   SITIO_NEGOCIO (JSON con los textos del negocio, obligatorio), y opcionales VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
//   VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID, VITE_FIREBASE_PROJECT_ID (App Check; si falta alguno, el sitio se compila sin él).
//   --tenant y --url reemplazan a TENANT_ID y SITIO_URL (un proceso por sitio de la matriz). --url es https sin ruta.
// - `pendiente`: imprime el id del trabajo `pendiente` más antiguo, o nada. Código 0.
// - `estado`: POST firmado. Códigos: 0 bien (también «repetido»), 3 el trabajo lo tomó otro (409), 4 inexistente (404), 1 otro fallo.
// - `generar`: GET firmado de `publicado`, disponibilidad pública en lotes de 50, mapeo `contenidoDesdePublicado` (que `plataforma/registro.ts`
//   debe reexportar) y escritura del JSON validado en --salida. Imprime solo conteos.
// - Seguridad: sin redirecciones (`redirect: 'error'`), tiempo máximo de 30 s por petición; http://localhost y 127.0.0.1 solo con
//   NODE_ENV=test. --salida se borra antes de escribir y queda con modo 0600.
// - Nunca imprime el secreto, la firma, las respuestas ni datos de productos; los errores dan el motivo, no valores.
import { createHmac } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RE_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const RE_ID_TRABAJO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
export const ESTADOS = ['en_curso', 'completada', 'fallida'];
export const LOTE_DISPONIBILIDAD = 50;
export const CODIGO_TOMADO_POR_OTRO = 3;
export const CODIGO_INEXISTENTE = 4;
export const TIEMPO_MAXIMO_MS = 30_000;
const RE_ID_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;

/** Misma firma que `calcularFirma` del núcleo (HMAC-SHA256 hex de `{marca}.{cuerpo firmado}`), sin cargar el núcleo. */
export function calcularFirmaLocal(secreto, marcaTiempo, cuerpo) {
  if (typeof secreto !== 'string' || secreto === '') throw new ErrorContenidoSitio('falta SITIO_RECONSTRUCCION_SECRETO');
  return createHmac('sha256', secreto).update(`${marcaTiempo}.${cuerpo}`).digest('hex');
}

export class ErrorContenidoSitio extends Error {
  constructor(mensaje, codigo = 1) {
    super(mensaje);
    this.name = 'ErrorContenidoSitio';
    this.codigo = codigo;
  }
}

/** Origen https sin ruta, sin barra final; http://localhost y 127.0.0.1 solo con `permitirLocal` (NODE_ENV=test). Sin eco del valor. */
export function normalizarUrl(url, permitirLocal = false, nombre = '--url', permitirRuta = false) {
  // `permitirRuta`: la base de medios (almacenamiento) lleva el nombre del bucket como ruta; sin consulta, fragmento ni usuario.
  const patron = permitirRuta ? /^https:\/\/[^/?#\s@]+(?:\/[A-Za-z0-9._~%-]+)*\/?$/ : /^https:\/\/[^/?#\s@]+\/?$/;
  const https = typeof url === 'string' && patron.test(url);
  const local = permitirLocal && typeof url === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/.test(url);
  if (!https && !local) throw new ErrorContenidoSitio(`${nombre} debe ser https${permitirRuta ? '' : ' sin ruta'}`);
  return url.replace(/\/$/, '');
}

export function validarTenant(tenant) {
  if (typeof tenant !== 'string' || !RE_TENANT.test(tenant)) throw new ErrorContenidoSitio('--tenant inválido');
  return tenant;
}

/** Cabeceras firmadas. `calcularFirma(secreto, marca, cuerpo)` es la del núcleo. */
export function cabecerasFirmadas({ secreto, metodo, ruta, cuerpo = '', ahoraMs, calcularFirma = calcularFirmaLocal }) {
  if (typeof secreto !== 'string' || secreto === '') throw new ErrorContenidoSitio('falta SITIO_RECONSTRUCCION_SECRETO');
  const marca = String(ahoraMs);
  const firma = calcularFirma(secreto, marca, `${metodo}\n${ruta}\n${cuerpo}`);
  return { 'X-Marca-Tiempo': marca, 'X-Firma': firma };
}

// Firebase Hosting reordena la consulta alfabéticamente antes de entregarla a la función, y la firma cubre la URL tal como la ve el servidor:
// los parámetros se firman y se envían YA ordenados por clave (estado antes que tenantId).
export const rutaPendientes = (tenant) => `/api/sitio/v1/reconstrucciones?estado=pendiente&tenantId=${encodeURIComponent(tenant)}`;
export const rutaEstado = (id) => `/api/sitio/v1/reconstrucciones/${encodeURIComponent(id)}/estado`;
export const rutaPublicado = (tenant) => `/api/sitio/v1/publicado?tenantId=${encodeURIComponent(tenant)}`;
export const rutaDisponibilidad = (ids) => `/api/disponibilidad?ids=${ids.map(encodeURIComponent).join(',')}`;

/** Petición firmada; devuelve { estado, json } y nunca propaga el cuerpo de un error. */
export async function pedirFirmado({ url, secreto, metodo, ruta, cuerpo, ahoraMs = Date.now(), calcularFirma = calcularFirmaLocal, fetchFn = fetch }) {
  const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
  const cabeceras = cabecerasFirmadas({ secreto, metodo, ruta, cuerpo: texto, ahoraMs, calcularFirma });
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetchFn(`${url}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : texto,
      redirect: 'error',
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
  } catch {
    throw new ErrorContenidoSitio('no se pudo contactar al sitio');
  }
  const json = await r.json().catch(() => null);
  return { estado: r.status, json };
}

function exigirOk(r, que) {
  if (r.estado === 401) throw new ErrorContenidoSitio(`${que}: firma rechazada (401)`);
  if (r.estado === 503) throw new ErrorContenidoSitio(`${que}: el sitio no tiene configurado el secreto (503)`);
  if (r.estado < 200 || r.estado >= 300) throw new ErrorContenidoSitio(`${que}: respuesta ${r.estado}`);
}

/** Id del trabajo pendiente más antiguo, o null. */
export async function trabajoPendiente(opciones) {
  const r = await pedirFirmado({ ...opciones, metodo: 'GET', ruta: rutaPendientes(opciones.tenant) });
  exigirOk(r, 'pendiente');
  const trabajos = Array.isArray(r.json?.trabajos) ? r.json.trabajos : [];
  const id = trabajos.find((t) => t && typeof t.id === 'string' && RE_ID_TRABAJO.test(t.id))?.id;
  return id ?? null;
}

/** Cambia el estado de un trabajo. 409 => código 3; 404 => código 4. */
export async function cambiarEstado(opciones, id, estado) {
  if (!RE_ID_TRABAJO.test(id ?? '')) throw new ErrorContenidoSitio('id de trabajo inválido');
  if (!ESTADOS.includes(estado)) throw new ErrorContenidoSitio('estado no válido');
  const r = await pedirFirmado({ ...opciones, metodo: 'POST', ruta: rutaEstado(id), cuerpo: { tenantId: opciones.tenant, estado } });
  if (r.estado === 409) throw new ErrorContenidoSitio('estado: el trabajo lo tomó otro corredor o la transición no se permite (409)', CODIGO_TOMADO_POR_OTRO);
  if (r.estado === 404) throw new ErrorContenidoSitio('estado: el trabajo no existe (404)', CODIGO_INEXISTENTE);
  exigirOk(r, 'estado');
  return r.json?.repetido === true ? 'repetido' : 'cambiado';
}

/** Ids de producto (sin el prefijo `producto__`) de la respuesta de `publicado`. */
export function idsDeProductos(publicado) {
  const docs = publicado?.documentos;
  if (typeof docs !== 'object' || docs === null) return [];
  return Object.keys(docs).filter((k) => k.startsWith('producto__')).map((k) => k.slice('producto__'.length));
}

/** Solo los ids que la disponibilidad pública acepta (los demás no se consultan). */
export const idsValidos = (ids) => ids.filter((id) => RE_ID_PRODUCTO.test(id));

export function lotes(ids, tamano = LOTE_DISPONIBILIDAD) {
  const salida = [];
  for (let i = 0; i < ids.length; i += tamano) salida.push(ids.slice(i, i + tamano));
  return salida;
}

/** Disponibilidad pública por lotes: { id: boolean }. Ausente en la respuesta = no disponible (lo resuelve el mapeo). */
export async function leerDisponibilidad({ url, ids, fetchFn = fetch }) {
  const salida = {};
  for (const lote of lotes(ids)) {
    let r;
    try {
      r = await fetchFn(`${url}${rutaDisponibilidad(lote)}`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS) });
    } catch {
      throw new ErrorContenidoSitio('disponibilidad: no se pudo contactar al sitio');
    }
    if (!r.ok) throw new ErrorContenidoSitio(`disponibilidad: respuesta ${r.status}`);
    const json = await r.json().catch(() => null);
    const mapa = json?.disponibilidad;
    if (typeof mapa === 'object' && mapa !== null) for (const [id, v] of Object.entries(mapa)) salida[id] = v === 'disponible';
  }
  return salida;
}

/** App Check del build desde las variables VITE_* del sitio; null si falta alguna. */
export function appCheckDesdeEntorno(env) {
  const claveSitio = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  const apiKey = env.VITE_FIREBASE_API_KEY;
  const appId = env.VITE_FIREBASE_APP_ID;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  return [claveSitio, apiKey, appId, projectId].every((x) => typeof x === 'string' && x !== '') ? { claveSitio, apiKey, appId, projectId } : null;
}

export function negocioDesdeEntorno(env) {
  try {
    return JSON.parse(env.SITIO_NEGOCIO ?? '');
  } catch {
    throw new ErrorContenidoSitio('SITIO_NEGOCIO ausente o no es JSON');
  }
}

/** Genera el contenido: devuelve { contenido, productos }. `mapear` es `contenidoDesdePublicado` del módulo del sitio. */
export async function generarContenido({ tenant, url, secreto, env, calcularFirma = calcularFirmaLocal, mapear, ahoraMs, fetchFn = fetch }) {
  // La base lleva el bucket como ruta; el esquema del sitio valida el ORIGEN (CSP) y arma las url de fotos con la base completa.
  const baseMedios = normalizarUrl(env.MEDIOS_BASE_URL ?? '', env.NODE_ENV === 'test', 'MEDIOS_BASE_URL', true);
  const origenMedios = new URL(baseMedios).origin;
  const negocio = negocioDesdeEntorno(env);
  const r = await pedirFirmado({ url, secreto, metodo: 'GET', ruta: rutaPublicado(tenant), ahoraMs, calcularFirma, fetchFn });
  exigirOk(r, 'publicado');
  const todos = idsDeProductos(r.json);
  const ids = idsValidos(todos);
  const disponibilidad = await leerDisponibilidad({ url, ids, fetchFn });
  const entorno = { origen: url, origenMedios, baseMedios, appCheck: appCheckDesdeEntorno(env), recaptchaSiteKey: env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || null, disponibilidad };
  let contenido;
  try {
    contenido = mapear(r.json, negocio, entorno);
  } catch (e) {
    // Solo rutas de campos: los ids de productos, secciones y categorías se enmascaran (el log de CI es público).
    const errores = Array.isArray(e?.errores) ? e.errores.filter((m) => typeof m === 'string') : [];
    const rutas = [...new Set(errores.map((m) => m.split(':')[0].replace(/(producto|seccion)__[^.\s\]]*/g, '$1__*').replace(/categorias\.[^.\s]*/g, 'categorias.*')))];
    throw new ErrorContenidoSitio(`generar: el contenido publicado no es válido (${errores.length} errores)${rutas.length > 0 ? `. Campos afectados: ${rutas.slice(0, 20).join(', ')}` : ''}`);
  }
  return { contenido, productos: ids.length, invalidos: todos.length - ids.length };
}

function valor(args, nombre) {
  const i = args.indexOf(`--${nombre}`);
  const v = i > -1 ? args[i + 1] : undefined;
  if (v !== undefined && v.startsWith('--')) throw new ErrorContenidoSitio(`--${nombre} requiere un valor`, 2);
  return v;
}

/** Carga perezosa de lo que necesita TypeScript (núcleo y mapeo del sitio) con los ganchos de `cargarManifiestos`. */
async function cargarDependencias() {
  const { cargarManifiestos } = await import('./generar-reglas.mjs');
  await cargarManifiestos(); // registra los ganchos de TypeScript
  // Plataforma no importa un módulo directamente: el mapeo llega por el registro (`plataforma/registro.ts` lo reexporta).
  const registro = await import(pathToFileURL(resolve('plataforma/registro.ts')).href);
  if (typeof registro.contenidoDesdePublicado !== 'function') {
    throw new ErrorContenidoSitio('plataforma/registro.ts no exporta contenidoDesdePublicado');
  }
  return { mapear: registro.contenidoDesdePublicado };
}

/** Punto de entrada: devuelve { codigo, salida?, error? }; las dependencias se pueden inyectar en pruebas. */
export async function ejecutar(args, env = process.env, deps = undefined, fetchFn = fetch) {
  try {
    const [sub] = args;
    if (!['pendiente', 'estado', 'generar'].includes(sub)) throw new ErrorContenidoSitio('uso: contenido-sitio.mjs pendiente | estado <id> <estado> | generar --salida <ruta>  (con --tenant y --url)', 2);
    const tenant = validarTenant(valor(args, 'tenant'));
    const url = normalizarUrl(valor(args, 'url'), env.NODE_ENV === 'test');
    const secreto = env.SITIO_RECONSTRUCCION_SECRETO ?? '';
    if (secreto === '') throw new ErrorContenidoSitio('falta SITIO_RECONSTRUCCION_SECRETO');
    // El registro (TypeScript) se carga solo en `generar`: `pendiente` y `estado` no necesitan node_modules.
    const d = sub === 'generar' ? (deps ?? (await cargarDependencias())) : deps;
    const base = { tenant, url, secreto, calcularFirma: d?.calcularFirma, fetchFn };
    if (sub === 'pendiente') {
      const id = await trabajoPendiente(base);
      return { codigo: 0, salida: id ?? undefined };
    }
    if (sub === 'estado') {
      const [, id, estado] = args;
      const r = await cambiarEstado(base, id, estado);
      return { codigo: 0, salida: `estado ${r}` };
    }
    const salida = valor(args, 'salida');
    if (salida === undefined || salida === '') throw new ErrorContenidoSitio('falta --salida', 2);
    const { contenido, productos, invalidos } = await generarContenido({ tenant, url, secreto, env, calcularFirma: d?.calcularFirma, mapear: d.mapear, fetchFn });
    const destino = resolve(salida);
    mkdirSync(dirname(destino), { recursive: true });
    rmSync(destino, { force: true }); // un archivo previo con otros permisos no se reutiliza
    writeFileSync(destino, `${JSON.stringify(contenido)}\n`, { mode: 0o600 });
    const aviso = invalidos > 0 ? ` (aviso: ${invalidos} ids de producto inválidos sin consultar)` : '';
    return { codigo: 0, salida: `contenido generado: ${productos} productos${aviso}` };
  } catch (e) {
    if (e instanceof ErrorContenidoSitio) return { codigo: e.codigo, error: e.message };
    // Solo el nombre y el código del error, nunca valores.
    const nombre = typeof e?.name === 'string' ? e.name : 'Error';
    const codigo = typeof e?.code === 'string' ? ` ${e.code}` : '';
    return { codigo: 1, error: `error inesperado (${nombre}${codigo})` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ejecutar(process.argv.slice(2));
  if (r.salida !== undefined) console.log(r.salida);
  if (r.error !== undefined) console.error(`contenido-sitio: ${r.error}`);
  process.exit(r.codigo);
}
