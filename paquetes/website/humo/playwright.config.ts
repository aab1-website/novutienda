import { defineConfig } from '@playwright/test';

const puerto = Number(process.env['PUERTO_HUMO'] ?? 4331);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  testIgnore: 'paginas.spec.ts',
  // Fuera del paquete (dist/ de la raíz está ignorado por git, ESLint y la prueba de fronteras).
  outputDir: '../../../dist/humo-resultados',
  reporter: 'list',
  // Debe superar el tope de hidratación de humo.spec.ts (25 s) más lo que el propio caso hace después.
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${puerto}`,
    // Usa el Chrome instalado en el sistema; en CI puede reemplazarse con PLAYWRIGHT_CHANNEL.
    channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
    locale: 'es-BO',
  },
  webServer: { command: 'node servidor.mjs', url: `http://127.0.0.1:${puerto}/`, reuseExistingServer: false, timeout: 15_000 },
});
