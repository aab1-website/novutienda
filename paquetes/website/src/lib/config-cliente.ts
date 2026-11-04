/** Configuración pública que el HTML entrega al navegador en un bloque JSON (no se ejecuta, no la bloquea la CSP). */
import type { Mercado, Redondeo } from '@novutienda/nucleo';
import type { ConfigMedicion } from '../contenido/tipos.js';

export interface ConfigCliente {
  readonly nombre: string;
  readonly mercados: readonly Mercado[];
  readonly mercadoInicial: Mercado;
  readonly redondeo: Redondeo;
  readonly whatsappNovuchat: string | null;
  readonly whatsappTienda: string | null;
  readonly medicion: ConfigMedicion;
  readonly recaptchaSiteKey: string | null;
  readonly apiBase: string;
  /** Muestra las afirmaciones sin confirmar (solo vista previa). */
  readonly vistaPrevia: boolean;
}

export const ID_BLOQUE_CONFIG = 'cb-config';

let cache: ConfigCliente | null = null;

/** Lee el bloque de configuración del documento. Lanza si falta: es un defecto del build, no del usuario. */
export function configCliente(doc: Pick<Document, 'getElementById'> = document): ConfigCliente {
  if (cache !== null) return cache;
  const el = doc.getElementById(ID_BLOQUE_CONFIG);
  if (el === null || el.textContent === null) throw new Error('falta el bloque de configuración del sitio');
  cache = JSON.parse(el.textContent) as ConfigCliente;
  return cache;
}
