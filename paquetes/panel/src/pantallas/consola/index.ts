// Entrada pública de la interfaz del módulo consola dentro del panel (`@novutienda/panel/consola`, package.json
// `exports`). Lo que una prueba de fuera del paquete necesita de esta carpeta se exporta aquí, no desde `src/index.ts`
// (Central no reexporta piezas de módulo; plano §6.5, T2).
// Espera de una subida de medios (consulta de estado con retroceso y respaldo `finalizarSubida`).
export { esperarSubida } from './esperar.js';
// Lectura de la duración de un video por sus bytes (sin DOM); la usa la prueba contra clips reales de ffmpeg.
export { leerDuracionVideo } from './validar-archivo.js';
