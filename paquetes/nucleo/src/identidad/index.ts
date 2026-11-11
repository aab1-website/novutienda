export type {
  Actor,
  ActorConRol,
  AuthMin,
  BaseDatosIdentidad,
  CodigoErrorIdentidad,
  DepsIdentidad,
  TransaccionIdentidad,
} from './asignar.js';
export { asignarPrimerAdministrador, asignarRol, ErrorIdentidad, quitarRol } from './asignar.js';
export { bytesClaimCompleto, construirClaim, esPropietario, leerClaim, proveedorDe, rolEn } from './claim.js';
