import type { ManifiestoModulo } from '@plataforma/nucleo';

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
  submodulos: [],
  colecciones: [
    // Ficha web de cada producto: slug, descripción, garantía, medios, SEO y estado.
    { ruta: 'fichasWeb', lectura: ['sup', 'adm'], escritura: 'servidor' },
    // Configuración del sitio (documento `config`): plantilla activa, número de NovuChat, IDs de medición.
    { ruta: 'sitio', lectura: ['sup', 'adm'], escritura: 'servidor' },
    // Secciones editables del menú (hasta 5).
    { ruta: 'secciones', lectura: ['sup', 'adm'], escritura: 'servidor' },
    // Fotos del carrusel de cada plantilla.
    { ruta: 'carruseles', lectura: ['sup', 'adm'], escritura: 'servidor' },
    // Copia que lee la reconstrucción: solo el servidor la lee y la escribe.
    { ruta: 'publicado', lectura: [], escritura: 'servidor' },
    // Reservas y estado de las subidas de medios (solo servidor).
    { ruta: 'subidas', lectura: [], escritura: 'servidor' },
    // Medios ya procesados (versiones con hash de contenido).
    { ruta: 'medios', lectura: ['sup', 'adm'], escritura: 'servidor' },
    // Mensajes del formulario de contacto, escritos por /api/contacto.
    { ruta: 'contactos', lectura: ['sup', 'adm'], escritura: 'servidor' },
  ],
  emite: ['pedido.solicitado'],
  consume: [],
};
