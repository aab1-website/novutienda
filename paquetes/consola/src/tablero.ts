import {
  leerCotizacion, precioFinal, rutaContador, SinCotizacionUtilizable,
  type Actor, type AlmacenCotizaciones, type CopiaCotizacion, type Mercado, type PrecioFinal, type Redondeo,
} from '@plataforma/nucleo';
import { leerEstadoSitio } from './cambios.js';
import { LIMITES_CONSOLA } from './limites.js';
import { leerUsoMedios } from './medios/uso.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, PrecioUSD, Reloj } from './puertos.js';
import { rutaPublicado, tenantValido } from './rutas.js';

export type CotizacionTablero =
  | { readonly mercado: Mercado; readonly estado: 'vigente' | 'ultimo_verificado'; readonly par: string; readonly valor: number; readonly fecha: string; readonly fuente: string }
  | { readonly mercado: Mercado; readonly estado: 'sin_cotizacion'; readonly motivo: string };

export interface Tablero {
  readonly cambiosSinPublicar: number;
  readonly ultimoCambioEn: string;
  readonly publicadoEn: string | null;
  readonly versionPublicada: number;
  readonly cotizaciones: readonly CotizacionTablero[];
  readonly uso: {
    readonly productos: { readonly usados: number; readonly tope: number };
    readonly usuarios: { readonly usados: number; readonly tope: number };
    readonly originalesBytes: { readonly usados: number; readonly tope: number };
  };
}

export interface DepsTablero {
  readonly db: BaseDatosConsola;
  readonly cotizaciones: AlmacenCotizaciones;
  readonly reloj: Reloj;
}

const entero = (x: unknown): number => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0);

/** Cotización vigente de cada mercado (con fecha y estado), cambios sin publicar y uso frente a los topes. */
export async function obtenerTablero(deps: DepsTablero, e: { tenantId: string; actor: Actor }): Promise<Tablero> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.consultar);
  const base = await deps.db.runTransaction(async (tx) => ({
    estado: await leerEstadoSitio(tx, t),
    publicado: (await tx.get(rutaPublicado(t, 'estado'))).data(),
    contadores: (await tx.get(rutaContador(t))).data(),
    medios: await leerUsoMedios(tx, t),
  }));
  const cotizaciones: CotizacionTablero[] = [];
  for (const mercado of ['BO', 'AR'] as const) {
    try {
      const c = await leerCotizacion(deps.cotizaciones, mercado, deps.reloj.ahora(), { tenantId: t });
      cotizaciones.push({ mercado, estado: c.estado, par: c.par, valor: c.valor, fecha: c.fecha, fuente: c.fuente });
    } catch (err) {
      if (!(err instanceof SinCotizacionUtilizable)) throw err;
      cotizaciones.push({ mercado, estado: 'sin_cotizacion', motivo: err.motivo });
    }
  }
  return {
    cambiosSinPublicar: base.estado.cambios,
    ultimoCambioEn: base.estado.ultimoCambioEn,
    publicadoEn: typeof base.publicado?.['publicadoEn'] === 'string' ? base.publicado['publicadoEn'] : null,
    versionPublicada: entero(base.publicado?.['version']),
    cotizaciones,
    uso: {
      productos: { usados: entero(base.contadores?.['productos']), tope: LIMITES_CONSOLA.productos },
      usuarios: { usados: entero(base.contadores?.['usuarios']), tope: LIMITES_CONSOLA.usuarios },
      originalesBytes: { usados: base.medios.bytes, tope: LIMITES_CONSOLA.cuotaOriginalesBytes },
    },
  };
}

export type PrecioDelDia = PrecioFinal | { readonly tipo: 'sin_cotizacion' };

/**
 * Editor de ficha: el precio en Bs y en ARS del día, calculado con la misma función del sitio (`precioFinal`).
 * La política de redondeo se inyecta: no hay valor por defecto (está sin decidir).
 */
export function preciosDelDia(
  precio: PrecioUSD,
  cotizaciones: Readonly<Partial<Record<Mercado, CopiaCotizacion>>>,
  redondeo: Redondeo,
): { readonly BO: PrecioDelDia; readonly AR: PrecioDelDia } {
  const calcular = (mercado: Mercado, usd: number): PrecioDelDia => {
    const c = cotizaciones[mercado];
    return c === undefined ? { tipo: 'sin_cotizacion' } : precioFinal(usd, mercado, c, redondeo);
  };
  return { BO: calcular('BO', precio.bo), AR: calcular('AR', precio.ar) };
}
