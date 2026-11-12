import type { Rol } from '@novutienda/nucleo';

/**
 * Pantallas de la consola y el contrato de cada llamada. La interfaz visual no se construye en esta ola: esta lista es
 * el contrato entre la futura interfaz y el servidor. `llamadas` nombra funciones exportadas por este paquete (el
 * adaptador las expone como callables); `lecturas` son colecciones que el navegador lee directo (reglas de Firestore).
 */
export interface Pantalla {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  readonly lecturas: readonly string[];
  readonly llamadas: readonly string[];
  readonly notas: string;
}

export const PANTALLAS: readonly Pantalla[] = [
  {
    id: 'tablero', titulo: 'Tablero', roles: ['sup', 'adm'], lecturas: [], llamadas: ['obtenerTablero', 'publicarSitio'],
    notas: 'Cambios sin publicar, cotización vigente por mercado con fecha y estado, uso «x de 200 productos» y «x de 10 GB». Publicar es solo adm.',
  },
  {
    id: 'productos', titulo: 'Productos', roles: ['sup', 'adm'], lecturas: ['fichasWeb'],
    llamadas: ['exportarProductosCsv'],
    notas: 'Lista desde el puerto del catálogo (Inventarios) con el estado de la ficha; alta y edición son de Inventarios (la consola no crea productos). Ocultar = estado «oculto» de la ficha.',
  },
  {
    id: 'ficha', titulo: 'Editor de ficha', roles: ['sup', 'adm'], lecturas: ['fichasWeb', 'medios', 'subidas'],
    llamadas: ['guardarFicha', 'reservarSubida', 'finalizarSubida', 'borrarMedio', 'preciosDelDia'],
    notas: 'Precio USD por mercado con el Bs/ARS del día al lado (preciosDelDia, política de redondeo inyectada). La subida va a la ruta privada de la reserva; después se finaliza. Solo adm cambia precios.',
  },
  {
    id: 'exportar', titulo: 'Exportar', roles: ['sup', 'adm'], lecturas: [], llamadas: ['exportarProductosCsv'],
    notas: 'Solo exportación del catálogo. Los productos se importan por Inventarios; la consola no crea productos.',
  },
  {
    id: 'apariencia', titulo: 'Apariencia', roles: ['adm'], lecturas: ['sitio', 'carruseles', 'medios'],
    llamadas: ['guardarConfigSitio', 'guardarCarrusel'],
    notas: '5 plantillas (PLANTILLAS), vista previa en claro y oscuro (la dibuja el sitio), número de WhatsApp e identificadores de medición.',
  },
  {
    id: 'secciones', titulo: 'Secciones', roles: ['adm'], lecturas: ['secciones', 'sitio'],
    llamadas: ['guardarSeccion', 'eliminarSeccion', 'ordenarSecciones'], notas: 'Hasta 5; bloques tipados (texto, imagen, carrusel, enlaces con lista blanca).',
  },
  {
    id: 'usuarios', titulo: 'Usuarios', roles: ['adm'], lecturas: [], llamadas: ['asignarRol', 'quitarRol'],
    notas: 'Funciones de identidad del núcleo (tope de 3 usuarios con verificarYReservar); la consola no las reimplementa.',
  },
];
