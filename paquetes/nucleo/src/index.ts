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
