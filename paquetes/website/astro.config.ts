// Sitio estático con islas de Preact. La CSP es estricta: ningún estilo ni script en línea
// salvo los arranques de las islas, que se autorizan por hash tras el build (ver sellar-csp).
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
// La configuración de Astro vive en la raíz del paquete: aquí la ruta relativa a `src/` es del propio paquete.
/* eslint-disable no-restricted-imports */
import { cargarContenido } from './src/contenido/cargar.ts';
import { integracionSellarCsp } from './src/integraciones/sellar-csp.ts';
/* eslint-enable no-restricted-imports */

const { config } = cargarContenido();

export default defineConfig({
  site: config.origen,
  output: 'static',
  // Fuera del paquete: `dist/` de la raíz ya está ignorado por ESLint y por git.
  outDir: '../../dist/website',
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
      origenMedios: config.origenMedios,
      hostsPermitidos: ['wa.me', new URL(config.origen).hostname, ...config.enlacesPermitidos],
    }),
  ],
  vite: {
    build: {
      // Con el valor por defecto Astro incrusta scripts pequeños en el HTML y la CSP los bloquearía.
      assetsInlineLimit: 0,
    },
  },
});
