export type {
  ArchivoSubida,
  ColeccionManifiesto,
  EscrituraSubidaReservada,
  IdModulo,
  LimiteColeccion,
  ManifiestoModulo,
  Rol,
  RutaAlmacenamiento,
  TipoEvento,
} from './registro/tipos.js';
export { crearRegistro, ErrorRegistro } from './registro/registro.js';
export type { Registro } from './registro/registro.js';
export type { ClaimPlataforma, Resultado } from './contratos/claim.js';
export { LIMITE_BYTES_CLAIM, validarClaim } from './contratos/claim.js';
export type { SobreEvento } from './contratos/sobre-evento.js';
export { validarSobre } from './contratos/sobre-evento.js';
export { manifiestoNucleo } from './manifiesto.js';


export * from './identidad/index.js';
export * from './tenant/index.js';
export * from './limites/index.js';
export * from './auditoria/index.js';
export * from './eventos/index.js';
export * from './tipo-cambio/index.js';
export * from './limite-tasa/index.js';

// Moneda existe en tenant (BOB, USD, ARS) y en tipo-cambio (BOB, ARS): gana la del tenant.
export type { Moneda } from './tenant/index.js';
