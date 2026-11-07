import type { ManifiestoModulo } from '@novutienda/nucleo';

/**
 * Manifiesto del módulo website. El sitio público NO lee Firestore desde el navegador:
 * consume la copia `publicado` en la reconstrucción y la disponibilidad por `/api/disponibilidad`.
 * Todo se escribe desde el servidor (la consola llama a funciones; el navegador nunca escribe).
 * La disponibilidad pública (`existenciasPublicas`) es de Inventarios, que la escribe; el sitio
 * la consume por su API y no la declara aquí (un solo dueño por dato).
 */
export const manifiestoWebsite: ManifiestoModulo = {
  id: 'website',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  zona: 'modulo',
  submodulos: [],
  colecciones: [
    // Mensajes del formulario de contacto, escritos por /api/contacto.
    // Las demás colecciones del sitio (fichas, secciones, carruseles, configuración, publicado, subidas y medios)
    // son del módulo consola, que es su único dueño; el sitio las consume ya publicadas.
    { ruta: 'contactos', lectura: ['sup', 'adm'], escritura: 'servidor' },
  ],
  emite: [],
  consume: [],
  requiere: ['consola', 'inventarios'],
};
