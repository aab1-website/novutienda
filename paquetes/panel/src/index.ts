export { manifiestoPanel } from './manifiesto.js';
// Contrato de callables que el panel asume (lo reconcilia quien integra las funciones del servidor).
export { NOMBRES_CALLABLE, ROLES_CALLABLE } from './api/contrato.js';
export type { Contrato, Entrada, NombreCallable, Salida } from './api/contrato.js';
export { CODIGOS_CONOCIDOS, ErrorApi, mensajeDeError } from './api/errores.js';
export * from './api/tipos.js';
// Contrato real con las Cloud Functions y su traducción desde las operaciones del panel (las pruebas de conformidad lo leen).
export { PROPUESTAS, ROLES_ACCION, TRADUCCION, usd } from './api/real.js';
export { REDONDEO, precioDeVenta } from './util/precio.js';
export { ClienteRemoto } from './api/transporte.js';
export type { Sobre, Transporte } from './api/transporte.js';
