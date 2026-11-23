// Siembra de `sitio/negocio` de un tenant desde un JSON (la versión 1 del documento que luego edita la consola).
// Lo ejecuta solo el operador. Lógica pura: la base y el validador llegan por inyección (el validador viene del registro,
// porque la zona Plataforma no importa un módulo directamente). Nunca devuelve ni imprime valores: solo nombres de campo y rutas.
import { esTenantIdValido, registrarAuditoria } from '@novutienda/nucleo';
import type { TransaccionAuditoria } from '@novutienda/nucleo';

/** Resultado mínimo del validador de la consola (`evaluarNegocioSitio`). */
export interface EvaluacionSiembra {
  readonly negocio: object | null;
  readonly errores: readonly string[];
}
export type EvaluarNegocio = (entrada: unknown, nivel: 'heredado' | 'estricto') => EvaluacionSiembra;

export interface TransaccionSiembra extends TransaccionAuditoria {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  set(ruta: string, datos: Readonly<Record<string, unknown>>): void;
}
export interface BaseDatosSiembra {
  runTransaction<T>(fn: (tx: TransaccionSiembra) => Promise<T>): Promise<T>;
}

export type ResultadoSiembra =
  | { readonly estado: 'invalido'; readonly errores: readonly string[] }
  | { readonly estado: 'ya-existe' }
  | { readonly estado: 'listo'; readonly aplicado: boolean; readonly campos: readonly string[]; readonly avisos: readonly string[] };

const rutaDe = (e: string): string => e.split(': ')[0] ?? '';

/**
 * Valida con el nivel `heredado` (paridad con el sitio; ignora `mercados`, `mercadoInicial`, `logo` y `whatsappTienda`, que no se
 * guardan). Las rutas que fallan el nivel `estricto` se devuelven como avisos (el panel las exigirá al editar). Si ya existe
 * `tenants/{t}/sitio/negocio` devuelve `ya-existe` y no escribe. Con `aplicar` escribe la versión 1 y audita `sitio.negocio.sembrar`
 * con los nombres de los campos. No toca `publicado/negocio`: lo publicado se genera al pulsar Publicar.
 */
export async function sembrarNegocioSitio(
  deps: { readonly db: BaseDatosSiembra; readonly reloj: { ahora(): number }; readonly evaluar: EvaluarNegocio },
  o: { readonly tenant: string; readonly crudo: unknown; readonly aplicar: boolean },
): Promise<ResultadoSiembra> {
  if (!esTenantIdValido(o.tenant)) throw new Error('el tenant no es un identificador válido');
  const heredado = deps.evaluar(o.crudo, 'heredado');
  if (heredado.negocio === null) return { estado: 'invalido', errores: [...new Set(heredado.errores.map(rutaDe))] };
  const negocio = heredado.negocio as Readonly<Record<string, unknown>>;
  const avisos = [...new Set(deps.evaluar(o.crudo, 'estricto').errores.map(rutaDe))];
  const campos = Object.keys(negocio);
  const ruta = `tenants/${o.tenant}/sitio/negocio`;
  const ahora = new Date(deps.reloj.ahora()).toISOString();
  return deps.db.runTransaction(async (tx): Promise<ResultadoSiembra> => {
    if ((await tx.get(ruta)).existe) return { estado: 'ya-existe' };
    if (!o.aplicar) return { estado: 'listo', aplicado: false, campos, avisos };
    tx.set(ruta, { ...negocio, version: 1, actualizadoEn: ahora, por: 'siembra' });
    registrarAuditoria(tx, {
      tenantId: o.tenant,
      uid: 'operador',
      rol: 'adm', // valor admitido por el núcleo; quién actuó lo dice `uid`
      motivo: 'operador de plataforma',
      accion: 'sitio.negocio.sembrar',
      ruta,
      resumenDespues: { campos, version: 1 },
    });
    return { estado: 'listo', aplicado: true, campos, avisos };
  });
}
