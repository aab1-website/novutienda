/**
 * Tipos del tipo de cambio. Contrato: el precio base se guarda en USD por
 * mercado; el precio final se calcula con la cotización del mercado.
 */

export type Mercado = 'BO' | 'AR';
export type Par = 'BOB/USD' | 'ARS/USD';
export type Moneda = 'BOB' | 'ARS';
export type FuenteCotizacion = 'BCB' | 'BNA' | 'BCRA' | 'manual';
/** 'vigente': la fecha del valor está dentro de la ventana; 'ultimo_verificado': la fuente no lo renueva desde hace días. */
export type EstadoCotizacion = 'vigente' | 'ultimo_verificado';
export type OrigenCarga = 'automatico' | 'manual';

export const MERCADOS: readonly Mercado[] = ['BO', 'AR'];

export const PAR_DE: Readonly<Record<Mercado, Par>> = { BO: 'BOB/USD', AR: 'ARS/USD' };
export const MONEDA_DE: Readonly<Record<Mercado, Moneda>> = { BO: 'BOB', AR: 'ARS' };
/** Zona horaria con la que se decide «hoy» en cada mercado. */
export const ZONA_DE: Readonly<Record<Mercado, string>> = {
  BO: 'America/La_Paz',
  AR: 'America/Argentina/Buenos_Aires',
};

export const esMercado = (x: unknown): x is Mercado => x === 'BO' || x === 'AR';

/** Lo que una fuente entrega ya leído: valor en unidades de moneda local por USD y fecha aaaa-mm-dd. */
export interface Lectura {
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: Exclude<FuenteCotizacion, 'manual'>;
}

export type ResultadoLectura<T> = { readonly ok: true; readonly lectura: T } | { readonly ok: false; readonly motivo: string };

/** Documento `cotizaciones/{BO|AR}` (y, sin `antes`, cada entrada del historial). */
export interface CotizacionGuardada {
  readonly cotizacionId: string;
  readonly mercado: Mercado;
  readonly par: Par;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: FuenteCotizacion;
  readonly origen: OrigenCarga;
  /** Instante ISO 8601 UTC en que se escribió. */
  readonly actualizadoEn: string;
}

/** Copia que guarda cada venta o pedido: la cotización con la que se calculó el precio. */
export interface CopiaCotizacion {
  readonly cotizacionId: string;
  readonly par: Par;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: FuenteCotizacion;
  readonly estado: EstadoCotizacion;
}

/** Error tipado: no hay cotización utilizable. El consumidor decide (catálogo: 503; flujo de venta: pasa al vendedor). */
export class SinCotizacionUtilizable extends Error {
  constructor(
    readonly mercado: Mercado,
    readonly motivo: string,
  ) {
    super(`sin cotización utilizable para ${mercado}: ${motivo}`);
    this.name = 'SinCotizacionUtilizable';
  }
}

export interface ConfigCotizacion {
  /** Un cambio mayor (relativo) contra el valor guardado no se escribe solo. */
  readonly saltoMaximo: number;
  /** Desvío relativo máximo entre la fuente principal y el control cruzado antes de avisar. */
  readonly desvioMaximo: number;
  /** Hasta cuántos días de antigüedad el valor es 'vigente'. */
  readonly diasVigente: number;
  /** Más allá de estos días no hay cotización utilizable. */
  readonly diasLimite: number;
  /** Cuántos días en el futuro se acepta una fecha (el BCB publica de noche la tabla del día siguiente). */
  readonly diasFuturoMax: number;
}

/**
 * Valores iniciales. Salto 5 % lo fija el contrato; el resto son supuestos
 * revisables: 3 días de vigencia cubren un fin de semana, 4 de límite
 * siguen el criterio de NovuChat (el valor del viernes sirve hasta el martes).
 */
export const CONFIG_POR_DEFECTO: ConfigCotizacion = {
  saltoMaximo: 0.05,
  desvioMaximo: 0.05,
  diasVigente: 3,
  diasLimite: 4,
  diasFuturoMax: 1,
};
