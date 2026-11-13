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

/**
 * Para qué par sirve cada fuente automática (lo que el lector del núcleo entrega de verdad): el BCB publica Bs por USD;
 * el BNA y el BCRA (A 3500), pesos argentinos por USD. `manual` no atada a un par: la carga una persona.
 */
export const PAR_DE_FUENTE: Readonly<Record<Exclude<FuenteTipoCambio, 'manual'>, string>> = {
  BCB: 'BOB/USD',
  BNA: 'ARS/USD',
  BCRA: 'ARS/USD',
};

/** Monedas ISO 4217 con tres o más decimales: el dinero se guarda en centavos (×100) y no las representa. */
export const MONEDAS_SIN_CENTAVOS_EXACTOS: readonly string[] = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND', 'CLF', 'UYW'];

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

function mismaRegla(a: ReglaRedondeo, b: ReglaRedondeo): boolean {
  if (a.tipo !== b.tipo) return false;
  if (a.tipo === 'ninguno' || b.tipo === 'ninguno') return true;
  if (a.modo !== b.modo) return false;
  return a.tipo === 'decimales' ? a.decimales === (b as typeof a).decimales : a.multiplo === (b as typeof a).multiplo;
}

/** Devuelve el motivo del primer defecto de un mercado, o `null`. */
function errorMercado(m: unknown, r: string): string | null {
  if (!esObjeto(m)) return `${r}: debe ser un objeto`;
  if (typeof m['id'] !== 'string' || !ID_MERCADO.test(m['id'])) return `${r}.id: debe ser de dos letras mayúsculas`;
  if (typeof m['nombre'] !== 'string' || m['nombre'].trim() === '') return `${r}.nombre: no puede estar vacío`;
  if (!esMoneda(m['monedaVenta'])) return `${r}.monedaVenta: debe ser un código ISO 4217 de tres letras mayúsculas`;
  if (!esMoneda(m['monedaBase'])) return `${r}.monedaBase: debe ser un código ISO 4217 de tres letras mayúsculas`;
  for (const campo of ['monedaVenta', 'monedaBase'] as const) {
    if (MONEDAS_SIN_CENTAVOS_EXACTOS.includes(m[campo] as string)) {
      return `${r}.${campo}: ${String(m[campo])} tiene más de 2 decimales y el dinero se guarda en centavos; no se admite`;
    }
  }
  if (!esZonaHorariaValida(m['zonaHoraria'])) return `${r}.zonaHoraria: no es una zona horaria IANA válida`;
  if (!esReglaRedondeoValida(m['redondeo'] as ReglaRedondeo | undefined)) return `${r}.redondeo: regla de redondeo inválida para ${m['monedaVenta']}`;
  const rd = m['redondeo'] as ReglaRedondeo;
  if (rd.tipo === 'decimales' && rd.decimales > 2) return `${r}.redondeo: no puede tener más de 2 decimales (el dinero se guarda en centavos)`;
  if (rd.tipo === 'multiplo' && (rd.multiplo < 0.01 || Math.abs(rd.multiplo * 100 - Math.round(rd.multiplo * 100)) > 1e-9)) {
    return `${r}.redondeo: el múltiplo debe ser de al menos 0,01 y de centavos exactos`;
  }
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
  for (const fuente of f as readonly FuenteTipoCambio[]) {
    if (fuente !== 'manual' && PAR_DE_FUENTE[fuente] !== tc['par']) {
      return `${r}.tipoCambio.fuentes: la fuente ${fuente} solo sirve para ${PAR_DE_FUENTE[fuente]}, no para ${String(tc['par'])}; otro par admite solo manual`;
    }
  }
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
  const sinCentavos = monedas.find((x) => MONEDAS_SIN_CENTAVOS_EXACTOS.includes(x as string));
  if (sinCentavos !== undefined) return { ok: false, error: `comercial.monedas: ${String(sinCentavos)} tiene más de 2 decimales y el dinero se guarda en centavos; no se admite` };
  const reglaPorMoneda = new Map<string, MercadoTenant>();
  for (const [i, m] of (mercados as readonly MercadoTenant[]).entries()) {
    const previo = reglaPorMoneda.get(m.monedaVenta);
    if (previo === undefined) reglaPorMoneda.set(m.monedaVenta, m);
    else if (!mismaRegla(previo.redondeo, m.redondeo)) {
      return { ok: false, error: `comercial.mercados[${i}].redondeo: debe ser igual al del mercado ${previo.id}, que vende en la misma moneda (${m.monedaVenta})` };
    }
  }
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
