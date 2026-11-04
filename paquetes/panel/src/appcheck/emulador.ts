// Token de App Check del emulador. SOLO existe en la compilación `--mode emulador`: `api/firebase.ts` lo importa
// únicamente detrás de `import.meta.env.MODE === 'emulador'`, así que el paquete de producción no lo incluye.
// El servidor, con `APP_CHECK_MODO=simulado` (solo permitido en el emulador o en pruebas), acepta exactamente este token.
import { CustomProvider } from 'firebase/app-check';

export const TOKEN_APPCHECK_EMULADOR = 'simulado-valido';

export const proveedorEmulador = new CustomProvider({
  getToken: () => Promise.resolve({ token: TOKEN_APPCHECK_EMULADOR, expireTimeMillis: Date.now() + 3_600_000 }),
});
