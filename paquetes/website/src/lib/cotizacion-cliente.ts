/**
 * Cotización en el navegador: se pide a `/api/cotizacion` (una sola fuente, la del núcleo)
 * y se guarda 15 minutos en `sessionStorage`. No hay ninguna tasa en el código: si la API
 * no responde, el precio no se muestra (nunca se inventa).
 */
import { MERCADOS, PAR_DE, type Mercado } from '@plataforma/nucleo';
import { borrarSeguro, guardarSeguro, leerSeguro, type AlmacenClaveValor } from './almacen.js';

export const VIGENCIA_CACHE_MS = 15 * 60 * 1000;
const CLAVE = (m: Mercado): string => `cb.cotizacion.${m}`;

export interface CotizacionCliente {
  readonly cotizacionId: string;
  readonly par: string;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: string;
  readonly estado: 'vigente' | 'ultimo_verificado';
}

export interface RespuestaFetch {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export interface DepsCotizacion {
  readonly fetch: (url: string) => Promise<RespuestaFetch>;
  readonly sesion: AlmacenClaveValor | null;
  readonly ahora: () => number;
  /** Prefijo de la API (vacío = mismo origen). */
  readonly base: string;
}

export type Cotizaciones = Readonly<Partial<Record<Mercado, CotizacionCliente>>>;

/** Acepta solo lo que tiene la forma de una copia de cotización y corresponde al mercado. */
export function leerCotizacionApi(x: unknown, mercado: Mercado): CotizacionCliente | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const { cotizacionId, par, valor, fecha, fuente, estado } = o;
  if (typeof cotizacionId !== 'string' || typeof fecha !== 'string' || typeof fuente !== 'string') return null;
  if (typeof par !== 'string' || par !== PAR_DE[mercado]) return null;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  if (estado !== 'vigente' && estado !== 'ultimo_verificado') return null;
  return { cotizacionId, par, valor, fecha, fuente, estado };
}

function desdeCache(d: DepsCotizacion, m: Mercado): CotizacionCliente | null {
  const crudo = leerSeguro(d.sesion, CLAVE(m));
  if (crudo === null) return null;
  try {
    const x = JSON.parse(crudo) as { guardadoEn?: unknown; cotizacion?: unknown };
    if (typeof x.guardadoEn !== 'number' || d.ahora() - x.guardadoEn > VIGENCIA_CACHE_MS || x.guardadoEn > d.ahora()) {
      borrarSeguro(d.sesion, CLAVE(m));
      return null;
    }
    return leerCotizacionApi(x.cotizacion, m);
  } catch {
    borrarSeguro(d.sesion, CLAVE(m));
    return null;
  }
}

export interface ClienteCotizacion {
  /** Cotización de un mercado, o null si no hay una utilizable. */
  obtener(mercado: Mercado): Promise<CotizacionCliente | null>;
  /** Las de todos los mercados que respondan. */
  todas(): Promise<Cotizaciones>;
}

export function crearClienteCotizacion(d: DepsCotizacion): ClienteCotizacion {
  let enVuelo: Promise<Cotizaciones> | null = null;

  async function pedir(): Promise<Cotizaciones> {
    try {
      const r = await d.fetch(`${d.base}/api/cotizacion`);
      const cuerpo = (await r.json()) as { cotizaciones?: Record<string, unknown> } | null;
      const salida: Partial<Record<Mercado, CotizacionCliente>> = {};
      for (const m of MERCADOS) {
        const c = leerCotizacionApi(cuerpo?.cotizaciones?.[m], m);
        if (c === null) continue;
        salida[m] = c;
        guardarSeguro(d.sesion, CLAVE(m), JSON.stringify({ guardadoEn: d.ahora(), cotizacion: c }));
      }
      return salida;
    } catch {
      return {};
    }
  }

  async function todas(): Promise<Cotizaciones> {
    const guardadas: Partial<Record<Mercado, CotizacionCliente>> = {};
    for (const m of MERCADOS) {
      const c = desdeCache(d, m);
      if (c !== null) guardadas[m] = c;
    }
    if (MERCADOS.every((m) => guardadas[m] !== undefined)) return guardadas;
    enVuelo ??= pedir().finally(() => {
      enVuelo = null;
    });
    const nuevas = await enVuelo;
    return { ...guardadas, ...nuevas };
  }

  return {
    todas,
    async obtener(mercado) {
      const c = desdeCache(d, mercado);
      if (c !== null) return c;
      return (await todas())[mercado] ?? null;
    },
  };
}
