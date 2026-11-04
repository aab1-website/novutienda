import type { ClienteApi } from './api/cliente.js';
import type { AlmacenSubidas } from './subidas/almacen.js';
import type { Sesion } from './sesion/sesion.js';

export interface Servicios {
  readonly sesion: Sesion;
  readonly api: ClienteApi;
  readonly almacen: AlmacenSubidas;
}

/**
 * Compone los servicios según el modo de compilación. `humo` (pruebas de navegador y desarrollo) usa los dobles en
 * memoria; cualquier otro modo usa Firebase. La rama del doble se elimina del paquete de producción.
 */
export async function crearServicios(): Promise<Servicios> {
  if (import.meta.env.MODE === 'humo') {
    const { SesionDoble } = await import('./sesion/doble.js');
    const { ClienteDoble } = await import('./doble/doble.js');
    const sesion = new SesionDoble();
    const api = new ClienteDoble({ usuario: () => sesion.actual() ?? { uid: 'anonimo', rol: 'caj' } });
    const { AlmacenSubidasDoble } = await import('./subidas/almacen.js');
    return { sesion, api, almacen: new AlmacenSubidasDoble() };
  }
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
function configuracionFirebase(): { apiKey: string; authDomain: string; projectId: string; storageBucket?: string } {
  const env = import.meta.env;
  // Pruebas contra el emulador: proyecto ficticio, sin ninguna credencial.
  if (import.meta.env.MODE === 'emulador') return { apiKey: 'clave-falsa', authDomain: 'localhost', projectId: 'demo-pruebas', storageBucket: 'demo-pruebas.appspot.com' };
  return { apiKey: String(env['VITE_FIREBASE_API_KEY'] ?? ''), authDomain: String(env['VITE_FIREBASE_AUTH_DOMAIN'] ?? ''), projectId: String(env['VITE_FIREBASE_PROJECT_ID'] ?? ''), storageBucket: String(env['VITE_FIREBASE_STORAGE_BUCKET'] ?? '') };
}
