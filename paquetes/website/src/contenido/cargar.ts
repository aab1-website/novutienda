/**
 * Carga del contenido para el build. Sin configuración usa el ejemplo (marcado como tal);
 * con `SITIO_CONTENIDO` apunta al JSON de `publicado/` que entrega la reconstrucción.
 * En ambos casos el contenido se valida: un archivo inválido detiene el build.
 */
import { readFileSync } from 'node:fs';
import { contenidoEjemplo } from './ejemplo.js';
import type { Contenido } from './tipos.js';
import { validarContenido } from './validar.js';

export function cargarContenido(rutaJson: string | undefined = process.env['SITIO_CONTENIDO']): Contenido {
  const crudo: unknown = rutaJson === undefined || rutaJson === '' ? contenidoEjemplo : JSON.parse(readFileSync(rutaJson, 'utf8'));
  const r = validarContenido(crudo);
  if (!r.ok) throw new Error(`Contenido del sitio inválido:\n - ${r.errores.join('\n - ')}`);
  return r.contenido;
}
