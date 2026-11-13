/**
 * Tipos del tipo de cambio. Contrato: el precio base se guarda en USD por
 * mercado; el precio final se calcula con la cotización del mercado.
 */

import { mercadosDe, monedaDe, parDe, zonaDe, type ConfiguracionComercial } from '../tenant/mercados.js';

/** Mercados del tenant de tres monedas (LEGADO). Para cualquier tenant, `IdMercado`. */
export type Mercado = 'BO' | 'AR';
export type Par = 'BOB/USD' | 'ARS/USD';
export type Moneda = 'BOB' | 'ARS';
export type FuenteCotizacion = 'BCB' | 'BNA' | 'BCRA' | 'manual';
/** 'vigente': la fecha del valor está dentro de la ventana; 'ultimo_verificado': la fuente no lo renueva desde hace días. */
export type EstadoCotizacion = 'vigente' | 'ultimo_verificado';
export type OrigenCarga = 'automatico' | 'manual';

/** Identificador de un mercado declarado por el tenant (dos letras mayúsculas). */
export type IdMercado = string;

/**
 * LEGADO: declaración explícita del tenant de tres monedas (BOB, USD, ARS; mercados Bolivia y Argentina; precio base en
 * dólares). Es la ÚNICA fuente de las constantes `MERCADOS`, `PAR_DE`, `MONEDA_DE` y `ZONA_DE`, que siguen existiendo
 * mientras el resto del sistema migra a leer la configuración del tenant. Ningún tenant la recibe por defecto: el
 * tenant declara la suya en su configuración.
 * @deprecated Solo para las variantes legado y las constantes derivadas; se retira con el último llamador.
 */
export const COMERCIAL_LEGADO_TRES_MONEDAS: ConfiguracionComercial = {
  mercados: [
    {
      id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', zonaHoraria: 'America/La_Paz',
      tipoCambio: { par: 'BOB/USD', fuentes: ['BCB'] }, redondeo: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
    },
    {
      id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', zonaHoraria: 'America/Argentina/Buenos_Aires',
      tipoCambio: { par: 'ARS/USD', fuentes: ['BNA', 'BCRA'] }, redondeo: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
    },
  ],
  monedas: ['BOB', 'USD', 'ARS'],
};

const deLegado = <T>(f: (id: Mercado) => T): Readonly<Record<Mercado, T>> =>
  Object.fromEntries(mercadosDe(COMERCIAL_LEGADO_TRES_MONEDAS).map((id) => [id, f(id as Mercado)])) as Record<Mercado, T>;

/** @deprecated LEGADO del tenant de tres monedas: usar `mercadosDe(comercial)`. */
export const MERCADOS: readonly Mercado[] = mercadosDe(COMERCIAL_LEGADO_TRES_MONEDAS) as Mercado[];

/** @deprecated LEGADO del tenant de tres monedas: usar `parDe(comercial, id)`. */
export const PAR_DE: Readonly<Record<Mercado, Par>> = deLegado((id) => parDe(COMERCIAL_LEGADO_TRES_MONEDAS, id) as Par);
/** @deprecated LEGADO del tenant de tres monedas: usar `monedaDe(comercial, id)`. */
export const MONEDA_DE: Readonly<Record<Mercado, Moneda>> = deLegado((id) => monedaDe(COMERCIAL_LEGADO_TRES_MONEDAS, id) as Moneda);
/**
 * Zona horaria con la que se decide «hoy» en cada mercado.
 * @deprecated LEGADO del tenant de tres monedas: usar `zonaDe(comercial, id)`.
 */
export const ZONA_DE: Readonly<Record<Mercado, string>> = deLegado((id) => zonaDe(COMERCIAL_LEGADO_TRES_MONEDAS, id) as string);

/**
 * LEGADO: solo reconoce BO y AR.
 * @deprecated Usar `esMercadoDe(comercial, id)`, que consulta los mercados declarados por el tenant (mismo uso: guardia de tipo de un id recibido).
 */
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
  readonly mercado: IdMercado;
  /** Par `VENTA/BASE` del mercado (p. ej. `BOB/USD`). */
  readonly par: string;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: FuenteCotizacion;
  readonly origen: OrigenCarga;
  /** Instante ISO 8601 UTC en que se escribió. */
  readonly actualizadoEn: string;
  /**
   * Ancla del tope de salto: la última cotización de una fecha ANTERIOR a `fecha`
   * (null si no la había). Las escrituras automáticas se miden contra ella.
   */
  readonly ancla?: Ancla | null;
}

/** Valor y fecha de la última cotización de una fecha anterior (referencia del tope de salto). */
export interface Ancla {
  readonly valor: number;
  readonly fecha: string;
}

/** Copia que guarda cada venta o pedido: la cotización con la que se calculó el precio. */
/** `P` es el tipo del par: el tenant de tres monedas lo tiene acotado (`Par`, valor por defecto); cualquier tenant, `string`. */
export interface CopiaCotizacion<P extends string = Par> {
  readonly cotizacionId: string;
  readonly par: P;
  readonly valor: number;
  readonly fecha: string;
  readonly fuente: FuenteCotizacion;
  readonly estado: EstadoCotizacion;
}

/** Error tipado: no hay cotización utilizable. El consumidor decide (catálogo: 503; flujo de venta: pasa al vendedor). */
export class SinCotizacionUtilizable extends Error {
  constructor(
    readonly mercado: IdMercado,
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
  /** Hasta cuántos días HÁBILES de antigüedad el valor es 'vigente'. */
  readonly diasVigente: number;
  /** Más allá de estos días HÁBILES no hay cotización utilizable. */
  readonly diasLimite: number;
  /** Cuántos días en el futuro se acepta una fecha (el BCB publica de noche la tabla del día siguiente). */
  readonly diasFuturoMax: number;
  /**
   * Qué hacer con una fecha futura dentro de `diasFuturoMax`. `false` (por defecto): no se
   * escribe todavía (queda diferida) y se toma en la corrida del día de esa fecha, de modo que la
   * tabla del BCB publicada de noche no rige esa misma noche. `true`: se escribe y rige de inmediato.
   */
  readonly futuroVigente: boolean;
}

/**
 * Valores iniciales. Salto 5 % lo fija el contrato; el resto son supuestos
 * revisables. Los días se cuentan HÁBILES (lunes a viernes sin feriados del
 * calendario inyectado): 2 de vigencia cubren un fin de semana y un feriado
 * suelto; 4 de límite son una semana hábil, de modo que un feriado largo
 * (p. ej. Carnaval) no deja el mercado sin cotización mientras haya un valor reciente.
 */
export const CONFIG_POR_DEFECTO: ConfigCotizacion = {
  saltoMaximo: 0.05,
  desvioMaximo: 0.05,
  diasVigente: 2,
  diasLimite: 4,
  diasFuturoMax: 1,
  futuroVigente: false,
};
