// Siembra del emulador para las pruebas de navegador del panel real (`paquetes/panel/humo/real.spec.ts`): un negocio con
// almacenes, cotizaciones del día y productos, y cuatro cuentas de correo y contraseña con rol (una sin verificar).
// Solo corre dentro de `pnpm --filter @novutienda/panel humo:emulador` (SEMBRAR_E2E=1); no es una prueba.
import { describe, it, vi } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { hayEmulador, herramientas, sembrarTenant } from '../funciones/ayudas.js';

vi.setConfig({ testTimeout: 90_000 });

export const TENANT_E2E = 'tienda-e2e';
const CLAVE = 'contraseña-de-prueba-123';
const CUENTAS = [
  { correo: 'adm@e2e.test', rol: 'adm', verificado: true },
  { correo: 'sup@e2e.test', rol: 'sup', verificado: true },
  { correo: 'caj@e2e.test', rol: 'caj', verificado: true },
  { correo: 'sinverificar@e2e.test', rol: 'caj', verificado: false },
] as const;

describe.skipIf(!hayEmulador || process.env['SEMBRAR_E2E'] !== '1')('siembra para el navegador (emulador)', () => {
  it('crea el negocio, los productos y las cuentas', async () => {
    const h = herramientas();
    await sembrarTenant(h, TENANT_E2E, {
      productos: [
        { id: 'cable-hdmi', nombre: 'Cable HDMI 2 m', precioUSD: { bo: 800, ar: 900 }, tienda: 25 },
        { id: 'parlante', nombre: 'Parlante portátil', precioUSD: { bo: 2500, ar: 2700 }, tienda: 1 },
      ],
    });
    for (const c of CUENTAS) {
      const u = await h.auth.createUser({ email: c.correo, password: CLAVE, emailVerified: c.verificado });
      const claim = construirClaim({ [TENANT_E2E]: c.rol }, 1, false);
      if (!claim.ok) throw new Error(claim.error);
      await h.auth.setCustomUserClaims(u.uid, { ...claim.valor });
    }
  });
});
