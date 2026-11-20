// Entrada pública de la interfaz del módulo pos dentro del panel (`@novutienda/panel/pos`, package.json `exports`).
// Lo que una prueba de fuera del paquete necesita de esta carpeta se exporta aquí, no desde `src/index.ts`
// (Central no reexporta piezas de módulo; plano §6.5, T2).
// Precio de cobro de la caja (la batería de equivalencia lo compara con el cálculo del servidor).
export { precioDeCobro } from './arqueo.js';
export type { PrecioMercadoVista } from '../../util/precio.js';
export type { CotizacionesVigentes, MercadoDeclarado, ProductoPanel } from '../../api/tipos.js';
// Resumen del turno del doble (la prueba de pruebas/pos lo compara con `resumirTurno` del módulo).
export { resumirTurnoDoble } from './resumen-turno.js';
