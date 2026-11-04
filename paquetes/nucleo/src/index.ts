import { manifiestoNucleo } from './manifiesto.js';
import { crearRegistro } from './registro/registro.js';
import type { ManifiestoModulo } from './registro/tipos.js';

export type {
  ColeccionManifiesto,
  IdModulo,
  LimiteColeccion,
  ManifiestoModulo,
  Rol,
  TipoEvento,
} from './registro/tipos.js';
export { crearRegistro, ErrorRegistro } from './registro/registro.js';
export type { Registro } from './registro/registro.js';
export type { ClaimPlataforma, Resultado } from './contratos/claim.js';
export { LIMITE_BYTES_CLAIM, validarClaim } from './contratos/claim.js';
export type { SobreEvento } from './contratos/sobre-evento.js';
export { validarSobre } from './contratos/sobre-evento.js';
export { manifiestoNucleo } from './manifiesto.js';

/** Registro de la plataforma, con solo el módulo núcleo registrado. */
export const registroPlataforma = crearRegistro<ManifiestoModulo>();
registroPlataforma.registrar(manifiestoNucleo);

export * from './identidad/index.js';
export * from './tenant/index.js';
export * from './limites/index.js';
export * from './auditoria/index.js';
export * from './eventos/index.js';
export * from './tipo-cambio/index.js';

// Moneda existe en tenant (BOB, USD, ARS) y en tipo-cambio (BOB, ARS): gana la del tenant.
export type { Moneda } from './tenant/index.js';
