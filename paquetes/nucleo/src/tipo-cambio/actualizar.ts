/**
 * Una corrida de actualización de un mercado: baja las fuentes, las lee,
 * decide y escribe. Las fuentes que fallan no abortan: la decisión se toma con
 * lo que haya y deja avisos. Pensada para que la invoque un job programado.
 */
import { type AlmacenCotizaciones, type ResultadoEscritura, escribirCotizacion } from './almacen.js';
import { bajarTexto, type OpcionesDescarga } from './descargar.js';
import { leerTablaBcb, URL_TABLA_BCB } from './parser-bcb.js';
import { leerCotizacionesBcra, URL_COTIZACIONES_BCRA } from './parser-bcra.js';
import { leerPaginaBna, URL_PAGINA_BNA } from './parser-bna.js';
import type { ConfigCotizacion, Lectura, Mercado } from './tipos.js';

export interface ResultadoCorrida extends ResultadoEscritura {
  /** Fallas de descarga o lectura de cada fuente (para el registro y el aviso). */
  readonly fallas: readonly string[];
}

export async function actualizarMercado(
  almacen: AlmacenCotizaciones,
  mercado: Mercado,
  ahoraMs: number,
  o: OpcionesDescarga & { readonly config?: Partial<ConfigCotizacion>; readonly base?: string } = {},
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
    o.base ? { base: o.base } : {});
  return { ...r, fallas };
}

