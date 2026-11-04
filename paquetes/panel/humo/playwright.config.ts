import { defineConfig } from '@playwright/test';

const puerto = Number(process.env['PUERTO_HUMO'] ?? 4341);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // Fuera del paquete (dist/ de la raíz está ignorado por git, ESLint y la prueba de fronteras).
  outputDir: '../../../dist/panel-humo-resultados',
  reporter: 'list',
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${puerto}`,
    // Usa el Chrome instalado en el sistema; en CI puede reemplazarse con PLAYWRIGHT_CHANNEL.
    channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
    locale: 'es-BO',
    viewport: { width: 1280, height: 900 },
  },
  webServer: { command: 'node servidor.mjs', url: `http://127.0.0.1:${puerto}/`, reuseExistingServer: false, timeout: 15_000 },
});
