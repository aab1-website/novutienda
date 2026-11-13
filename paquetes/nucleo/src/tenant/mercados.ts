/**
 * Mercados y monedas de un tenant: configuración DECLARADA por el operador, nunca una constante del sistema.
 *
 * - Un mercado fija en qué moneda se vende (`monedaVenta`), en cuál se guarda el precio base (`monedaBase`),
 *   qué zona horaria decide «hoy», cómo se redondea y, si la base difiere de la venta, de dónde sale el tipo de cambio.
 * - `monedas` son las monedas con que la caja puede cobrar: incluye la de venta de cada mercado y puede tener más.
 * - Convención del par: `VENTA/BASE`, el valor es cuántas unidades de la moneda de venta vale una de la base
 *   (por ejemplo `BOB/USD` = 6,96 bolivianos por dólar), igual que las cotizaciones ya guardadas.
 * - Falla cerrado: sin `mercados` la configuración es inválida; jamás se asume una por defecto.
 */
import type { Resultado } from '../contratos/claim.js';
import { esReglaRedondeoValida, type ReglaRedondeo } from '../tipo-cambio/regla-redondeo.js';

/** Fuentes de cotización que el sistema sabe leer. */
export const FUENTES_TIPO_CAMBIO = ['BCB', 'BNA', 'BCRA', 'manual'] as const;
export type FuenteTipoCambio = (typeof FUENTES_TIPO_CAMBIO)[number];

/** Tipo de cambio de un mercado: par `VENTA/BASE` y fuentes en orden (principal, control cruzado). */
export interface TipoCambioMercado {
  readonly par: string;
  readonly fuentes: readonly FuenteTipoCambio[];
}

/** Un mercado declarado por el tenant. */
export interface MercadoTenant {
  /** Dos letras mayúsculas (p. ej. `BO`). */
  readonly id: string;
  readonly nombre: string;
  /** Moneda ISO 4217 en que se cobra y se muestra el precio del mercado. */
  readonly monedaVenta: string;
  /** Moneda ISO 4217 en que se guarda el precio base del mercado. */
  readonly monedaBase: string;
  /** Zona horaria IANA con que se decide «hoy» en el mercado. */
  readonly zonaHoraria: string;
  /** `null` si `monedaBase === monedaVenta` (el precio base es el precio, sin cotización). */
  readonly tipoCambio: TipoCambioMercado | null;
  /** Redondeo del precio final, en la moneda de venta. */
  readonly redondeo: ReglaRedondeo;
}

export interface ConfiguracionComercial {
  readonly mercados: readonly MercadoTenant[];
  /** Monedas de caja: contienen la `monedaVenta` de cada mercado. */
  readonly monedas: readonly string[];
}

const ID_MERCADO = /^[A-Z]{2}$/;
const MONEDA = /^[A-Z]{3}$/;
const PAR = /^([A-Z]{3})\/([A-Z]{3})$/;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** ¿Es un identificador IANA que el entorno conoce? */
export function esZonaHorariaValida(x: unknown): x is string {
  if (typeof x !== 'string' || x === '' || x.trim() !== x) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: x });
    return true;
  } catch {
    return false;
  }
}

const esMoneda = (x: unknown): x is string => typeof x === 'string' && MONEDA.test(x);

/** Devuelve el motivo del primer defecto de un mercado, o `null`. */
function errorMercado(m: unknown, r: string): string | null {
  if (!esObjeto(m)) return `${r}: debe ser un objeto`;
  if (typeof m['id'] !== 'string' || !ID_MERCADO.test(m['id'])) return `${r}.id: debe ser de dos letras mayúsculas`;
  if (typeof m['nombre'] !== 'string' || m['nombre'].trim() === '') return `${r}.nombre: no puede estar vacío`;
  if (!esMoneda(m['monedaVenta'])) return `${r}.monedaVenta: debe ser un código ISO 4217 de tres letras mayúsculas`;
  if (!esMoneda(m['monedaBase'])) return `${r}.monedaBase: debe ser un código ISO 4217 de tres letras mayúsculas`;
  if (!esZonaHorariaValida(m['zonaHoraria'])) return `${r}.zonaHoraria: no es una zona horaria IANA válida`;
  if (!esReglaRedondeoValida(m['redondeo'] as ReglaRedondeo | undefined)) return `${r}.redondeo: regla de redondeo inválida para ${m['monedaVenta']}`;
  const tc = m['tipoCambio'];
  if (m['monedaBase'] === m['monedaVenta']) {
    if (tc !== null) return `${r}.tipoCambio: debe ser null si la moneda base y la de venta son la misma`;
    return null;
  }
  if (tc === null || tc === undefined) return `${r}.tipoCambio: es obligatorio si la moneda base (${m['monedaBase']}) difiere de la de venta (${m['monedaVenta']})`;
  if (!esObjeto(tc)) return `${r}.tipoCambio: debe ser un objeto`;
  const par = typeof tc['par'] === 'string' ? PAR.exec(tc['par']) : null;
  if (par === null) return `${r}.tipoCambio.par: debe tener la forma VENTA/BASE (tres letras / tres letras)`;
  if (par[1] !== m['monedaVenta'] || par[2] !== m['monedaBase']) {
    return `${r}.tipoCambio.par: debe ser ${String(m['monedaVenta'])}/${String(m['monedaBase'])} (venta/base)`;
  }
  const f = tc['fuentes'];
  if (!Array.isArray(f) || f.length === 0) return `${r}.tipoCambio.fuentes: requiere al menos una fuente`;
  if (!f.every((x) => (FUENTES_TIPO_CAMBIO as readonly unknown[]).includes(x))) {
    return `${r}.tipoCambio.fuentes: solo se admiten ${FUENTES_TIPO_CAMBIO.join(', ')}`;
  }
  if (new Set(f).size !== f.length) return `${r}.tipoCambio.fuentes: tiene fuentes repetidas`;
  return null;
}

/** Valida una configuración comercial leída de la base o de un archivo. Cada error nombra el campo. */
export function validarConfiguracionComercial(x: unknown): Resultado<ConfiguracionComercial> {
  if (!esObjeto(x)) return { ok: false, error: 'comercial: debe ser un objeto' };
  const mercados = x['mercados'];
  if (!Array.isArray(mercados) || mercados.length === 0) return { ok: false, error: 'comercial.mercados: requiere al menos un mercado' };
  const ids = new Set<string>();
  for (const [i, m] of mercados.entries()) {
    const e = errorMercado(m, `comercial.mercados[${i}]`);
    if (e !== null) return { ok: false, error: e };
    const id = (m as MercadoTenant).id;
    if (ids.has(id)) return { ok: false, error: `comercial.mercados[${i}].id: el mercado ${id} está repetido` };
    ids.add(id);
  }
  const monedas = x['monedas'];
  if (!Array.isArray(monedas) || monedas.length === 0) return { ok: false, error: 'comercial.monedas: requiere al menos una moneda' };
  if (!monedas.every(esMoneda)) return { ok: false, error: 'comercial.monedas: cada moneda debe ser un código ISO 4217 de tres letras mayúsculas' };
  if (new Set(monedas).size !== monedas.length) return { ok: false, error: 'comercial.monedas: tiene monedas repetidas' };
  for (const m of mercados as readonly MercadoTenant[]) {
    if (!monedas.includes(m.monedaVenta)) {
      return { ok: false, error: `comercial.monedas: debe incluir ${m.monedaVenta}, la moneda de venta del mercado ${m.id}` };
    }
  }
  return { ok: true, valor: x as unknown as ConfiguracionComercial };
}

// ---- Consultas puras. Un mercado no declarado devuelve `undefined`/`false`: quien llama decide (falla cerrado). ----

export const mercadosDe = (c: ConfiguracionComercial): readonly string[] => c.mercados.map((m) => m.id);
export const mercadoDe = (c: ConfiguracionComercial, id: string): MercadoTenant | undefined => c.mercados.find((m) => m.id === id);
export const esMercadoDe = (c: ConfiguracionComercial, id: unknown): id is string => typeof id === 'string' && mercadoDe(c, id) !== undefined;
/** Moneda de venta del mercado. */
export const monedaDe = (c: ConfiguracionComercial, id: string): string | undefined => mercadoDe(c, id)?.monedaVenta;
/** Moneda del precio base del mercado. */
export const monedaBaseDe = (c: ConfiguracionComercial, id: string): string | undefined => mercadoDe(c, id)?.monedaBase;
/** Par `VENTA/BASE` del mercado; `null` si no tiene tipo de cambio o no existe. */
export const parDe = (c: ConfiguracionComercial, id: string): string | null => mercadoDe(c, id)?.tipoCambio?.par ?? null;
export const zonaDe = (c: ConfiguracionComercial, id: string): string | undefined => mercadoDe(c, id)?.zonaHoraria;
export const tieneTipoCambio = (c: ConfiguracionComercial, id: string): boolean => mercadoDe(c, id)?.tipoCambio != null;
export const fuentesDe = (c: ConfiguracionComercial, id: string): readonly FuenteTipoCambio[] => mercadoDe(c, id)?.tipoCambio?.fuentes ?? [];
export const monedasCaja = (c: ConfiguracionComercial): readonly string[] => c.monedas;
/** Redondeo de cada moneda de venta, con la forma que recibe `precioFinal` (parcial: solo las monedas de venta). */
export const redondeoPorMoneda = (c: ConfiguracionComercial): Readonly<Record<string, ReglaRedondeo>> =>
  Object.fromEntries(c.mercados.map((m) => [m.monedaVenta, m.redondeo]));
/** ¿El tenant declara más de un mercado o más de una moneda de caja? (la interfaz muestra selectores solo entonces). */
export const esMultimercado = (c: ConfiguracionComercial): boolean => c.mercados.length > 1 || c.monedas.length > 1;
