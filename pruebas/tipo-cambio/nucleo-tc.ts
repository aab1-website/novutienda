/*
 * Único punto por el que las pruebas de tipo-cambio importan el módulo.
 * Mientras `paquetes/nucleo/src/index.ts` no lo exporte, se importa por ruta
 * relativa y se silencia aquí (y solo aquí) la regla de importación profunda.
 * Cuando el coordinador cablee el índice, esta línea pasa a
 * `export * from '@plataforma/nucleo';` y se quita el comentario.
 */
/* eslint-disable no-restricted-imports */
export * from '../../paquetes/nucleo/src/tipo-cambio/index.js';
