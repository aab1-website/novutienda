import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Humo del catálogo de más de una página: compila el sitio con 41 productos (ver `paginas-preparar.mts`) y lo sirve en otro puerto.
const puerto = Number(process.env['PUERTO_HUMO_PAGINAS'] ?? 4332);
const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const DIST_PAGINAS = resolve(raiz, 'dist/prueba-paginas');

export default defineConfig({
  testDir: '.',
  testMatch: 'paginas.spec.ts',
  outputDir: '../../../dist/humo-resultados-paginas',
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${puerto}`,
    channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
    locale: 'es-BO',
  },
  webServer: {
    command: 'node paginas-preparar.mts && node servidor.mjs',
    url: `http://127.0.0.1:${puerto}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PUERTO_HUMO: String(puerto), SITIO_OUT_DIR: DIST_PAGINAS },
  },
});
