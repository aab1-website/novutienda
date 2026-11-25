// Anula un pedido confirmado de NovuChat llamando al endpoint firmado del sitio del tenant (operación manual del operador).
//
//   node scripts/anular-pedido.mjs --proyecto <id-stg> --tenant <t> --pedido <id> --sitios "<json>" [--seco]
//
// - Solo opera en staging: usa `validarEntorno` de scripts/guardia-operador.mjs (GOOGLE_CLOUD_PROJECT igual a --proyecto,
//   NOVUTIENDA_AMBIENTE=staging, proyecto igual a GCP_PROJECT_ID_STAGING, nunca el de GCP_PROJECT_ID_PROD). No hay modo producción.
// - Host destino (decisión): no se puede garantizar que SITIOS_TENANT del entorno no venga de producción, así que se EXIGE --sitios
//   explícito (no se lee la variable) y se rechaza el host si no termina en `-stg.web.app`. El host sale de ahí, por el tenant
//   (scripts/sitios-tenant.mjs).
// - NOVUCHAT_PEDIDOS_SECRETO se lee de Secret Manager (`gcloud secrets versions access`) y queda solo en memoria: no se imprime, no va por
//   argv, no se escribe en archivos ni en logs. Con --seco no se lee.
// - Firma HMAC-SHA256 de "{marca}.{cuerpo}" (cabeceras x-marca-tiempo y x-firma) y hace POST a /api/novuchat/v1/pedidos/anular.
//   Imprime solo el código HTTP y el JSON de la respuesta.
// - --seco muestra el host y el cuerpo, sin firma, y no envía nada.
// Códigos de salida: 0 respuesta 2xx (o --seco), 1 el endpoint rechazó, 2 uso inválido, 3 error de operación.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parsearSitios, RE_TENANT } from './sitios-tenant.mjs';
import { validarEntorno } from './guardia-operador.mjs';

export const RE_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const RE_PEDIDO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RUTA = '/api/novuchat/v1/pedidos/anular';
const SECRETO = 'NOVUCHAT_PEDIDOS_SECRETO';

class ErrorUso extends Error {}

function valor(args, nombre) {
  const i = args.indexOf(`--${nombre}`);
  const v = i > -1 ? args[i + 1] : undefined;
  if (i > -1 && (v === undefined || v.startsWith('--'))) throw new ErrorUso(`--${nombre} requiere un valor`);
  return v;
}

/** Lee el secreto con gcloud; la salida se captura en memoria (nunca hereda stdout). Sin valores en los errores. */
export function leerSecretoGcloud(proyecto) {
  try {
    const s = execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', `--secret=${SECRETO}`, `--project=${proyecto}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return s.replace(/\r?\n$/, '');
  } catch {
    throw new Error('no se pudo leer el secreto de Secret Manager');
  }
}

export function firmar(secreto, marca, cuerpo) {
  return createHmac('sha256', secreto).update(`${marca}.${cuerpo}`).digest('hex');
}

/**
 * Punto de entrada testeable. deps: { leerSecreto(proyecto), ahora(), fetchFn }.
 * Devuelve { codigo, salida?, error? } sin tocar el proceso.
 */
export async function ejecutar(args, env = process.env, deps = {}) {
  const leerSecreto = deps.leerSecreto ?? leerSecretoGcloud;
  const ahora = deps.ahora ?? Date.now;
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const proyecto = valor(args, 'proyecto');
    const tenant = valor(args, 'tenant');
    const pedido = valor(args, 'pedido');
    const uso = 'uso: --proyecto <id> --tenant <t> --pedido <id> --sitios "<json>" [--seco]';
    if (proyecto === undefined || tenant === undefined || pedido === undefined) return { codigo: 2, error: uso };
    if (!RE_PROYECTO.test(proyecto)) return { codigo: 2, error: '--proyecto inválido' };
    if (!RE_TENANT.test(tenant)) return { codigo: 2, error: '--tenant inválido' };
    if (!RE_PEDIDO.test(pedido) || pedido.includes('__')) return { codigo: 2, error: '--pedido inválido' };
    try {
      validarEntorno({ proyectoArg: proyecto, hostsEmulador: [], env });
    } catch (e) {
      return { codigo: 2, error: e instanceof Error ? e.message : 'entorno inválido' };
    }
    const sitiosArg = valor(args, 'sitios');
    if (sitiosArg === undefined) return { codigo: 2, error: 'indique --sitios "<json>" (no se lee SITIOS_TENANT del entorno)' };
    const sitio = parsearSitios(sitiosArg).find((s) => s.tenant === tenant);
    if (sitio === undefined) return { codigo: 2, error: 'el tenant no está en --sitios' };
    if (!new URL(sitio.url).hostname.endsWith('-stg.web.app')) return { codigo: 2, error: 'el host destino no es de staging (-stg.web.app)' };
    const url = new URL(RUTA, sitio.url).href;
    const marca = String(ahora()).padStart(13, '0');
    const cuerpo = JSON.stringify({ pedidoId: pedido, anuladoEn: new Date(Number(marca)).toISOString(), tenantId: tenant });
    if (args.includes('--seco')) return { codigo: 0, salida: `seco: POST ${url}\ncuerpo: ${cuerpo}` };

    const secreto = leerSecreto(proyecto);
    if (typeof secreto !== 'string' || secreto === '') return { codigo: 3, error: 'el secreto está vacío' };
    const firma = firmar(secreto, marca, cuerpo);
    const r = await fetchFn(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'x-marca-tiempo': marca, 'x-firma': firma },
      body: cuerpo,
    });
    const texto = await r.text();
    let json;
    try {
      json = JSON.stringify(JSON.parse(texto));
    } catch {
      json = '(la respuesta no es JSON)';
    }
    return { codigo: r.ok ? 0 : 1, salida: `HTTP ${r.status}\n${json}` };
  } catch (e) {
    if (e instanceof ErrorUso) return { codigo: 2, error: e.message };
    if (e instanceof Error && e.name === 'ErrorSitios') return { codigo: 2, error: e.message };
    return { codigo: 3, error: e instanceof Error && e.message.startsWith('no se pudo leer') ? e.message : 'error de operación' };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await ejecutar(process.argv.slice(2));
  if (r.salida !== undefined) console.log(r.salida);
  if (r.error !== undefined) console.error(`anular-pedido: ${r.error}`);
  process.exit(r.codigo);
}
