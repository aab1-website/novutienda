import type { Resultado } from '../contratos/claim.js';
import type { SobreEvento } from '../contratos/sobre-evento.js';
import { mercadoDe, monedasCaja, type ConfiguracionComercial } from '../tenant/mercados.js';
import { MERCADOS, MONEDA_DE, PAR_DE } from '../tipo-cambio/tipos.js';
import { MONEDAS_EVENTO } from './esquema.js';
import { normalizarEventoAV2 } from './normalizar-v2.js';
import type { DatosPedidoConfirmadoV2 } from './pedido-confirmado.v2.js';
import type { DatosPedidoSolicitadoV2 } from './pedido-solicitado.v2.js';
import type { DatosTurnoCerradoV2 } from './turno-cerrado.v2.js';
import type { DatosVentaAnuladaV2 } from './venta-anulada.v2.js';
import type { DatosVentaConfirmadaV2 } from './venta-confirmada.v2.js';

/**
 * Qué versión de los eventos de venta y pedido emite un tenant (se DEDUCE de su configuración, sin campo propio):
 * 1 si y solo si la configuración «cabe en v1», es decir, si todos sus mercados son los que la v1 admite, cada uno con
 * la moneda de venta, la moneda base (USD) y el par que la v1 admite, y todas sus monedas de caja están entre las de
 * la v1; en cualquier otro caso, 2. Los conjuntos salen de las constantes que los esquemas v1 comparten.
 */
export function versionDeEventos(comercial: ConfiguracionComercial): 1 | 2 {
  const monedasV1: readonly string[] = MONEDAS_EVENTO;
  if (!comercial.monedas.every((m) => monedasV1.includes(m))) return 2;
  for (const m of comercial.mercados) {
    const id = m.id as (typeof MERCADOS)[number];
    if (!MERCADOS.includes(id)) return 2;
    if (m.monedaVenta !== MONEDA_DE[id] || m.monedaBase !== 'USD') return 2;
    if (m.tipoCambio === null || m.tipoCambio.par !== PAR_DE[id]) return 2;
  }
  return 1;
}

const OK: Resultado<true> = { ok: true, valor: true };
const falla = (error: string): Resultado<true> => ({ ok: false, error });

function monedaEnCaja(c: ConfiguracionComercial, moneda: string, ruta: string): string | null {
  return monedasCaja(c).includes(moneda) ? null : `${ruta}: la moneda ${moneda} no está entre las monedas del tenant`;
}

function errorPedido(c: ConfiguracionComercial, d: DatosPedidoSolicitadoV2 | DatosPedidoConfirmadoV2): string | null {
  const m = mercadoDe(c, d.mercado);
  if (m === undefined) return `datos.mercado: el mercado ${d.mercado} no existe en el tenant`;
  if (d.monedaBase !== m.monedaBase) return `datos.monedaBase debe ser la moneda base del mercado ${d.mercado} (${m.monedaBase})`;
  if (d.moneda !== m.monedaVenta && d.moneda !== m.monedaBase) return `datos.moneda no corresponde al mercado ${d.mercado}`;
  if (d.cotizacion !== null && d.cotizacion.par !== m.tipoCambio?.par) return `datos.cotizacion.par no corresponde al mercado ${d.mercado}`;
  return null;
}

function errorVenta(c: ConfiguracionComercial, d: DatosVentaConfirmadaV2): string | null {
  const m = mercadoDe(c, d.mercado);
  if (m === undefined) return `datos.mercado: el mercado ${d.mercado} no existe en el tenant`;
  const enCaja = monedaEnCaja(c, d.moneda, 'datos.moneda');
  if (enCaja !== null) return enCaja;
  if (d.monedaBase !== m.monedaBase) return `datos.monedaBase debe ser la moneda base del mercado ${d.mercado} (${m.monedaBase})`;
  if (d.moneda === d.monedaBase) return null;
  if (d.moneda !== m.monedaVenta) return `datos.moneda no corresponde al mercado ${d.mercado}`;
  return m.tipoCambio?.par === `${d.moneda}/${d.monedaBase}` ? null : `datos.cotizacion.par: el mercado ${d.mercado} no tiene el par ${d.moneda}/${d.monedaBase}`;
}

/**
 * ¿Es coherente el evento con la configuración comercial del tenant? Lo comprueba el servidor al emitir o consumir:
 * el esquema v2 no conoce al tenant. Pura. Un evento v1 se normaliza a v2 antes de comprobarlo (una venta v1 en la
 * moneda base, ambigua entre mercados, exige `mercado` explícito y sin él falla cerrado); un tipo sin mercado ni
 * moneda (stock, producto, recibo) es coherente siempre. Se asume un evento ya validado por `validarEvento`.
 */
export function coherenteConComercial(evento: SobreEvento, comercial: ConfiguracionComercial, mercado?: string): Resultado<true> {
  const n = normalizarEventoAV2(evento, mercado === undefined ? { comercial } : { comercial, mercado });
  if (!n.ok) return n;
  const e = n.valor;
  if (e.version !== 2) return OK;
  switch (e.tipo) {
    case 'venta.confirmada': {
      const m = errorVenta(comercial, e.datos as DatosVentaConfirmadaV2);
      return m === null ? OK : falla(m);
    }
    case 'venta.anulada': {
      for (const [i, r] of (e.datos as DatosVentaAnuladaV2).reembolsos.entries()) {
        const m = monedaEnCaja(comercial, r.moneda, `datos.reembolsos[${i}].moneda`);
        if (m !== null) return falla(m);
      }
      return OK;
    }
    case 'turno.cerrado': {
      for (const moneda of Object.keys((e.datos as DatosTurnoCerradoV2).monedas)) {
        const m = monedaEnCaja(comercial, moneda, `datos.monedas.${moneda}`);
        if (m !== null) return falla(m);
      }
      return OK;
    }
    case 'pedido.solicitado':
    case 'pedido.confirmado': {
      const m = errorPedido(comercial, e.datos as DatosPedidoSolicitadoV2 | DatosPedidoConfirmadoV2);
      return m === null ? OK : falla(m);
    }
    default:
      return OK;
  }
}
