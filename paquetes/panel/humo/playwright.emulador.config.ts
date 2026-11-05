import { defineConfig } from '@playwright/test';

// Pruebas de punta a punta contra las funciones REALES en el emulador de Firebase. Se lanzan con
// `pnpm --filter @novutienda/panel humo:emulador` (que levanta `firebase emulators:exec`, proyecto demo-pruebas).
const puerto = Number(process.env['PUERTO_EMULADOR'] ?? 4342);

export default defineConfig({
  testDir: '.',
  testMatch: 'real.spec.ts',
  outputDir: '../../../dist/panel-emulador-resultados',
  reporter: 'list',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${String(puerto)}`,
    channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
    locale: 'es-BO',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: 'node servidor.mjs',
    url: `http://127.0.0.1:${String(puerto)}/`,
    reuseExistingServer: false,
    timeout: 15_000,
    env: { PUERTO_HUMO: String(puerto), DIR_PANEL: 'panel-emulador' },
  },
});
