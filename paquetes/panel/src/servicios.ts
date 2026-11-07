import type { ClienteApi } from './api/cliente.js';
import type { AlmacenSubidas } from './subidas/almacen.js';
import type { Sesion } from './sesion/sesion.js';

export interface Servicios {
  readonly sesion: Sesion;
  readonly api: ClienteApi;
  readonly almacen: AlmacenSubidas;
}

/**
 * Compone los servicios reales (Firebase; en modo `emulador`, contra los emuladores). El modo `humo` no pasa por aquí:
 * su arranque es `doble/arranque.tsx`, que vite.config.ts sustituye en el HTML solo en ese modo.
 */
export async function crearServicios(): Promise<Servicios> {
  const { SesionFirebase } = await import('./sesion/firebase.js');
  const { TransporteFirebase } = await import('./api/firebase.js');
  const { ClienteRemoto } = await import('./api/transporte.js');
  const emulador = import.meta.env.MODE === 'emulador';
  const emuladores = emulador ? await import('./emuladores.js') : undefined;
  const sesion = new SesionFirebase(configuracionFirebase(), emuladores?.URL_AUTH_EMULADOR);
  emuladores?.conectarFuncionesYAlmacen();
  const api = new ClienteRemoto(new TransporteFirebase(), () => ({ tenantId: sesion.actual()?.tenantId ?? '', rol: sesion.actual()?.rol }));
  const { AlmacenSubidasFirebase } = await import('./subidas/firebase.js');
  return { sesion, api, almacen: new AlmacenSubidasFirebase() };
}

/** La configuración web de Firebase (pública) llega por variables de compilación, nunca está en el repositorio. */
function configuracionFirebase(): { apiKey: string; authDomain: string; projectId: string; storageBucket?: string; appId?: string } {
  const env = import.meta.env;
  // Pruebas contra el emulador: proyecto ficticio, sin ninguna credencial.
  if (import.meta.env.MODE === 'emulador') return { apiKey: 'clave-falsa', authDomain: 'localhost', projectId: 'demo-pruebas', storageBucket: 'demo-pruebas.appspot.com', appId: '1:0:web:emulador' };
  return { apiKey: String(env['VITE_FIREBASE_API_KEY'] ?? ''), authDomain: String(env['VITE_FIREBASE_AUTH_DOMAIN'] ?? ''), projectId: String(env['VITE_FIREBASE_PROJECT_ID'] ?? ''), storageBucket: String(env['VITE_FIREBASE_STORAGE_BUCKET'] ?? ''), appId: String(env['VITE_FIREBASE_APP_ID'] ?? '') };
}
