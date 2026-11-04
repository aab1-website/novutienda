import type { ManifiestoModulo } from './registro/tipos.js';

/** Manifiesto del módulo núcleo: colecciones comunes a todos los tenants. */
export const manifiestoNucleo: ManifiestoModulo = {
  id: 'nucleo',
  version: '0.1.0',
  dependeDe: [],
  submodulos: [],
  colecciones: [
    { ruta: 'miembros', lectura: ['sup', 'adm', 'dir'], escritura: 'servidor', limite: 'usuarios' },
    { ruta: 'auditoria', lectura: ['sup', 'adm', 'dir'], escritura: 'servidor' },
    { ruta: 'eventos', lectura: [], escritura: 'servidor' },
    { ruta: 'procesados', lectura: [], escritura: 'servidor' },
    { ruta: 'contadores', lectura: [], escritura: 'servidor' },
    { ruta: 'cotizaciones', lectura: ['caj', 'sup', 'adm', 'dir'], escritura: 'servidor' },
    { ruta: 'config', lectura: ['caj', 'sup', 'adm', 'dir'], escritura: 'servidor' },
  ],
  emite: [],
  consume: [],
};
