// Con PRUEBAS_FUNCIONES_EXIGIR=1 (lo fija `pnpm test:funciones`) las suites contra el emulador no pueden omitirse
// en silencio: si el emulador no está, o App Check no está exigido, estas pruebas fallan. Sin esa variable
// (npm test a secas) pasan y las suites contra el emulador se omiten. Las suites que `probar.mjs` agrega a
// pruebas/funciones (pruebas/panel/emulador y paquetes/panel/src/appcheck/appcheck.emulador) dependen de lo mismo.
import { describe, expect, it } from 'vitest';
import { appCheckExigido, exigirEmulador, hayEmulador, hayEmuladorStorage } from './ayudas.js';

describe('emulador de Firebase', () => {
  it('está disponible cuando se exige', () => {
    if (exigirEmulador) expect(hayEmulador, 'PRUEBAS_FUNCIONES_EXIGIR=1 pero no hay emulador (use pnpm test:funciones)').toBe(true);
    else expect(true).toBe(true);
  });

  it('el emulador de Storage está disponible cuando se exige (las suites de Storage no se omiten)', () => {
    if (exigirEmulador) expect(hayEmuladorStorage, 'PRUEBAS_FUNCIONES_EXIGIR=1 pero falta FIREBASE_STORAGE_EMULATOR_HOST: las pruebas de Storage se omitirían (use pnpm test:funciones, con storage en --only)').toBe(true);
    else expect(true).toBe(true);
  });

  it('App Check está exigido en los callables cuando se exige el emulador', () => {
    if (exigirEmulador) expect(appCheckExigido, 'PRUEBAS_FUNCIONES_EXIGIR=1 sin APP_CHECK_EXIGIDO=true: appcheck.emulador.test.ts se omitiría').toBe(true);
    else expect(true).toBe(true);
  });
});
