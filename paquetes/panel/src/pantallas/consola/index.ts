// Entrada pública de la interfaz del módulo consola dentro del panel (`@novutienda/panel/consola`, package.json
// `exports`). Lo que una prueba de fuera del paquete necesita de esta carpeta se exporta aquí, no desde `src/index.ts`
// (Central no reexporta piezas de módulo; plano §6.5, T2).
// Espera de una subida de medios (consulta de estado con retroceso y respaldo `finalizarSubida`).
export { esperarSubida } from './esperar.js';
// Lectura de la duración de un video por sus bytes (sin DOM); la usa la prueba contra clips reales de ffmpeg.
export { leerDuracionVideo } from './validar-archivo.js';
// Revisión de la página de un producto con los topes del servidor (la compara pruebas/consola/ficha-revision.test.ts).
export { revisarFicha, TOPES_FICHA, type ErroresFicha } from './ficha-revision.js';
// Nombres visibles de las plantillas (los compara pruebas/panel/contrato.test.ts con los de la consola).
export { PALETAS } from './plantillas-vista.js';
// Validación del WhatsApp de la tienda (la compara pruebas/consola/sitio.test.ts con la del servidor).
export { esWhatsappValido, pareceNumeroDeRelleno } from './whatsapp.js';
// Pasos puros de «Textos del sitio» (los compara pruebas/consola/textos-sitio.test.ts con los topes del servidor).
export { aEstado, aNegocio, LIMITES_DATOS, mapaValido, revisarTextos, TOPES_TEXTOS } from './textos-sitio-logica.js';
