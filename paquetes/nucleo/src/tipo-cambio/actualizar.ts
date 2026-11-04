/**
 * Una corrida de actualización de un mercado: baja las fuentes, las lee,
 * decide y escribe. Las fuentes que fallan no abortan: la decisión se toma con
 * lo que haya y deja avisos. Pensada para que la invoque un job programado.
 */
import { type AlmacenCotizaciones, type ResultadoEscritura, escribirCotizacion, leerCotizacion } from './almacen.js';
import type { EsFeriado } from './fechas.js';
import { bajarTexto, type OpcionesDescarga } from './descargar.js';
import { leerTablaBcb, URL_TABLA_BCB } from './parser-bcb.js';
import { leerCotizacionesBcra, URL_COTIZACIONES_BCRA } from './parser-bcra.js';
import { leerPaginaBna, URL_PAGINA_BNA } from './parser-bna.js';
import { SinCotizacionUtilizable, type ConfigCotizacion, type Lectura, type Mercado } from './tipos.js';

/** Lo que se avisa a quien opera. */
export interface AvisoOperativo {
  /** 'fallas_fuente': alguna fuente no respondió o no se pudo leer; 'cotizacion_vieja': no hay cotización utilizable (falta o supera el límite). */
  readonly tipo: 'fallas_fuente' | 'cotizacion_vieja';
  readonly mercado: Mercado;
  readonly detalle: string;
  /** Fallas de las fuentes de esta corrida (solo en 'fallas_fuente'). */
  readonly fallas?: readonly string[];
}

/**
 * Canal de aviso inyectable (correo, WhatsApp, etc.). Aquí NO se implementa el
 * envío real. Si `notificar` lanza, la corrida no se interrumpe.
 */
export interface Notificador {
  notificar(aviso: AvisoOperativo): Promise<void>;
}

export interface ResultadoCorrida extends ResultadoEscritura {
  /** Fallas de descarga o lectura de cada fuente (para el registro y el aviso). */
  readonly fallas: readonly string[];
}

export async function actualizarMercado(
  almacen: AlmacenCotizaciones,
  mercado: Mercado,
  ahoraMs: number,
  o: OpcionesDescarga & {
    readonly tenantId: string;
    readonly config?: Partial<ConfigCotizacion>;
    readonly notificador?: Notificador;
    readonly esFeriado?: EsFeriado;
  },
): Promise<ResultadoCorrida> {
  const fallas: string[] = [];
  const intentar = async (nombre: string, f: () => Promise<Lectura | { error: string }>): Promise<Lectura | null> => {
    try {
      const r = await f();
      if ('error' in r) { fallas.push(`${nombre}: ${r.error}`); return null; }
      return r;
    } catch (e) {
      fallas.push(`${nombre}: ${e instanceof Error ? e.message : 'error desconocido'}`);
      return null;
    }
  };
  const bcb = () => intentar('BCB', async () => {
    const l = leerTablaBcb(await bajarTexto(URL_TABLA_BCB, o));
    return l.ok ? l.lectura : { error: l.motivo };
  });
  const bna = () => intentar('BNA', async () => {
    const l = leerPaginaBna(await bajarTexto(URL_PAGINA_BNA, o));
    return l.ok ? l.lectura.lectura : { error: l.motivo };
  });
  const bcra = () => intentar('BCRA', async () => {
    const l = leerCotizacionesBcra(JSON.parse(await bajarTexto(URL_COTIZACIONES_BCRA, o)) as unknown);
    return l.ok ? l.lectura : { error: l.motivo };
  });

  const [principal, control] = mercado === 'BO' ? [await bcb(), null] : await Promise.all([bna(), bcra()]);
  const r = await escribirCotizacion(almacen, { mercado, principal, control, ahoraMs, ...(o.config ? { config: o.config } : {}) },
    { tenantId: o.tenantId });
  await avisar(almacen, mercado, ahoraMs, fallas, o);
  return { ...r, fallas };
}

/** Avisa de fallas de fuente y de una cotización más vieja que el límite (o ausente). Nunca lanza. */
async function avisar(
  almacen: AlmacenCotizaciones,
  mercado: Mercado,
  ahoraMs: number,
  fallas: readonly string[],
  o: { readonly tenantId: string; readonly config?: Partial<ConfigCotizacion>; readonly notificador?: Notificador; readonly esFeriado?: EsFeriado },
): Promise<void> {
  if (!o.notificador) return;
  const enviar = async (aviso: AvisoOperativo): Promise<void> => {
    try { await o.notificador!.notificar(aviso); } catch { /* el aviso no debe tumbar la corrida */ }
  };
  if (fallas.length > 0) await enviar({ tipo: 'fallas_fuente', mercado, detalle: `${fallas.length} fuente(s) con falla`, fallas });
  try {
    await leerCotizacion(almacen, mercado, ahoraMs, {
      tenantId: o.tenantId, ...(o.config ? { config: o.config } : {}), ...(o.esFeriado ? { esFeriado: o.esFeriado } : {}),
    });
  } catch (e) {
    if (!(e instanceof SinCotizacionUtilizable)) throw e;
    await enviar({ tipo: 'cotizacion_vieja', mercado, detalle: e.motivo });
  }
}
