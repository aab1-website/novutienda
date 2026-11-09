// Guardias compartidas de los scripts de operador (personal-tenant, demo-tenant): entorno y archivos con secretos.
// Sin identificadores: los mensajes no nombran proyectos. El id de producción nunca se escribe en el repositorio:
// llega por GCP_PROJECT_ID_PROD (nombre del estándar) cuando el entorno lo define.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ID_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/**
 * Valida el entorno antes de tocar nada. `hostsEmulador` son las variables que deben estar TODAS o NINGUNA.
 * Devuelve `{ proyecto, ambiente, enEmulador }` o lanza un Error con un mensaje sin identificadores.
 */
export function validarEntorno({ proyectoArg, hostsEmulador, env = process.env }) {
  const proyecto = (env.GOOGLE_CLOUD_PROJECT ?? '').trim();
  if (!proyecto) throw new Error('defina GOOGLE_CLOUD_PROJECT');
  if (proyectoArg === undefined || proyectoArg.startsWith('--')) throw new Error('indique --proyecto <id> (debe coincidir con GOOGLE_CLOUD_PROJECT)');
  if (proyectoArg.trim() !== proyecto) throw new Error('--proyecto no coincide con GOOGLE_CLOUD_PROJECT');
  const ambiente = env.NOVUTIENDA_AMBIENTE;
  if (ambiente !== 'staging' && ambiente !== 'emulador') throw new Error('NOVUTIENDA_AMBIENTE debe ser staging o emulador');
  const prod = (env.GCP_PROJECT_ID_PROD ?? '').trim();
  if (prod !== '' && prod === proyecto) throw new Error('el proyecto es el de producción: este script nunca opera ahí');
  const definidos = hostsEmulador.filter((v) => env[v] !== undefined && env[v] !== '');
  if (definidos.length !== 0 && definidos.length !== hostsEmulador.length) {
    throw new Error(`defina todas las variables de emulador (${hostsEmulador.join(', ')}) o ninguna`);
  }
  const enEmulador = definidos.length > 0;
  if (enEmulador && (!proyecto.startsWith('demo-') || ambiente !== 'emulador')) {
    throw new Error('con emulador el proyecto debe ser demo-* y NOVUTIENDA_AMBIENTE=emulador');
  }
  if (!enEmulador && ambiente !== 'staging') throw new Error('sin emulador, NOVUTIENDA_AMBIENTE debe ser staging');
  if (!enEmulador && proyecto.startsWith('demo-')) throw new Error('un proyecto demo-* solo se usa con el emulador');
  if (!enEmulador) {
    // Sin emulador solo se opera en staging: el id de staging llega por variable (nunca en el repositorio) y debe ser el mismo.
    const staging = (env.GCP_PROJECT_ID_STAGING ?? '').trim();
    if (staging === '') throw new Error('defina GCP_PROJECT_ID_STAGING: sin emulador solo se opera en el proyecto de staging');
    if (!ID_PROYECTO.test(staging) || !ID_PROYECTO.test(proyecto)) throw new Error('el id de proyecto no tiene un formato válido');
    if (proyecto !== staging) throw new Error('el proyecto no es el de staging (GCP_PROJECT_ID_STAGING): este script solo opera ahí');
  }
  return { proyecto, ambiente, enEmulador };
}

const dentroDe = (raiz, ruta) => {
  const rel = relative(raiz, ruta);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
};
// Resuelve enlaces simbólicos del tramo existente de la ruta (la ruta puede no existir todavía).
const real = (ruta) => {
  let actual = resolve(ruta);
  const resto = [];
  while (!existsSync(actual) && dirname(actual) !== actual) {
    resto.unshift(basename(actual));
    actual = dirname(actual);
  }
  return resolve(realpathSync(actual), ...resto);
};
// Entorno sin variables GIT_* (GIT_DIR, GIT_INDEX_FILE…) que podrían desviar a git hacia otro repositorio.
const envSinGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const lstatExiste = (ruta) => {
  try {
    lstatSync(ruta);
    return true;
  } catch {
    return false;
  }
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSinGit() }).trim();

/**
 * Un archivo con secretos solo puede estar fuera de todo árbol del repositorio (checkout actual y principal) o
 * dentro de uno pero ignorado por git (como CLIENTES/). Lanza si no se cumple o si git no puede decidirlo.
 */
export function exigirFueraDelRepositorio(ruta, etiqueta = 'el archivo') {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const destino = real(ruta);
  // Enlace simbólico en la propia ruta: no se acepta; el directorio padre se resuelve y se valida junto con el nombre.
  const nominal = resolve(real(dirname(resolve(ruta))), basename(resolve(ruta)));
  if (lstatExiste(ruta) && lstatSync(ruta).isSymbolicLink()) throw new Error(`${etiqueta} no puede ser un enlace simbólico`);
  let raices;
  try {
    const toplevel = real(git(aqui, 'rev-parse', '--show-toplevel'));
    const comun = real(resolve(aqui, git(aqui, 'rev-parse', '--git-common-dir')));
    raices = [...new Set([toplevel, basename(comun) === '.git' ? dirname(comun) : comun])];
  } catch {
    throw new Error(`no se pudo determinar la raíz del repositorio: no se verifica ${etiqueta}`);
  }
  for (const d of new Set([destino, nominal])) {
    const contenedoras = raices.filter((r) => dentroDe(r, d)).sort((a, b) => b.length - a.length);
    if (contenedoras.length === 0) continue;
    const r = spawnSync('git', ['check-ignore', '-q', '--', d], { cwd: contenedoras[0], stdio: 'ignore', env: envSinGit() });
    if (r.status !== 0) throw new Error(`${etiqueta} debe estar fuera del repositorio o ignorado por git`);
  }
}
