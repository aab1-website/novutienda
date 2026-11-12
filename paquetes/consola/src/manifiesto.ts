import type { AccionManifiesto, ColeccionManifiesto, ManifiestoModulo, Rol, RutaAlmacenamiento } from '@novutienda/nucleo';
import { LIMITES_CONSOLA } from './limites.js';

/** Ninguna colección se lee directo desde el navegador: el panel no usa Firestore y consulta por los callables (decisiones.md). */
const SIN_LECTURA_DIRECTA: readonly Rol[] = [];

/**
 * Todas las colecciones de la consola: el navegador no lee ni escribe (`lectura: []`); solo el servidor, con las funciones de
 * este módulo, y el panel consulta por los callables. Cada una es de un segmento (`tenants/{t}/<ruta>/{id}`):
 *  - `fichasWeb/{productoId}`, `secciones/{id}`, `carruseles/{plantilla}`: contenido editable.
 *  - `sitio/{config|indice|slugs|estado}`: configuración, orden de secciones, índice de slugs y cambios sin publicar.
 *  - `publicado/{...}`: copia que lee la reconstrucción del sitio (con el servidor); solo adm ve su estado por el callable.
 *  - `subidas/{id}`, `medios/{id}`: reservas y medios procesados.
 *  - `uso/medios`: cuota transaccional de originales y conteo de fotos/videos por producto.
 *  - `reconstrucciones/{id}`: solicitudes de reconstrucción del sitio que escribe `disparador-sitio.ts` y lee/actualiza
 *    `http/sitio.ts` (conector del sitio); solo el servidor.
 * `sup` puede leer todo y, por las funciones del servidor, editar fichas y subir medios; precios, importación,
 * secciones, apariencia y publicación son de `adm`.
 * No emite eventos v1. Consume `producto.cambiado` de forma opcional (`consumeOpcional`: solo si Inventarios está activo; lo cablea
 * el coordinador en `consumidores.ts`). La disponibilidad pública se sirve por `/api/disponibilidad` y la reconstrucción se
 * agenda desde la publicación, no desde el stock.
 */
const colecciones: readonly ColeccionManifiesto[] = [
  { ruta: 'fichasWeb', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'secciones', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'carruseles', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'sitio', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'publicado', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'subidas', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'medios', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'uso', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
  { ruta: 'reconstrucciones', lectura: SIN_LECTURA_DIRECTA, escritura: 'servidor' },
];

/**
 * Rutas de Storage (relativas a `tenants/{t}/`). Quién escribe cada una:
 *  - `privado/originales/...`: el navegador SOLO crea (nunca actualiza ni borra), con rol sup/adm y una reserva vigente en
 *    `subidas` hecha antes por el servidor. Los campos de la reserva (`estado`, `venceEn`, `productoId`, `por`, `bytes`, `tipo`)
 *    son contrato con `src/medios/subidas.ts`; `tipo` es `'foto'` o `'video'`. Lectura: solo el servidor.
 *  - `privado/procesando/**`: temporales; lee y escribe solo el servidor.
 *  - `publico/medios/**`: el servidor procesa y publica; lo lee el sitio (lectura pública). Es la única ruta pública que usa
 *    el módulo (`rutaPublicaMedio`); nada más bajo `publico/` queda legible.
 */
const almacenamiento: readonly RutaAlmacenamiento[] = [
  {
    ruta: 'privado/originales/{productoId}/{subidaId}',
    lectura: 'servidor',
    escritura: {
      tipo: 'subidaReservada',
      roles: ['sup', 'adm'],
      reserva: 'subidas',
      archivos: [
        { tipo: 'foto', bytesMax: LIMITES_CONSOLA.bytesFoto, contentType: 'image/(jpeg|png|webp|heic)' },
        { tipo: 'video', bytesMax: LIMITES_CONSOLA.bytesVideo, contentType: 'video/(mp4|quicktime|webm)' },
      ],
    },
  },
  { ruta: 'privado/procesando/{ruta=**}', lectura: 'servidor', escritura: 'servidor' },
  { ruta: 'publico/medios/{ruta=**}', lectura: 'publica', escritura: 'servidor' },
];

const accion = (callable: string, nombre: string, roles: readonly Rol[]): AccionManifiesto => ({ callable, nombre, roles });

const ACCIONES_CONSOLA: readonly (readonly [string, readonly Rol[]])[] = [
  ['crearProducto', ['adm']],
  ['editarProducto', ['adm']],
  ['cambiarPrecioUSD', ['adm']],
  ['catalogo', ['sup', 'adm']],
  ['preciosDelDia', ['sup', 'adm']],
  ['guardarFicha', ['sup', 'adm']],
  ['leerFicha', ['sup', 'adm']],
  ['guardarSeccion', ['adm']],
  ['eliminarSeccion', ['adm']],
  ['ordenarSecciones', ['adm']],
  ['guardarCarrusel', ['adm']],
  ['guardarConfigSitio', ['adm']],
  ['fichas', ['sup', 'adm']],
  ['secciones', ['sup', 'adm']],
  ['carruseles', ['sup', 'adm']],
  ['configSitio', ['sup', 'adm']],
  ['simularImportacion', ['adm']],
  ['importarProductos', ['adm']],
  ['exportarProductosCsv', ['sup', 'adm']],
  ['publicarSitio', ['adm']],
  ['tablero', ['sup', 'adm']],
  ['alertas', ['sup', 'adm']],
  ['auditoria', ['sup', 'adm']],
];

const ACCIONES_MEDIOS: readonly (readonly [string, readonly Rol[]])[] = [
  ['reservarSubida', ['sup', 'adm']],
  ['finalizarSubida', ['sup', 'adm']],
  ['estadoSubida', ['sup', 'adm']],
  ['borrarMedio', ['sup', 'adm']],
  ['listarMedios', ['sup', 'adm']],
];

/** Manifiesto del módulo consola (administración del catálogo y del sitio). Lo registra el coordinador. */
export const manifiestoConsola: ManifiestoModulo = {
  id: 'consola',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  zona: 'modulo',
  submodulos: [],
  colecciones,
  emite: [],
  consume: [],
  consumeOpcional: ['producto.cambiado'],
  almacenamiento,
  acciones: [
    ...ACCIONES_CONSOLA.map(([nombre, roles]) => accion('consola', nombre, roles)),
    ...ACCIONES_MEDIOS.map(([nombre, roles]) => accion('medios', nombre, roles)),
  ],
  pantallas: [
    { id: 'catalogo', titulo: 'Catálogo y sitio', roles: ['sup', 'adm'], orden: 70 },
  ],
  programadas: [
    { id: 'limpiezaSubidas', horario: 'every 60 minutes', zonaHoraria: 'America/La_Paz', porTenant: true },
    { id: 'temporizadorSitio', horario: 'every 5 minutes', zonaHoraria: 'America/La_Paz', porTenant: true },
  ],
  requiere: ['inventarios'],
  rutasHttp: [{ ruta: '/api/novuchat/v1/catalogo' }, { ruta: '/api/sitio/v1', prefijo: true }],
};
