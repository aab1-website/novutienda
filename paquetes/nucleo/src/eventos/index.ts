export {
  ErrorEvento, MAX_INTENTOS_POR_DEFECTO, consumir, publicarEvento, rutaDescartado, rutaEvento, rutaFallo, rutaProcesado,
  rutaProcesadoPorClave,
} from './bandeja.js';
export type { EjecutorTransacciones, TransaccionBandeja } from './bandeja.js';
export { CONTRATOS_POR_VERSION, CONTRATOS_V1, CONTRATOS_V2, validarEvento } from './contratos.js';
export type { Campo, Fixtures } from './esquema.js';
export * from './venta-confirmada.v1.js';
export * from './venta-anulada.v1.js';
export * from './turno-cerrado.v1.js';
export * from './producto-cambiado.v1.js';
export * from './stock-cambiado.v1.js';
export * from './stock-bajo.v1.js';
export * from './recibo-emitido.v1.js';
export * from './pedido-solicitado.v1.js';
export * from './pedido-confirmado.v1.js';
export * from './venta-confirmada.v2.js';
export * from './venta-anulada.v2.js';
export * from './turno-cerrado.v2.js';
export * from './pedido-solicitado.v2.js';
export * from './pedido-confirmado.v2.js';
export { coherenteConComercial, versionDeEventos } from './comercial-v2.js';
export { normalizarEventoAV2, normalizarDatosAV2 } from './normalizar-v2.js';
