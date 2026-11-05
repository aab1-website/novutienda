// Autenticación de los callables. El marco de Functions ya valida la firma del token, pero NO la revocación
// ni `email_verified`; aquí se verifica el token crudo con `checkRevoked`, se exige correo verificado y se lee
// el rol del claim `pl` (nunca de un campo enviado por el cliente). Cada fallo corta con un `HttpsError`.
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { esTenantIdValido, esPropietario, proveedorDe, rolEn, type Rol } from '@novutienda/nucleo';
import type { Entorno } from './entorno.js';

export interface Sesion {
  readonly uid: string;
  /** Token decodificado: lo usan `asignarRol`/`quitarRol` (proveedor y claim del actor). */
  readonly claims: DecodedIdToken;
  readonly proveedor: string;
  readonly propietario: boolean;
}

export interface SesionTenant extends Sesion {
  readonly tenantId: string;
  readonly rol: Rol;
}

const BEARER = /^Bearer\s+(\S+)$/i;

function tokenDe(req: { readonly rawRequest: { readonly headers: Readonly<Record<string, string | string[] | undefined>> } }): string {
  const h = req.rawRequest.headers['authorization'];
  const valor = Array.isArray(h) ? h[0] : h;
  const m = valor === undefined ? null : BEARER.exec(valor);
  if (m?.[1] === undefined) throw new HttpsError('unauthenticated', 'Inicie sesión para continuar.');
  return m[1];
}

/**
 * Verifica la sesión: token vigente y no revocado, correo verificado y sin sesión anónima.
 * Un fallo de cualquier tipo es `unauthenticated` (HTTP 401) con un mensaje genérico.
 */
export async function autenticar(e: Pick<Entorno, 'auth'>, req: Pick<CallableRequest, 'rawRequest'>): Promise<Sesion> {
  const token = tokenDe(req);
  let claims: DecodedIdToken;
  try {
    claims = await e.auth.verifyIdToken(token, true);
  } catch {
    throw new HttpsError('unauthenticated', 'La sesión no es válida o fue revocada. Vuelva a iniciar sesión.');
  }
  if (claims.email_verified !== true) throw new HttpsError('unauthenticated', 'Verifique su correo para ingresar.');
  const proveedor = proveedorDe(claims);
  if (proveedor === 'anonymous' || proveedor === '') throw new HttpsError('unauthenticated', 'Se requiere una sesión con cuenta.');
  return { uid: claims.uid, claims, proveedor, propietario: esPropietario(claims) };
}

/** Sesión del personal del tenant: correo y contraseña, y un rol en ESE tenant (no el de otro). */
export function personalDelTenant(s: Sesion, tenantId: string): SesionTenant {
  if (!esTenantIdValido(tenantId)) throw new HttpsError('invalid-argument', 'tenantId inválido.');
  const rol = rolEn(s.claims, tenantId);
  if (s.proveedor !== 'password' || rol === '') throw new HttpsError('permission-denied', 'No tiene permiso en este negocio.');
  return { ...s, tenantId, rol };
}

/** App Check: si la instalación lo exige, la petición debe traer un token válido (el marco lo valida y deja `app`). */
export function exigirAppCheck(exigido: boolean, req: Pick<CallableRequest, 'app'>): void {
  if (exigido && req.app === undefined) throw new HttpsError('unauthenticated', 'La aplicación no está verificada (App Check).');
}
