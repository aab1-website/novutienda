import type { CopiaCotizacion } from '../tipo-cambio/tipos.js';

/** Piezas internas compartidas por los contratos v2 de pedido (no se exportan desde el índice). */

export const cotizacionDePrueba: CopiaCotizacion<string> = {
  cotizacionId: 'CL-2026-11-04-1',
  par: 'CLP/EUR',
  valor: 1000,
  fecha: '2026-11-04',
  fuente: 'manual',
  estado: 'vigente',
};
