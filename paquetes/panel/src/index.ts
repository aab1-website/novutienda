export { manifiestoPanel } from './manifiesto.js';
// Contrato de callables que el panel asume (lo reconcilia quien integra las funciones del servidor).
export { NOMBRES_CALLABLE, ROLES_CALLABLE } from './api/contrato.js';
export type { Contrato, Entrada, NombreCallable, Salida } from './api/contrato.js';
export { CODIGOS_CONOCIDOS, ErrorApi, mensajeDeError } from './api/errores.js';
export * from './api/tipos.js';
