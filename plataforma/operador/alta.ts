// Alta de tenant (L2-5): del `config.json` v2 de un tenant al documento `tenants/{t}`.
// Funciones puras salvo `aplicarAlta`, que recibe el almacén por inyección: aquí no hay red.
import { validarEncendido, validarTenant } from '@novutienda/nucleo';
import type { ManifiestoModulo, Resultado, Tenant } from '@novutienda/nucleo';

/** Forma de `tenants/<t>/config.json` (D2): los módulos son ids; las versiones salen del manifiesto. */
export interface ConfigTenantV2 {
  readonly version: 2;
  readonly plan: string;
  readonly zonaHoraria: string;
  readonly monedas: readonly string[];
  readonly modulos: readonly string[];
}

const CLAVES = ['version', 'plan', 'zonaHoraria', 'monedas', 'modulos'];
const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const fallo = (error: string): Resultado<never> => ({ ok: false, error });

/**
 * `config.json` v2 → documento `Tenant`. Rechaza versiones distintas de 2, claves desconocidas, módulos repetidos o
 * desconocidos y un encendido inválido (p. ej. pos sin recibos), y valida el resultado con `validarTenant`.
 * Cada módulo lleva la versión y los submódulos de su manifiesto.
 */
export function construirTenant(config: unknown, manifiestos: readonly ManifiestoModulo[]): Resultado<Tenant> {
  if (!esObjeto(config)) return fallo('config.json debe ser un objeto');
  if (config['version'] !== 2) return fallo('config.json debe ser versión 2');
  const sobran = Object.keys(config).filter((k) => !CLAVES.includes(k));
  if (sobran.length > 0) return fallo(`Claves no admitidas en config.json: ${sobran.join(', ')}`);
  const ids = config['modulos'];
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && i !== '')) {
    return fallo('modulos debe ser una lista de ids');
  }
  if (new Set(ids).size !== ids.length) return fallo('modulos tiene ids repetidos');
  const encendido = validarEncendido(manifiestos, ids as string[]);
  if (!encendido.ok) return fallo(`Encendido inválido: ${encendido.errores.join('; ')}`);
  const modulos: Record<string, { version: string; submodulos: string[] }> = {};
  for (const id of ids as string[]) {
    const m = manifiestos.find((x) => x.id === id);
    if (m === undefined) return fallo(`${id} es un módulo desconocido`);
    modulos[id] = { version: m.version, submodulos: [...m.submodulos] };
  }
  const tenant = { plan: config['plan'], modulos, zonaHoraria: config['zonaHoraria'], monedas: config['monedas'] };
  return validarTenant(tenant);
}

/** Diferencias legibles (sin identificadores) entre el documento actual y el deseado; vacío = iguales. */
export function diferenciasTenant(actual: unknown, deseado: Tenant): string[] {
  if (actual === null || actual === undefined) return ['documento ausente: se creará'];
  if (!esObjeto(actual)) return ['documento actual inválido: se reemplazará'];
  const json = (x: unknown): string => JSON.stringify(x);
  const out: string[] = [];
  for (const k of ['plan', 'zonaHoraria'] as const) {
    if (actual[k] !== deseado[k]) out.push(`${k}: ${json(actual[k])} -> ${json(deseado[k])}`);
  }
  if (json(actual['monedas']) !== json(deseado.monedas)) {
    out.push(`monedas: ${json(actual['monedas'])} -> ${json(deseado.monedas)}`);
  }
  const act = esObjeto(actual['modulos']) ? actual['modulos'] : {};
  for (const id of new Set([...Object.keys(act), ...Object.keys(deseado.modulos)])) {
    const a = act[id];
    const d = deseado.modulos[id];
    if (d === undefined) out.push(`modulos.${id}: sobra -> se retira`);
    else if (a === undefined) out.push(`modulos.${id}: falta -> ${json(d)}`);
    else if (json(a) !== json(d)) out.push(`modulos.${id}: ${json(a)} -> ${json(d)}`);
  }
  const extra = Object.keys(actual).filter((k) => !['plan', 'zonaHoraria', 'monedas', 'modulos'].includes(k));
  for (const k of extra) out.push(`${k}: campo ajeno -> se retira`);
  return out;
}

/** Almacén inyectable del documento del tenant (en producción, Admin SDK; en pruebas, memoria). */
export interface AlmacenTenant {
  leer(tenantId: string): Promise<unknown>;
  escribir(tenantId: string, doc: Tenant): Promise<void>;
}

export interface ResultadoAlta {
  readonly diferencias: string[];
  readonly aplicado: boolean;
}

/**
 * Compara contra el documento actual (lectura) y, solo con `aplicar`, lo escribe si hay diferencias.
 * Lanza si la configuración es inválida: nunca escribe un documento que no valide.
 */
export async function aplicarAlta(opciones: {
  readonly tenantId: string;
  readonly config: unknown;
  readonly manifiestos: readonly ManifiestoModulo[];
  readonly almacen: AlmacenTenant;
  readonly aplicar: boolean;
}): Promise<ResultadoAlta> {
  const r = construirTenant(opciones.config, opciones.manifiestos);
  if (!r.ok) throw new Error(r.error);
  const diferencias = diferenciasTenant(await opciones.almacen.leer(opciones.tenantId), r.valor);
  if (!opciones.aplicar || diferencias.length === 0) return { diferencias, aplicado: false };
  await opciones.almacen.escribir(opciones.tenantId, r.valor);
  return { diferencias, aplicado: true };
}
