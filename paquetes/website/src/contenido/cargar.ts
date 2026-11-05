/**
 * Carga del contenido para el build. Sin configuración usa el ejemplo (marcado como tal);
 * con `SITIO_CONTENIDO` apunta al JSON de `publicado/` que entrega la reconstrucción.
 * En ambos casos el contenido se valida: un archivo inválido detiene el build.
 * El build de PRODUCCIÓN (`APP_ENV=production`) falla si el contenido es el de ejemplo (`config.esEjemplo`): el sitio
 * real nunca se publica con nombres, precios, teléfonos ni política de redondeo inventados.
 */
import { readFileSync } from 'node:fs';
import { contenidoEjemplo } from './ejemplo.js';
import type { Contenido } from './tipos.js';
import { validarContenido } from './validar.js';

export function cargarContenido(
  rutaJson: string | undefined = process.env['SITIO_CONTENIDO'],
  ambiente: string | undefined = process.env['APP_ENV'],
): Contenido {
  const crudo: unknown = rutaJson === undefined || rutaJson === '' ? contenidoEjemplo : JSON.parse(readFileSync(rutaJson, 'utf8'));
  const r = validarContenido(crudo);
  if (!r.ok) throw new Error(`Contenido del sitio inválido:\n - ${r.errores.join('\n - ')}`);
  if (ambiente === 'production' && r.contenido.config.esEjemplo) {
    throw new Error(
      'El build de producción no admite el contenido de ejemplo (config.esEjemplo): defina SITIO_CONTENIDO con el JSON publicado (docs/produccion/reconstruccion-sitio.md).',
    );
  }
  return r.contenido;
}
