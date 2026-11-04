import { manifiestoNucleo } from './manifiesto.js';
import { crearRegistro } from './registro/registro.js';
import type { ManifiestoModulo } from './registro/tipos.js';

/**
 * Registro de la plataforma. Vive en su propio archivo, sin importar el resto del núcleo,
 * para que el generador de reglas lo cargue sin compilar código con sintaxis que Node no
 * puede ejecutar sin transpilar.
 */
export const registroPlataforma = crearRegistro<ManifiestoModulo>();
registroPlataforma.registrar(manifiestoNucleo);
