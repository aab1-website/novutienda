import {
  leerCotizacionDe, precioDeMercado, claveDePrecio, rutaContador, SinCotizacionUtilizable,
  leerCausasFallaSitio, esEtapaFallaSitio, type EtapaFallaSitio, type CodigoCausaSitio,
  type Actor, type AlmacenCotizaciones, type ConfiguracionComercial, type CopiaCotizacion, type PrecioDeMercado, type ReglaRedondeo, type RedondeoPorMoneda,
} from '@novutienda/nucleo';
import { leerEstadoSitio, type AvisoSitio } from './cambios.js';
import { LIMITES_CONSOLA, topesDelPlan } from './limites.js';
import { leerUsoMedios } from './medios/uso.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, Reloj } from './puertos.js';
import { rutaPublicado, rutaSitio, tenantValido } from './rutas.js';

export type CotizacionTablero =
  | { readonly mercado: string; readonly estado: 'vigente' | 'ultimo_verificado'; readonly par: string; readonly valor: number; readonly fecha: string; readonly fuente: string }
  | { readonly mercado: string; readonly estado: 'sin_cotizacion'; readonly motivo: string };

/** Resultado de la última reconstrucción del sitio, tal como lo mostrará el panel. */
export interface UltimaReconstruccionTablero {
  readonly estado: 'completada' | 'fallida';
  readonly version: number;
  /** Instante de la reconstrucción en ISO 8601 (UTC). */
  readonly en: string;
  /** Solo en `fallida`; `null` si el documento no trae una etapa válida. */
  readonly etapa: EtapaFallaSitio | null;
  /** `true` si ya hay una publicación más nueva (`versionPublicada > version`) y esta aún no terminó. */
  readonly enCurso: boolean;
  /** Hasta 20 causas válidas; `producto` es el nombre (máximo 5 resueltos desde `publicado/producto__<id>`). */
  readonly causas: readonly { readonly codigo: CodigoCausaSitio; readonly mercado?: string; readonly producto?: string }[];
}

function leerPublicadoAutomatico(pub: Readonly<Record<string, unknown>> | undefined): Tablero['publicadoAutomatico'] {
  const candidatos: { en: string; motivo: 'producto' | 'redondeo' }[] = [];
  for (const [campo, motivo] of [['precioVivoEn', 'producto'], ['redondeoVivoEn', 'redondeo']] as const) {
    const v = pub?.[campo];
    if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) candidatos.push({ en: v, motivo });
  }
  candidatos.sort((a, b) => Date.parse(b.en) - Date.parse(a.en));
  return candidatos[0] ?? null;
}

export interface Tablero {
  readonly cambiosSinPublicar: number;
  readonly ultimoCambioEn: string;
  readonly publicadoEn: string | null;
  /**
   * Última publicación hecha por el sistema solo (cambio vivo de producto o de redondeo) POSTERIOR a `publicadoEn`; `null` si la
   * versión vigente es la de la publicación manual. Una publicación manual reescribe `publicado/estado` y la borra.
   */
  readonly publicadoAutomatico: { readonly en: string; readonly motivo: 'producto' | 'redondeo' } | null;
  readonly versionPublicada: number;
  /** Si un retiro automático dejó el sitio sin productos o sin fotos; `null` si no hay aviso. */
  readonly avisoSitio: AvisoSitio | null;
  /** Resultado de la última reconstrucción; `null` si todavía no hay documento. */
  readonly ultimaReconstruccion: UltimaReconstruccionTablero | null;
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

const MAX_NOMBRES_CAUSA = 5;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Lectura defensiva de `sitio/ultimaReconstruccion`; `null` si falta o no es utilizable. */
function leerUltimaReconstruccion(
  doc: Record<string, unknown> | undefined,
  nombres: ReadonlyMap<string, string>,
  versionPublicada: number,
): UltimaReconstruccionTablero | null {
  if (!esObjeto(doc)) return null;
  const estado = doc['estado'];
  if (estado !== 'completada' && estado !== 'fallida') return null;
  const version = entero(doc['version']);
  const enMs = doc['enMs'];
  const en = typeof enMs === 'number' && Number.isFinite(enMs) && Math.abs(enMs) <= 8.64e15 ? new Date(enMs).toISOString() : '';
  const fallida = estado === 'fallida';
  const etapa = fallida && esEtapaFallaSitio(doc['etapa']) ? doc['etapa'] : null;
  const causas = fallida
    ? leerCausasFallaSitio(doc['causas']).map((c) => {
        const nombre = c.productoId !== undefined ? nombres.get(c.productoId) : undefined;
        return {
          codigo: c.codigo,
          ...(c.mercado !== undefined ? { mercado: c.mercado } : {}),
          ...(nombre !== undefined ? { producto: nombre } : {}),
        };
      })
    : [];
  return { estado, version, en, etapa, enCurso: versionPublicada > version, causas };
}

const entero = (x: unknown): number => (typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : 0);

/** Cotización vigente de cada mercado (con fecha y estado), cambios sin publicar y uso frente a los topes. */
export async function obtenerTablero(deps: DepsTablero, e: { tenantId: string; actor: Actor }): Promise<Tablero> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.consultar);
  const base = await deps.db.runTransaction(async (tx) => {
    const estado = await leerEstadoSitio(tx, t);
    const publicado = (await tx.get(rutaPublicado(t, 'estado'))).data();
    const contadores = (await tx.get(rutaContador(t))).data();
    const medios = await leerUsoMedios(tx, t);
    const plan = (await tx.get(`tenants/${t}`)).data()?.['plan'];
    const ultima = (await tx.get(rutaSitio(t, 'ultimaReconstruccion'))).data();
    // Lecturas antes de cualquier escritura: la transacción solo lee. Hasta 5 nombres, sin repetir ids.
    const nombres = new Map<string, string>();
    if (esObjeto(ultima) && ultima['estado'] === 'fallida') {
      for (const c of leerCausasFallaSitio(ultima['causas'])) {
        if (nombres.size >= MAX_NOMBRES_CAUSA) break;
        if (c.productoId === undefined || nombres.has(c.productoId)) continue;
        const nombre = (await tx.get(rutaPublicado(t, `producto__${c.productoId}`))).data()?.['nombre'];
        if (typeof nombre === 'string' && nombre !== '') nombres.set(c.productoId, nombre);
      }
    }
    return { estado, publicado, contadores, medios, plan, ultima, nombres };
  });
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
    publicadoAutomatico: leerPublicadoAutomatico(base.publicado),
    versionPublicada: entero(base.publicado?.['version']),
    avisoSitio: base.estado.avisoSitio,
    ultimaReconstruccion: leerUltimaReconstruccion(base.ultima, base.nombres, entero(base.publicado?.['version'])),
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
