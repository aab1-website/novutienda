// Token de App Check del emulador. SOLO existe en la compilación `--mode emulador`: `api/firebase.ts` lo importa
// únicamente detrás de `import.meta.env.MODE === 'emulador'`, así que el paquete de producción no lo incluye.
// El emulador de Functions no verifica la firma de los tokens (`skipTokenVerification`): solo decodifica un JWT y toma el
// identificador de la app de `sub`. Por eso el token es un JWT sin firma, hecho al vuelo y sin ningún secreto.
import { CustomProvider } from 'firebase/app-check';

const base64url = (o: object): string => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** JWT sin firma que el emulador acepta como App Check; `ahoraMs` y `vigenciaMs` solo para pruebas. */
export function tokenAppCheckEmulador(ahoraMs: number = Date.now(), vigenciaMs: number = 3_600_000): string {
  const exp = Math.floor((ahoraMs + vigenciaMs) / 1000);
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({ sub: '1:000000000000:web:emulador', aud: ['projects/demo-pruebas'], iss: 'https://firebaseappcheck.googleapis.com/000000000000', iat: Math.floor(ahoraMs / 1000), exp })}.sin-firma`;
}

export const proveedorEmulador = new CustomProvider({
  getToken: () => Promise.resolve({ token: tokenAppCheckEmulador(), expireTimeMillis: Date.now() + 3_600_000 }),
});
