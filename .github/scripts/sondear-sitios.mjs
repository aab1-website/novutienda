// sondear-sitios.mjs — job `sondear` de reconstruir-sitio.yml: decide qué sitios de tenant se reconstruyen.
//
//   node .github/scripts/sondear-sitios.mjs
//
// Por qué existe y no se llama a `contenido-sitio.mjs pendiente` directamente: la CLI de contenido-sitio.mjs carga el
// registro de la plataforma (TypeScript y dependencias npm) en TODOS sus subcomandos, y el sondeo corre cada 15 minutos
// sin `pnpm install` (ERR_MODULE_NOT_FOUND). Aquí se importan solo las funciones puras de los dos scripts, que no
// necesitan node_modules: `parsearSitios`/`construirMatriz` (sitios-tenant.mjs) y `trabajoPendiente` (contenido-sitio.mjs),
// con la misma firma HMAC y las mismas validaciones. Cuando la CLI cargue el registro solo en `generar`, este archivo
// puede reemplazarse por llamadas a la CLI.
//
// Entorno:
//   SITIOS_TENANT                  JSON `[{ clave, tenant, sitio, url }]` (variable del Environment staging).
//   MODO                           `pendientes` (schedule: solo los sitios con un trabajo pendiente) o `todos`
//                                  (workflow_dispatch y workflow_run: todos, o solo CLAVE).
//   CLAVE                          opcional; ^[a-z0-9]{1,12}$.
//   SITIO_RECONSTRUCCION_SECRETO   obligatorio en MODO=pendientes (GET firmado de la cola).
//   GITHUB_OUTPUT, GITHUB_STEP_SUMMARY
//
// Salidas (GITHUB_OUTPUT): `matriz` = {"include":[{clave,tenant,sitio,url}]}, `hay` = true|false, `fallos` = número de
// sitios cuyo sondeo falló. Los logs y el resumen nombran solo la `clave` (el log de Actions es público): nunca el
// tenant, el sitio, la URL, el id del trabajo ni el secreto.
import { appendFileSync } from 'node:fs';
import { parsearSitios, construirMatriz, RE_CLAVE } from '../../scripts/sitios-tenant.mjs';
import { trabajoPendiente, ErrorContenidoSitio } from '../../scripts/contenido-sitio.mjs';

const MODOS = ['pendientes', 'todos'];

function salir(mensaje) {
  console.log(`::error::sondear: ${mensaje}`);
  process.exit(1);
}

function escribir(archivo, texto) {
  if (archivo) appendFileSync(archivo, texto);
}

const modo = process.env.MODO ?? '';
if (!MODOS.includes(modo)) salir('MODO debe ser pendientes o todos');

const clave = process.env.CLAVE ?? '';
if (clave !== '' && !RE_CLAVE.test(clave)) salir('la clave pedida no cumple ^[a-z0-9]{1,12}$');

let matriz;
try {
  matriz = construirMatriz(parsearSitios(process.env.SITIOS_TENANT), clave === '' ? undefined : clave);
} catch (e) {
  // ErrorSitios no incluye valores, solo posiciones y motivos.
  salir(e instanceof Error ? e.message : 'SITIOS_TENANT inválido');
}

let incluidos = matriz.include;
let fallos = 0;
if (modo === 'pendientes') {
  const secreto = process.env.SITIO_RECONSTRUCCION_SECRETO ?? '';
  if (secreto === '') salir('falta SITIO_RECONSTRUCCION_SECRETO (secreto del Environment staging)');
  const conTrabajo = [];
  for (const s of incluidos) {
    try {
      const id = await trabajoPendiente({ tenant: s.tenant, url: s.url.replace(/\/$/, ''), secreto });
      if (id !== null) conTrabajo.push(s);
      console.log(`${s.clave}: ${id === null ? 'sin trabajo pendiente' : 'trabajo pendiente'}`);
    } catch (e) {
      // Un sitio que no responde no detiene a los demás; el job se marca fallido al final (paso siguiente).
      fallos += 1;
      const motivo = e instanceof ErrorContenidoSitio ? e.message : 'error inesperado';
      console.log(`::error::sondear ${s.clave}: ${motivo}`);
    }
  }
  incluidos = conTrabajo;
}

const hay = incluidos.length > 0;
escribir(process.env.GITHUB_OUTPUT, `matriz=${JSON.stringify({ include: incluidos })}\nhay=${hay}\nfallos=${fallos}\n`);
const claves = incluidos.map((s) => s.clave).join(', ') || 'ninguno';
escribir(process.env.GITHUB_STEP_SUMMARY, `### Sondeo (${modo})\nSitios a reconstruir: ${claves}\n${fallos > 0 ? `Sondeos fallidos: ${fallos}\n` : ''}`);
console.log(`Sitios a reconstruir: ${claves}`);
