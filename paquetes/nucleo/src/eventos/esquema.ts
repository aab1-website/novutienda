import type { Resultado } from '../contratos/claim.js';
import { esFechaIso } from '../tipo-cambio/texto.js';
import type { EstadoCotizacion, FuenteCotizacion, Par } from '../tipo-cambio/tipos.js';

/** Validador de un campo: devuelve `null` si es válido o el motivo del rechazo. */
export type Campo = (valor: unknown, ruta: string) => string | null;

const esObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

export const texto: Campo = (v, r) => (typeof v === 'string' && v.trim() !== '' ? null : `${r} debe ser texto no vacío`);

/** Entero seguro dentro de [min, max]. Los montos son enteros de centavos. */
export const entero =
  (min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): Campo =>
  (v, r) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max
      ? null
      : `${r} debe ser un entero entre ${min} y ${max}`;

export const centavos: Campo = entero(0);
export const cantidadPositiva: Campo = entero(1);

export const moneda: Campo = (v, r) =>
  typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? null : `${r} debe ser un código de moneda de 3 letras mayúsculas`;

export const par: Campo = (v, r) =>
  typeof v === 'string' && /^[A-Z]{3}\/[A-Z]{3}$/.test(v) ? null : `${r} debe tener formato AAA/BBB`;

export const numeroPositivo: Campo = (v, r) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : `${r} debe ser un número positivo`;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const instanteIso: Campo = (v, r) =>
  typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v)) ? null : `${r} debe ser ISO 8601 UTC`;

export const arreglo =
  (elemento: Campo, minimo = 0): Campo =>
  (v, r) => {
    if (!Array.isArray(v)) return `${r} debe ser un arreglo`;
    if (v.length < minimo) return `${r} requiere al menos ${minimo} elemento(s)`;
    for (let i = 0; i < v.length; i++) {
      const e = elemento(v[i], `${r}[${i}]`);
      if (e !== null) return e;
    }
    return null;
  };

/** Objeto con exactamente las claves del esquema: las ausentes y las sobrantes se rechazan. */
export const objeto =
  (esquema: Readonly<Record<string, Campo>>): Campo =>
  (v, r) => {
    if (!esObjeto(v)) return `${r} debe ser un objeto`;
    for (const clave of Object.keys(v)) {
      if (!(clave in esquema)) return `${r}.${clave} no es un campo del contrato`;
    }
    for (const [clave, campo] of Object.entries(esquema)) {
      const e = campo(v[clave], `${r}.${clave}`);
      if (e !== null) return e;
    }
    return null;
  };

/** Campo que puede faltar (clave ausente); si está presente debe cumplir `campo`. Nunca se usa `undefined` explícito en Firestore. */
export const opcional =
  (campo: Campo): Campo =>
  (v, r) =>
    v === undefined ? null : campo(v, r);

/** Campo que admite `null` explícito además de lo que valide `campo`. */
export const oNulo =
  (campo: Campo): Campo =>
  (v, r) =>
    v === null ? null : campo(v, r);

/** Uno de los valores listados. */
export const uno =
  (valores: readonly string[]): Campo =>
  (v, r) =>
    typeof v === 'string' && valores.includes(v) ? null : `${r} debe ser uno de: ${valores.join(', ')}`;

/** Fecha civil «aaaa-mm-dd» real de calendario. */
export const fechaIso: Campo = (v, r) => (esFechaIso(v) ? null : `${r} debe ser una fecha aaaa-mm-dd`);

export const MONEDAS_EVENTO = ['BOB', 'USD', 'ARS'] as const;
export const monedaOperativa: Campo = uno(MONEDAS_EVENTO);
export const MEDIOS_PAGO = ['efectivo', 'qr', 'transferencia', 'credito'] as const;
export const medioPago: Campo = uno(MEDIOS_PAGO);

const PARES: readonly Par[] = ['BOB/USD', 'ARS/USD'];
const FUENTES: readonly FuenteCotizacion[] = ['BCB', 'BNA', 'BCRA', 'manual'];
const ESTADOS: readonly EstadoCotizacion[] = ['vigente', 'ultimo_verificado'];

/** Copia de cotización del núcleo (`CopiaCotizacion`): la misma forma que guardan ventas y pedidos. */
export const copiaCotizacion: Campo = objeto({
  cotizacionId: texto,
  par: uno(PARES),
  valor: numeroPositivo,
  fecha: fechaIso,
  fuente: uno(FUENTES),
  estado: uno(ESTADOS),
});

/** Series no vacías sin repetidos en la línea; si hay series, su cantidad debe igualar `cantidad`. */
export function errorSeries(series: readonly string[], cantidad: number, ruta: string): string | null {
  if (series.length === 0) return null;
  if (series.length !== cantidad) return `${ruta}.series debe tener tantas series como la cantidad`;
  if (new Set(series).size !== series.length) return `${ruta}.series tiene series repetidas`;
  return null;
}

/** Revisa las series de todas las líneas: reglas por línea y sin duplicados entre líneas. */
export function errorSeriesLineas(
  lineas: readonly { readonly cantidad: number; readonly series: readonly string[] }[],
  ruta: string,
): string | null {
  const vistas = new Set<string>();
  for (const [i, l] of lineas.entries()) {
    const e = errorSeries(l.series, l.cantidad, `${ruta}[${i}]`);
    if (e !== null) return e;
    for (const s of l.series) {
      if (vistas.has(s)) return `${ruta}[${i}].series repite la serie ${s} de otra línea`;
      vistas.add(s);
    }
  }
  return null;
}

/** Convierte un esquema de campos en un validador de datos de evento. */
export function crearValidador<D>(esquema: Readonly<Record<string, Campo>>, extra?: (d: D) => string | null) {
  const campo = objeto(esquema);
  return (x: unknown): Resultado<D> => {
    const e = campo(x, 'datos');
    if (e !== null) return { ok: false, error: e };
    const e2 = extra?.(x as D) ?? null;
    return e2 === null ? { ok: true, valor: x as D } : { ok: false, error: e2 };
  };
}

/** Fixtures de un contrato: datos válidos e inválidos con el motivo esperado. */
export interface Fixtures<D> {
  readonly validos: readonly D[];
  readonly invalidos: readonly { readonly nombre: string; readonly datos: unknown }[];
}
