import {
  leerCotizacionDe, precioDeMercado, claveDePrecio, rutaContador, SinCotizacionUtilizable,
  type Actor, type AlmacenCotizaciones, type ConfiguracionComercial, type CopiaCotizacion, type PrecioDeMercado, type ReglaRedondeo, type RedondeoPorMoneda,
} from '@novutienda/nucleo';
import { leerEstadoSitio, type AvisoSitio } from './cambios.js';
import { LIMITES_CONSOLA, topesDelPlan } from './limites.js';
import { leerUsoMedios } from './medios/uso.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, Reloj } from './puertos.js';
import { rutaPublicado, tenantValido } from './rutas.js';

export type CotizacionTablero =
  | { readonly mercado: string; readonly estado: 'vigente' | 'ultimo_verificado'; readonly par: string; readonly valor: number; readonly fecha: string; readonly fuente: string }
  | { readonly mercado: string; readonly estado: 'sin_cotizacion'; readonly motivo: string };

export interface Tablero {
  readonly cambiosSinPublicar: number;
  readonly ultimoCambioEn: string;
  readonly publicadoEn: string | null;
  readonly versionPublicada: number;
  /** Si un retiro automático dejó el sitio sin productos o sin fotos; `null` si no hay aviso. */
  readonly avisoSitio: AvisoSitio | null;
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
  /** Configuración comercial vigente del comercio: sus mercados declarados mandan sobre la lista de cotizaciones. */
  readonly comercial: ConfiguracionComercial;
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
    plan: (await tx.get(`tenants/${t}`)).data()?.['plan'],
  }));
  const topes = topesDelPlan(base.plan);
  const cotizaciones: CotizacionTablero[] = [];
  // D24: un mercado sin tipo de cambio no aparece (no tiene cotización que mostrar).
  for (const { id, tipoCambio } of deps.comercial.mercados) {
    if (tipoCambio == null) continue;
    const mercado = id;
    try {
      const c = await leerCotizacionDe(deps.cotizaciones, mercado, deps.reloj.ahora(), { tenantId: t, comercial: deps.comercial });
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
    avisoSitio: base.estado.avisoSitio,
    cotizaciones,
    uso: {
      productos: { usados: entero(base.contadores?.['productos']), tope: topes.productos },
      usuarios: { usados: entero(base.contadores?.['usuarios']), tope: topes.usuarios },
      originalesBytes: { usados: base.medios.bytes, tope: LIMITES_CONSOLA.cuotaOriginalesBytes },
    },
  };
}

export type PrecioDelDiaDeMercado = PrecioDeMercado | { readonly tipo: 'sin_cotizacion' } | { readonly tipo: 'falta_precio' };

/**
 * Editor de ficha para el comercio actual: el precio del día de CADA mercado declarado, con `precioDeMercado` del núcleo.
 * `precios` se indexa por `claveDePrecio(mercado.id)` (minúsculas) y está en la moneda base del mercado. El redondeo es el
 * vigente del comercio por moneda de venta (`redondeo`), nunca `mercado.redondeo`. Resultado indexado por id de mercado:
 * `sin_cotizacion` si el mercado tiene tipo de cambio y no hay cotización utilizable; `falta_precio` si no llegó precio.
 */
export function preciosDelDiaDe(
  precios: Readonly<Record<string, number>>,
  comercial: ConfiguracionComercial,
  cotizaciones: Readonly<Record<string, CopiaCotizacion<string> | undefined>>,
  redondeo: RedondeoPorMoneda,
): Readonly<Record<string, PrecioDelDiaDeMercado>> {
  const salida: Record<string, PrecioDelDiaDeMercado> = {};
  for (const m of comercial.mercados) {
    const base = precios[claveDePrecio(m.id)];
    if (base === undefined) { salida[m.id] = { tipo: 'falta_precio' }; continue; }
    const c = cotizaciones[m.id];
    if (m.tipoCambio != null && c === undefined) { salida[m.id] = { tipo: 'sin_cotizacion' }; continue; }
    const regla: ReglaRedondeo | undefined = redondeo[m.monedaVenta];
    // `precioDeMercado` exige la regla en su tipo: sin regla vigente la respuesta es inválida, como la del núcleo.
    salida[m.id] = regla === undefined
      ? { tipo: 'invalido', motivo: `falta una regla de redondeo válida para ${m.monedaVenta}` }
      : precioDeMercado(base, { ...m, redondeo: regla }, c ?? null);
  }
  return salida;
}
