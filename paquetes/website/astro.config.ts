// Sitio estático con islas de Preact. La CSP es estricta: ningún estilo ni script en línea
// salvo los arranques de las islas, que se autorizan por hash tras el build (ver sellar-csp).
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
// La configuración de Astro vive en la raíz del paquete: aquí la ruta relativa a `src/` es del propio paquete.
/* eslint-disable no-restricted-imports */
import { cargarContenido } from './src/contenido/cargar.ts';
import { pendientesDeConfirmar } from './src/contenido/consultas.ts';
import { integracionSellarCsp } from './src/integraciones/sellar-csp.ts';
/* eslint-enable no-restricted-imports */

const contenido = cargarContenido();
const { config } = contenido;
for (const texto of pendientesDeConfirmar(contenido)) console.warn(`CONFIRMAR (no se publica): ${texto}`);

export default defineConfig({
  site: config.origen,
  output: 'static',
  // Fuera del paquete: `dist/` de la raíz ya está ignorado por ESLint y por git.
  // SITIO_OUT_DIR (solo pruebas de build con otro contenido, ruta absoluta o relativa al paquete): no pisa dist/website.
  outDir: process.env['SITIO_OUT_DIR'] || '../../dist/website',
  trailingSlash: 'never',
  build: {
    format: 'file',
    // Hojas de estilo siempre en archivo propio: la CSP no admite <style> en línea.
    inlineStylesheets: 'never',
  },
  devToolbar: { enabled: false },
  integrations: [
    preact(),
    integracionSellarCsp({
      medicion: config.medicion,
      recaptcha: config.recaptchaSiteKey !== null,
      appCheck: config.appCheck !== null,
      origenMedios: config.origenMedios,
      // El host de medios se declara aquí también: la verificación del dist rechaza todo recurso de un dominio no declarado.
      hostsPermitidos: ['wa.me', new URL(config.origen).hostname, ...(config.origenMedios !== null ? [new URL(config.origenMedios).hostname] : []), ...config.enlacesPermitidos],
    }),
  ],
  vite: {
    build: {
      // Con el valor por defecto Astro incrusta scripts pequeños en el HTML y la CSP los bloquearía.
      assetsInlineLimit: 0,
    },
  },
});
