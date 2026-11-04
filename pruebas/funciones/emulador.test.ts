// Con PRUEBAS_FUNCIONES_EXIGIR=1 (lo fija `pnpm test:funciones`) las suites contra el emulador no pueden omitirse
// en silencio: si el emulador no está, esta prueba falla. Sin esa variable (npm test a secas) pasa y las demás se omiten.
import { describe, expect, it } from 'vitest';
import { exigirEmulador, hayEmulador } from './ayudas.js';

describe('emulador de Firebase', () => {
  it('está disponible cuando se exige', () => {
    if (exigirEmulador) expect(hayEmulador, 'PRUEBAS_FUNCIONES_EXIGIR=1 pero no hay emulador (use pnpm test:funciones)').toBe(true);
    else expect(true).toBe(true);
  });
});
