import type { ManifiestoModulo } from './registro/tipos.js';

/** Manifiesto del módulo núcleo: colecciones comunes a todos los tenants. */
export const manifiestoNucleo: ManifiestoModulo = {
  id: 'nucleo',
  version: '0.1.0',
  dependeDe: [],
  submodulos: [],
  colecciones: [
    { ruta: 'miembros', lectura: ['sup', 'adm'], escritura: 'servidor', limite: 'usuarios' },
    { ruta: 'auditoria', lectura: ['sup', 'adm'], escritura: 'servidor' },
    { ruta: 'eventos', lectura: [], escritura: 'servidor' },
    { ruta: 'procesados', lectura: [], escritura: 'servidor' },
    { ruta: 'contadores', lectura: [], escritura: 'servidor' },
    { ruta: 'cotizaciones', lectura: ['caj', 'sup', 'adm'], escritura: 'servidor' },
    { ruta: 'config', lectura: ['caj', 'sup', 'adm'], escritura: 'servidor' },
    // L1-b: la escribe notificador.ts con Admin; el panel las lee por el callable consola.alertas, nunca por Firestore.
    { ruta: 'alertas', lectura: [], escritura: 'servidor' },
    // L1-b: raíz; la usa el conector de límite de tasa (limite-tasa.ts), solo con Admin. Su TTL vive en firestore.indexes.json.
    { ruta: 'limitesTasa', lectura: [], escritura: 'servidor', ambito: 'raiz' },
  ],
  emite: [],
  consume: [],
};
