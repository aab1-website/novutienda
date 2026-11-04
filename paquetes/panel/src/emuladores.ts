// Conexión del panel a los emuladores de Firebase. SOLO existe en la compilación `--mode emulador` (pruebas de punta a
// punta contra las funciones reales con el proyecto ficticio `demo-pruebas`); el paquete de producción no la incluye
// porque `servicios.ts` la importa únicamente detrás de `import.meta.env.MODE === 'emulador'`.
import { getApp } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';

/** Puertos de `firebase.json` (auth 8240, storage 8243, functions 8245). */
export const PUERTOS_EMULADOR = { auth: 8240, storage: 8243, functions: 8245 } as const;

export const URL_AUTH_EMULADOR = `http://127.0.0.1:${String(PUERTOS_EMULADOR.auth)}`;

export function conectarFuncionesYAlmacen(region = 'us-east1'): void {
  const app = getApp();
  connectFunctionsEmulator(getFunctions(app, region), '127.0.0.1', PUERTOS_EMULADOR.functions);
  connectStorageEmulator(getStorage(app), '127.0.0.1', PUERTOS_EMULADOR.storage);
}
