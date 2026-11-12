// Sitios de Hosting por tenant: matriz de reconstrucción y guardia del despliegue.
//
//   node scripts/sitios-tenant.mjs matriz [--clave c] [--sitios "<json>"]
//   node scripts/sitios-tenant.mjs validar-solo --ambiente staging|production --solo "<lista>" [--sitios "<json>"]
//
// Contrato:
// - SITIOS_TENANT (variable de entorno, o --sitios) es un JSON `[{ clave, tenant, sitio, url }]`:
//     clave   ^[a-z0-9]{1,12}$, única; es lo único que se imprime en logs públicos.
//     tenant  id de tenant del núcleo (^[a-z0-9][a-z0-9-]{0,62}$), único: un tenant, un sitio (comparten la cola de reconstrucción).
//     sitio   id del sitio de Hosting, ^[a-z0-9-]{6,30}$, único.
//     url     https sin ruta (solo origen).
// - `matriz` imprime `{"include":[{clave,tenant,sitio,url}]}` (formato de `strategy.matrix` de GitHub); con --clave, solo esa entrada
//   (error si no existe).
// - `validar-solo` revisa la lista de FIREBASE_DEPLOY_ONLY (separada por comas):
//     staging: lista PERMITIDA, no negra. Solo valen `functions[:x]`, `firestore[:rules|:indexes]`, `storage` y `hosting:panel`;
//       cualquier otra entrada (vacía, `hosting`, `hosting:sitio`, `hosting:<sitio de tenant>`, `hosting:,functions`…) es problema.
//       La lista completa vacía también lo es (desplegaría también los sitios).
//     production (DC3): mientras SITIOS_TENANT tenga a lo sumo 1 entrada (--sitios), producción sigue desplegando `hosting` del sitio de T1
//       y `hosting`/`hosting:sitio` valen. Con más de 1 entrada en --sitios se rechazan `hosting` sin calificar y `hosting:sitio`.
//       Se cuentan las entradas de --sitios, no las de --solo. `hosting:<id de sitio de tenant>` se rechaza siempre que se pasen sitios.
//   Las banderas exigen valor: un valor que empieza con `--` es uso inválido (código 2).
// - Sin dependencias npm. Los errores nunca imprimen valores, solo la posición y el motivo. Código de salida: 0 bien, 1 inválido, 2 uso.
import { pathToFileURL } from 'node:url';

export const RE_CLAVE = /^[a-z0-9]{1,12}$/;
export const RE_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const RE_SITIO = /^[a-z0-9-]{6,30}$/;
export const AMBIENTES = ['staging', 'production'];

class ErrorUso extends Error {}

export class ErrorSitios extends Error {
  constructor(errores) {
    super(`SITIOS_TENANT inválido: ${errores.join('; ')}`);
    this.name = 'ErrorSitios';
    this.errores = errores;
  }
}

function urlSinRuta(u) {
  if (typeof u !== 'string' || !/^https:\/\/[^/?#\s@]+\/?$/.test(u)) return false;
  try {
    return new URL(u).pathname === '/';
  } catch {
    return false;
  }
}

/** Valida SITIOS_TENANT (texto JSON). Devuelve la lista; lanza ErrorSitios sin imprimir valores. */
export function parsearSitios(texto) {
  let datos;
  try {
    datos = JSON.parse(texto ?? '');
  } catch {
    throw new ErrorSitios(['no es JSON']);
  }
  if (!Array.isArray(datos) || datos.length === 0) throw new ErrorSitios(['debe ser una lista no vacía']);
  const errores = [];
  const claves = new Set();
  const sitios = new Set();
  const tenants = new Set();
  const salida = [];
  datos.forEach((e, i) => {
    const donde = `entrada ${i + 1}`;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) {
      errores.push(`${donde}: debe ser un objeto`);
      return;
    }
    if (Object.keys(e).sort().join(',') !== 'clave,sitio,tenant,url') errores.push(`${donde}: campos distintos de clave, tenant, sitio y url`);
    if (typeof e.clave !== 'string' || !RE_CLAVE.test(e.clave)) errores.push(`${donde}: clave inválida`);
    else if (claves.has(e.clave)) errores.push(`${donde}: clave repetida`);
    else claves.add(e.clave);
    if (typeof e.tenant !== 'string' || !RE_TENANT.test(e.tenant)) errores.push(`${donde}: tenant inválido`);
    else if (tenants.has(e.tenant)) errores.push(`${donde}: tenant repetido`);
    else tenants.add(e.tenant);
    if (typeof e.sitio !== 'string' || !RE_SITIO.test(e.sitio)) errores.push(`${donde}: sitio inválido`);
    else if (sitios.has(e.sitio)) errores.push(`${donde}: sitio repetido`);
    else sitios.add(e.sitio);
    if (!urlSinRuta(e.url)) errores.push(`${donde}: url debe ser https sin ruta`);
    salida.push({ clave: e.clave, tenant: e.tenant, sitio: e.sitio, url: e.url });
  });
  if (errores.length > 0) throw new ErrorSitios(errores);
  return salida;
}

/** Matriz de GitHub Actions; con `clave` solo esa entrada (lanza si no existe). */
export function construirMatriz(sitios, clave) {
  const incluidos = clave === undefined ? sitios : sitios.filter((s) => s.clave === clave);
  if (incluidos.length === 0) throw new ErrorSitios(['la clave pedida no existe en SITIOS_TENANT']);
  return { include: incluidos.map((s) => ({ clave: s.clave, tenant: s.tenant, sitio: s.sitio, url: s.url })) };
}

/** Separa la lista de FIREBASE_DEPLOY_ONLY en entradas sin espacios ni vacías. */
export const entradasDeSolo = (lista) => (lista ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');

/** Entradas permitidas en staging (lista blanca). */
export const RE_SOLO_STAGING = /^(functions(:[A-Za-z0-9_.-]+)?|firestore(:(rules|indexes))?|storage|hosting:panel)$/;

/**
 * Guardia de FIREBASE_DEPLOY_ONLY. Devuelve los problemas (vacío = válida); nunca incluye valores.
 * staging: solo la lista permitida (RE_SOLO_STAGING). production (DC3): `hosting` sin calificar o `hosting:sitio` se rechazan solo
 * cuando `sitios` tiene más de 1 entrada; `hosting:<sitio de tenant>` siempre que se pasen sitios.
 */
export function validarSolo(ambiente, lista, sitios = []) {
  if (!AMBIENTES.includes(ambiente)) return ['ambiente no válido'];
  const entradas = entradasDeSolo(lista);
  const problemas = [];
  if (ambiente === 'staging' && entradas.length === 0) problemas.push('la lista está vacía: desplegaría también los sitios');
  if (ambiente === 'staging') {
    // La lista cruda se parte por comas sin descartar vacías: `hosting:,functions` o una coma suelta son problema.
    const crudas = (lista ?? '').split(',').map((s) => s.trim());
    if (crudas.length > 1 || crudas[0] !== '') {
      crudas.forEach((e, i) => {
        if (!RE_SOLO_STAGING.test(e)) problemas.push(`entrada ${i + 1}: no está en la lista permitida de staging`);
      });
    }
    return problemas;
  }
  const ids = new Set(sitios.map((s) => `hosting:${s.sitio}`));
  entradas.forEach((e, i) => {
    if (ids.has(e)) problemas.push(`entrada ${i + 1}: es un sitio de tenant`);
    else if (sitios.length > 1 && e === 'hosting') problemas.push(`entrada ${i + 1}: hosting sin calificar despliega los sitios`);
    else if (sitios.length > 1 && e === 'hosting:sitio') problemas.push(`entrada ${i + 1}: hosting:sitio no se despliega desde el CI`);
  });
  return problemas;
}

function valor(args, nombre) {
  const i = args.indexOf(`--${nombre}`);
  const v = i > -1 ? args[i + 1] : undefined;
  if (v !== undefined && v.startsWith('--')) throw new ErrorUso(`--${nombre} requiere un valor`);
  return v;
}

/** Punto de entrada testeable: devuelve { codigo, salida?, error? } sin tocar el proceso. */
export function ejecutar(args, env = process.env) {
  const [sub] = args;
  try {
    if (sub === 'matriz') {
      const sitios = parsearSitios(valor(args, 'sitios') ?? env.SITIOS_TENANT);
      return { codigo: 0, salida: JSON.stringify(construirMatriz(sitios, valor(args, 'clave'))) };
    }
    if (sub === 'validar-solo') {
      const ambiente = valor(args, 'ambiente');
      const lista = valor(args, 'solo');
      if (ambiente === undefined || lista === undefined) return { codigo: 2, error: 'uso: validar-solo --ambiente staging|production --solo "<lista>" [--sitios "<json>"]' };
      const crudo = valor(args, 'sitios') ?? env.SITIOS_TENANT;
      const sitios = crudo === undefined || crudo.trim() === '' || crudo.trim() === '[]' ? [] : parsearSitios(crudo);
      const problemas = validarSolo(ambiente, lista, sitios);
      if (problemas.length > 0) return { codigo: 1, error: `FIREBASE_DEPLOY_ONLY inválido: ${problemas.join('; ')}` };
      return { codigo: 0, salida: 'FIREBASE_DEPLOY_ONLY válido' };
    }
    return { codigo: 2, error: 'uso: sitios-tenant.mjs matriz [--clave c] | validar-solo --ambiente <a> --solo "<lista>" [--sitios "<json>"]' };
  } catch (e) {
    if (e instanceof ErrorUso) return { codigo: 2, error: e.message };
    return { codigo: 1, error: e instanceof ErrorSitios ? e.message : 'error inesperado' };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = ejecutar(process.argv.slice(2));
  if (r.salida !== undefined) console.log(r.salida);
  if (r.error !== undefined) console.error(`sitios-tenant: ${r.error}`);
  process.exit(r.codigo);
}
