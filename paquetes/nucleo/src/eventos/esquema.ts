import type { Resultado } from '../contratos/claim.js';

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

/** Mapa de claves de moneda a valores validados por `valor`. Al menos una entrada. */
export const porMoneda =
  (valor: Campo): Campo =>
  (v, r) => {
    if (!esObjeto(v)) return `${r} debe ser un objeto`;
    const claves = Object.keys(v);
    if (claves.length === 0) return `${r} requiere al menos una moneda`;
    for (const k of claves) {
      const e = moneda(k, `${r} (clave ${k})`) ?? valor(v[k], `${r}.${k}`);
      if (e !== null) return e;
    }
    return null;
  };

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
