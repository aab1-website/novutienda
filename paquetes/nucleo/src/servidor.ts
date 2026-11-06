/**
 * Entrada `@novutienda/nucleo/servidor`: lo que depende de Node (`node:crypto`) y solo el servidor debe usar.
 * El navegador (panel, sitio) importa únicamente la raíz `@novutienda/nucleo`, que no arrastra Node.
 */
export * from './firma/index.js';
