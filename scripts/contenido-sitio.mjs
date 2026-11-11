// Reconstrucción del sitio: cliente firmado del contrato de docs/produccion/reconstruccion-sitio.md (lo corre GitHub Actions).
//
//   node scripts/contenido-sitio.mjs pendiente
//   node scripts/contenido-sitio.mjs estado <id> <en_curso|completada|fallida>
//   node scripts/contenido-sitio.mjs generar --salida <ruta>
//
// `pendiente` imprime el id del trabajo pendiente más antiguo (nada si no hay). `estado` cambia el estado de un trabajo; si otro
// corredor ya lo tomó (409) sale con código 3. `generar` descarga lo publicado (firmado), consulta la disponibilidad pública en
// lotes de 50, lo mapea con `contenidoDesdePublicado` (validado) y escribe el JSON que lee `SITIO_CONTENIDO` del build.
// `pendiente` y `estado` no necesitan `pnpm install` (solo node:crypto y fetch); `generar` carga el paquete del sitio.
//
// Variables de entorno (nunca argumentos; los valores no se imprimen):
//   SITIO_URL                     origen del sitio (https://…; http://localhost solo en pruebas). Obligatoria.
//   TENANT_ID                     identificador del tenant (minúsculas, dígitos y guiones). Obligatoria.
//   SITIO_RECONSTRUCCION_SECRETO  secreto de firma (el mismo de las funciones). Obligatoria. Nunca se imprime.
//   MEDIOS_BASE_URL               origen público de los medios (https://…). Obligatoria en `generar`.
//   SITIO_NEGOCIO                 JSON con los datos del negocio (validarNegocio). Obligatoria en `generar`.
//   RECAPTCHA_CLAVE_SITIO         clave pública de reCAPTCHA. Opcional.
//   SITIO_APPCHECK_CLAVE_SITIO, SITIO_APPCHECK_API_KEY, SITIO_APPCHECK_APP_ID, SITIO_APPCHECK_PROJECT_ID
//                                 bloque público de App Check: las cuatro o ninguna. Opcionales.
//
// Códigos de salida: 0 bien · 1 error · 2 uso o entrada inválida · 3 el trabajo lo tomó otro corredor (409).
// Solo imprime conteos y advertencias: nunca el secreto, la firma, URLs ni datos de productos.
import { createHmac } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

class Fallo extends Error {
  constructor(mensaje, codigo = 1) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const RE_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RE_TRABAJO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/;
const RE_ID_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;
const ESTADOS = ['en_curso', 'completada', 'fallida'];
const LOTE = 50;
const TIEMPO_MS = 30_000;

function origenValido(valor, nombre, { permitirLocal }) {
  let u;
  try {
    u = new URL(valor ?? '');
  } catch {
    throw new Fallo(`${nombre} no es una URL válida`, 2);
  }
  const local = permitirLocal && u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !local) throw new Fallo(`${nombre} debe ser https`, 2);
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') throw new Fallo(`${nombre} no admite credenciales, consulta ni fragmento`, 2);
  return u.origin;
}

function leerEntorno(env, { paraGenerar }) {
  const tenant = env.TENANT_ID ?? '';
  if (!RE_TENANT.test(tenant)) throw new Fallo('TENANT_ID no es un identificador válido', 2);
  const secreto = env.SITIO_RECONSTRUCCION_SECRETO ?? '';
  if (secreto === '') throw new Fallo('defina SITIO_RECONSTRUCCION_SECRETO', 2);
  const sitio = origenValido(env.SITIO_URL, 'SITIO_URL', { permitirLocal: true });
  const cfg = { tenant, secreto, sitio };
  if (paraGenerar) {
    cfg.medios = origenValido(env.MEDIOS_BASE_URL, 'MEDIOS_BASE_URL', { permitirLocal: true });
    try {
      cfg.negocio = JSON.parse(env.SITIO_NEGOCIO ?? '');
    } catch {
      throw new Fallo('SITIO_NEGOCIO no es JSON válido', 2);
    }
    const ac = ['CLAVE_SITIO', 'API_KEY', 'APP_ID', 'PROJECT_ID'].map((k) => (env[`SITIO_APPCHECK_${k}`] ?? '').trim());
    if (ac.some((v) => v !== '') && ac.some((v) => v === '')) throw new Fallo('el bloque de App Check requiere sus cuatro variables o ninguna', 2);
    cfg.appCheck = ac[0] === '' ? null : { claveSitio: ac[0], apiKey: ac[1], appId: ac[2], projectId: ac[3] };
    const recaptcha = (env.RECAPTCHA_CLAVE_SITIO ?? '').trim();
    cfg.recaptcha = recaptcha === '' ? null : recaptcha;
  }
  return cfg;
}

/** Misma firma que `calcularFirma` del núcleo (HMAC-SHA256 hex de `{marca}.{cuerpo firmado}`), sin cargar el núcleo. */
const firmar = (secreto, marca, texto) => createHmac('sha256', secreto).update(`${marca}.${texto}`).digest('hex');

async function pedir(url, init) {
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIEMPO_MS) });
  } catch {
    throw new Fallo('no se pudo conectar con el sitio (sin respuesta o tiempo agotado)');
  }
}

/** Petición firmada: texto firmado `{marca}.{MÉTODO}\n{ruta con consulta}\n{cuerpo}`. */
async function firmada(cfg, metodo, ruta, cuerpo = '') {
  const marca = String(Date.now());
  const firma = firmar(cfg.secreto, marca, `${metodo}\n${ruta}\n${cuerpo}`);
  const init = { method: metodo, headers: { 'X-Marca-Tiempo': marca, 'X-Firma': firma, Accept: 'application/json' } };
  if (metodo === 'POST') {
    init.headers['Content-Type'] = 'application/json';
    init.body = cuerpo;
  }
  return pedir(`${cfg.sitio}${ruta}`, init);
}

async function jsonDe(respuesta, que) {
  try {
    return await respuesta.json();
  } catch {
    throw new Fallo(`${que}: la respuesta no es JSON`);
  }
}

function exigirOk(respuesta, que) {
  if (respuesta.status === 401) throw new Fallo(`${que}: firma rechazada (401); revise el secreto y el reloj`);
  if (respuesta.status === 503) throw new Fallo(`${que}: el sitio no está configurado (503)`);
  if (respuesta.status !== 200) throw new Fallo(`${que}: respuesta ${respuesta.status}`);
}

async function pendiente(cfg) {
  const r = await firmada(cfg, 'GET', `/api/sitio/v1/reconstrucciones?tenantId=${cfg.tenant}&estado=pendiente`);
  exigirOk(r, 'pendiente');
  const cuerpo = await jsonDe(r, 'pendiente');
  const trabajos = Array.isArray(cuerpo?.trabajos) ? cuerpo.trabajos : [];
  const primero = trabajos.find((t) => t?.estado === 'pendiente' && typeof t.id === 'string' && RE_TRABAJO.test(t.id));
  if (primero !== undefined) console.log(primero.id);
}

async function estado(cfg, id, nuevo) {
  if (!RE_TRABAJO.test(id ?? '')) throw new Fallo('el id del trabajo no es válido', 2);
  if (!ESTADOS.includes(nuevo)) throw new Fallo(`el estado debe ser ${ESTADOS.join(' | ')}`, 2);
  const r = await firmada(cfg, 'POST', `/api/sitio/v1/reconstrucciones/${id}/estado`, JSON.stringify({ tenantId: cfg.tenant, estado: nuevo }));
  if (r.status === 409) throw new Fallo('el trabajo no admite esa transición (lo tomó otro corredor)', 3);
  if (r.status === 404) throw new Fallo('el trabajo no existe (404)');
  exigirOk(r, 'estado');
  const cuerpo = await jsonDe(r, 'estado');
  console.log(cuerpo?.repetido === true ? `estado ${nuevo} (repetido)` : `estado ${nuevo}`);
}

/** Ganchos para importar TypeScript con Node (mismo criterio que scripts/generar-reglas.mjs). */
function registrarTypeScript() {
  registerHooks({
    resolve(especificador, contexto, siguiente) {
      try {
        return siguiente(especificador, contexto);
      } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^\.{1,2}\/.*\.js$/.test(especificador)) {
          return siguiente(especificador.replace(/\.js$/, '.ts'), contexto);
        }
        throw error;
      }
    },
  });
  registerHooks({
    load(url, contexto, siguiente) {
      if (!url.startsWith('file://') || !url.endsWith('.ts') || url.includes('/node_modules/')) return siguiente(url, contexto);
      const codigo = stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url });
      return { format: 'module', source: codigo, shortCircuit: true };
    },
  });
}

async function disponibilidadDe(cfg, ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const r = await pedir(`${cfg.sitio}/api/disponibilidad?ids=${lote.join(',')}`, { headers: { Accept: 'application/json' } });
    if (r.status !== 200) throw new Fallo(`disponibilidad: respuesta ${r.status}`);
    const cuerpo = await jsonDe(r, 'disponibilidad');
    const d = cuerpo?.disponibilidad;
    if (typeof d !== 'object' || d === null) throw new Fallo('disponibilidad: formato inesperado');
    for (const id of lote) {
      if (d[id] === 'disponible') mapa[id] = true;
      else if (d[id] === 'agotado') mapa[id] = false;
    }
  }
  return mapa;
}

async function generar(cfg, salida) {
  if (salida === undefined || salida === '' || salida.startsWith('--')) throw new Fallo('indique --salida <ruta>', 2);
  const r = await firmada(cfg, 'GET', `/api/sitio/v1/publicado?tenantId=${cfg.tenant}`);
  exigirOk(r, 'publicado');
  const publicado = await jsonDe(r, 'publicado');
  const claves = Object.keys(publicado?.documentos ?? {}).filter((k) => k.startsWith('producto__'));
  const ids = claves.map((k) => k.slice('producto__'.length)).filter((id) => RE_ID_PRODUCTO.test(id));
  const disponibilidad = await disponibilidadDe(cfg, ids);

  registrarTypeScript();
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { contenidoDesdePublicado, ErrorContenidoPublicado } = await import(pathToFileURL(resolve(raiz, 'paquetes/website/src/index.ts')).href);
  let contenido;
  try {
    contenido = contenidoDesdePublicado(publicado, cfg.negocio, {
      origen: cfg.sitio, origenMedios: cfg.medios, appCheck: cfg.appCheck, recaptchaSiteKey: cfg.recaptcha, disponibilidad,
    });
  } catch (e) {
    if (e instanceof ErrorContenidoPublicado) throw new Fallo(`el contenido publicado no es válido:\n - ${e.errores.join('\n - ')}`);
    throw new Fallo('no se pudo mapear el contenido publicado');
  }
  const destino = resolve(salida);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, `${JSON.stringify(contenido)}\n`, { mode: 0o600 });
  const agotados = ids.filter((id) => disponibilidad[id] !== true).length;
  console.log(`contenido generado: ${ids.length} productos publicados, ${agotados} sin disponibilidad confirmada`);
  if (ids.length === 0) console.warn('advertencia: no hay productos publicados');
  if (cfg.appCheck === null) console.warn('advertencia: sin bloque de App Check');
  if (cfg.recaptcha === null) console.warn('advertencia: sin clave de reCAPTCHA');
}

async function main(argv, env) {
  const [orden, ...resto] = argv;
  if (orden === 'pendiente' && resto.length === 0) return pendiente(leerEntorno(env, { paraGenerar: false }));
  if (orden === 'estado' && resto.length === 2) return estado(leerEntorno(env, { paraGenerar: false }), resto[0], resto[1]);
  if (orden === 'generar' && resto.length === 2 && resto[0] === '--salida') return generar(leerEntorno(env, { paraGenerar: true }), resto[1]);
  throw new Fallo('uso: contenido-sitio.mjs pendiente | estado <id> <en_curso|completada|fallida> | generar --salida <ruta>', 2);
}

try {
  await main(process.argv.slice(2), process.env);
} catch (e) {
  console.error(`contenido-sitio: ${e instanceof Fallo ? e.message : 'error inesperado'}`);
  process.exit(e instanceof Fallo ? e.codigo : 1);
}
