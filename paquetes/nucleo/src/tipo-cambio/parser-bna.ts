/**
 * Parser del dólar billete COMPRA del Banco de la Nación Argentina.
 *
 * FUENTE (verificada el 04/11/2026): el BNA NO ofrece una API pública
 * documentada de cotizaciones; se usa la página pública `https://www.bna.com.ar/Personas`
 * (HTTP 200, robots.txt permite todo), que muestra la pestaña «Cotización
 * Billetes» (`id="billetes"`) con la fecha (`th.fechaCot`, d/m/aaaa), filas
 * «Dolar U.S.A» con Compra y Venta en formato «1520,00», y «Hora
 * Actualización: HH:MM» (ese día 09:53). La pestaña vecina «Cotización
 * Divisas» (`id="divisas"`) usa punto decimal y OTRA fecha: no se debe
 * mezclar. El HTML puede cambiar sin aviso: por eso el parser es estricto y,
 * si no reconoce la estructura, no devuelve nada.
 */
import type { Lectura, ResultadoLectura } from './tipos.js';
import { fechaDiaMesAnio, filasDe, numeroDe, plano } from './texto.js';

export const URL_PAGINA_BNA = 'https://www.bna.com.ar/Personas';

export interface LecturaBna {
  /** Compra del billete en pesos por USD, como `Lectura` de fuente BNA. */
  readonly lectura: Lectura;
  readonly venta: number;
  /** «HH:MM» de «Hora Actualización», si la página lo trae. */
  readonly hora: string | null;
}

export function leerPaginaBna(html: string): ResultadoLectura<LecturaBna> {
  const inicio = html.search(/id=["']billetes["']/i);
  if (inicio < 0) return { ok: false, motivo: 'sin la pestaña de billetes' };
  const resto = html.slice(inicio);
  const fin = resto.search(/id=["']divisas["']/i);
  const panel = fin < 0 ? resto : resto.slice(0, fin);

  const rotulo = /<th[^>]*class=["'][^"']*fechaCot[^"']*["'][^>]*>([\s\S]*?)<\/th>/i.exec(panel);
  const fecha = rotulo ? fechaDiaMesAnio(plano(rotulo[1]!)) : null;
  if (!fecha) return { ok: false, motivo: 'sin fecha de la cotización de billetes' };

  const filas = filasDe(panel).filter((c) => /^dolar (u\.?s\.?a\.?|estadounidense)$/i.test(c[0] ?? ''));
  if (filas.length !== 1) return { ok: false, motivo: `se esperaba una fila Dolar U.S.A y hay ${filas.length}` };
  const [, compraTxt = '', ventaTxt = ''] = filas[0]!;
  const compra = numeroDe(compraTxt);
  const venta = numeroDe(ventaTxt);
  if (compra === null || compra <= 0 || venta === null || venta <= 0) return { ok: false, motivo: 'compra o venta no son números' };
  if (venta < compra) return { ok: false, motivo: 'la venta es menor que la compra' };

  const hora = /Hora Actualizaci(?:o|&oacute;|ó)n:\s*(\d{1,2}:\d{2})/i.exec(panel);
  return { ok: true, lectura: { lectura: { valor: compra, fecha, fuente: 'BNA' }, venta, hora: hora ? hora[1]! : null } };
}
