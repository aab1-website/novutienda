// App Check exigido, contra las funciones reales en el emulador. Se omite sin emulador y sin `APP_CHECK_EXIGIDO=true`:
//   APP_CHECK_EXIGIDO=true node paquetes/panel/scripts/emulador.mjs "npx vitest --run paquetes/panel/src/appcheck/appcheck.emulador.test.ts"
// El marco rechaza ANTES de autenticar, así que no hace falta ninguna cuenta: sin token, `unauthenticated` con el mensaje de
// App Check; con el token del emulador, la llamada pasa App Check y falla después por falta de sesión (otro mensaje).
import { describe, expect, it } from 'vitest';
import { tokenAppCheckEmulador } from './emulador.js';

// El paquete no declara los tipos de Node (es código de navegador): el entorno se lee de `globalThis`.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const hayEmulador = env['FIRESTORE_EMULATOR_HOST'] !== undefined && env['FIREBASE_AUTH_EMULATOR_HOST'] !== undefined;
const exigido = env['APP_CHECK_EXIGIDO'] === 'true';
const URL = 'http://127.0.0.1:8245/demo-pruebas/us-east1/consola';
const sobre = { data: { accion: 'listarUsuarios', tenantId: 'tienda-prueba' } };

async function llamar(cabeceras: Record<string, string>): Promise<{ status: number; mensaje: string }> {
  const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: JSON.stringify(sobre) });
  const j = (await r.json()) as { error?: { message?: string } };
  return { status: r.status, mensaje: j.error?.message ?? '' };
}

describe.skipIf(!hayEmulador || !exigido)('App Check exigido (emulador)', () => {
  it('sin token de App Check la llamada se rechaza', async () => {
    const r = await llamar({});
    expect(r.status).toBe(401);
    expect(r.mensaje).toMatch(/App Check/);
  });

  it('con el token del emulador pasa App Check (y se detiene en la autenticación)', async () => {
    const r = await llamar({ 'X-Firebase-AppCheck': tokenAppCheckEmulador() });
    expect(r.mensaje).not.toMatch(/App Check/);
    expect(r.status).toBe(401);
  });
});
