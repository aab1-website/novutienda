// Ayudas de las pruebas contra el emulador de Firebase (Auth, Firestore, Storage y Functions). Solo se usan
// dentro de `pnpm test:funciones` (firebase emulators:exec); sin emulador las suites se omiten.
import { createHmac } from 'node:crypto';
import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  UBICACIONES, crearProducto, crearUbicacion, ingresar, type Autor,
} from '@novutienda/inventarios';
import { cargarManual, construirClaim, type Rol } from '@novutienda/nucleo';
import { almacenCotizacionesDesde } from '../../plataforma/adaptadores/index.js';
import { crearBaseDatos, type BaseDatosFirestore, type Bucket } from '../../plataforma/adaptadores/firebase/index.js';


export const PROYECTO = 'demo-pruebas';
export const BUCKET = `${PROYECTO}.appspot.com`;
export const REGION = 'us-east1';
export const T = 'casa-bermejo';
export const OTRO = 'otra-casa';

export const hayEmulador = process.env['FIRESTORE_EMULATOR_HOST'] !== undefined && process.env['FIREBASE_AUTH_EMULATOR_HOST'] !== undefined;
export const exigirEmulador = process.env['PRUEBAS_FUNCIONES_EXIGIR'] === '1';
/** `pnpm test:funciones` corre con App Check exigido en los callables (como producción): toda llamada lleva token. */
export const appCheckExigido = process.env['APP_CHECK_EXIGIDO'] === 'true';

const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** JWT sin firma que el emulador de Functions acepta como App Check (no verifica la firma; toma la app de `sub`). */
export function tokenAppCheckPrueba(ahoraMs: number = Date.now()): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: '1:000000000000:web:emulador', aud: ['projects/demo-pruebas'], iss: 'https://firebaseappcheck.googleapis.com/000000000000', iat: Math.floor(ahoraMs / 1000), exp: Math.floor((ahoraMs + 3_600_000) / 1000) })}.sin-firma`;
}

const puertoFunciones = 8245;
export const URL_FUNCIONES = `http://127.0.0.1:${String(puertoFunciones)}/${PROYECTO}/${REGION}`;

export interface Herramientas {
  readonly app: App;
  readonly auth: Auth;
  readonly firestore: Firestore;
  readonly bucket: Bucket;
  readonly db: BaseDatosFirestore;
}

export function herramientas(): Herramientas {
  const app = getApps()[0] ?? initializeApp({ projectId: PROYECTO, storageBucket: BUCKET });
  const firestore = getFirestore(app);
  return { app, auth: getAuth(app), firestore, bucket: getStorage(app).bucket(BUCKET), db: crearBaseDatos(firestore) };
}

let contador = 0;
export const unico = (prefijo: string): string => `${prefijo}-${String(Date.now())}-${String((contador += 1))}`;

const UUID_BASE = '00000000-0000-4000-8000-';
export const uuid = (): string => `${UUID_BASE}${String(Date.now() % 1_000_000).padStart(6, '0')}${String((contador += 1)).padStart(6, '0')}`;

export interface Usuario {
  readonly uid: string;
  readonly correo: string;
  readonly token: string;
}

const CLAVE = 'contraseña-de-prueba-123';

/** Token de ID del emulador de Auth (inicio de sesión con correo y contraseña). */
export async function iniciarSesion(correo: string): Promise<string> {
  const host = process.env['FIREBASE_AUTH_EMULATOR_HOST'] ?? '127.0.0.1:8240';
  const r = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=clave-falsa`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: CLAVE, returnSecureToken: true }),
  });
  const j = (await r.json()) as { idToken?: string };
  if (j.idToken === undefined) throw new Error('el emulador de Auth no devolvió token');
  return j.idToken;
}

export async function crearUsuario(
  h: Herramientas,
  o: { rol?: Rol; tenant?: string; verificado?: boolean; roles?: Record<string, Rol>; propietario?: boolean },
): Promise<Usuario> {
  const correo = `${unico('u')}@prueba.test`;
  const u = await h.auth.createUser({ email: correo, password: CLAVE, emailVerified: o.verificado !== false });
  const roles = o.roles ?? (o.rol !== undefined ? { [o.tenant ?? T]: o.rol } : {});
  const claim = construirClaim(roles, 1, o.propietario === true);
  if (!claim.ok) throw new Error(claim.error);
  await h.auth.setCustomUserClaims(u.uid, { ...claim.valor });
  return { uid: u.uid, correo, token: await iniciarSesion(correo) };
}

export interface RespuestaLlamada {
  readonly status: number;
  readonly resultado?: unknown;
  readonly error?: { readonly status?: string; readonly message?: string; readonly details?: unknown };
}

/** Invoca un callable por el protocolo HTTP del SDK (`{data}` → `{result}` o `{error}`). */
export async function llamar(funcion: string, datos: unknown, token?: string, extra: Record<string, string> = {}): Promise<RespuestaLlamada> {
  const r = await fetch(`${URL_FUNCIONES}/${funcion}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      ...(appCheckExigido ? { 'x-firebase-appcheck': tokenAppCheckPrueba() } : {}),
      ...extra,
    },
    body: JSON.stringify({ data: datos }),
  });
  const j = (await r.json()) as { result?: unknown; error?: RespuestaLlamada['error'] };
  return { status: r.status, ...(j.result !== undefined ? { resultado: j.result } : {}), ...(j.error !== undefined ? { error: j.error } : {}) };
}

/** `llamar` a un callable de módulo: `{accion, tenantId, datos}`. */
export const accion = (modulo: string, nombre: string, datos: unknown, token: string | undefined, tenantId = T): Promise<RespuestaLlamada> =>
  llamar(modulo, { accion: nombre, tenantId, datos }, token);

export interface RespuestaHttp {
  readonly status: number;
  readonly cabeceras: Headers;
  readonly cuerpo: unknown;
  readonly texto: string;
}

export async function http(ruta: string, init: RequestInit = {}): Promise<RespuestaHttp> {
  const r = await fetch(`${URL_FUNCIONES}/api${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = texto === '' ? undefined : JSON.parse(texto);
  } catch {
    /* texto plano */
  }
  return { status: r.status, cabeceras: r.headers, cuerpo, texto };
}

/** Firma HMAC-SHA256 de `{marca}.{texto}` (pedido de NovuChat y endpoints del sitio). */
export const firmar = (secreto: string, marca: string, texto: string): string => createHmac('sha256', secreto).update(`${marca}.${texto}`).digest('hex');

export async function esperar<T>(fn: () => Promise<T | undefined | false>, ms = 20_000, que = 'condición'): Promise<T> {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > limite) throw new Error(`tiempo agotado esperando: ${que}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const ADM: Autor = { uid: 'sembrador', rol: 'adm' };

/** Fecha de hoy en La Paz (aaaa-mm-dd). */
export const hoyLaPaz = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());

export interface OpcionesSembrado {
  readonly productos?: readonly { id: string; nombre: string; precioUSD: { bo: number; ar: number }; tienda: number; deposito?: number; conSerie?: boolean; series?: string[]; publicado?: boolean }[];
}

/** Tenant con almacenes, cotizaciones del día y productos, escrito con las funciones reales de los módulos. */
export async function sembrarTenant(h: Herramientas, tenantId: string, o: OpcionesSembrado = {}): Promise<void> {
  await h.firestore.doc(`tenants/${tenantId}`).set({ plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
  for (const u of UBICACIONES) {
    await h.db.runTransaction((tx) => crearUbicacion(tx, { tenantId, operacionId: unico('ubic'), por: ADM, ubicacionId: u, nombre: u }));
  }
  const almacen = almacenCotizacionesDesde(h.db);
  for (const [mercado, valor] of [['BO', 7], ['AR', 1000]] as const) {
    await cargarManual(almacen, { mercado, valor, fecha: hoyLaPaz(), actor: { uid: 'sembrador', rol: 'adm', proveedor: 'password' }, ahoraMs: Date.now() }, { tenantId });
  }
  for (const p of o.productos ?? []) {
    await h.db.runTransaction((tx) =>
      crearProducto(tx, {
        tenantId, operacionId: unico('prod'), por: ADM,
        producto: { id: p.id, nombre: p.nombre, categoria: 'general', sku: `SKU-${p.id}`, precioUSD: p.precioUSD, ...(p.conSerie === true ? { conSerie: true, garantiaMeses: 12 } : {}), publicado: p.publicado ?? true },
      }),
    );
    if (p.tienda > 0) {
      await h.db.runTransaction((tx) =>
        ingresar(tx, { tenantId, operacionId: unico('ing'), por: { uid: 'sembrador', rol: 'sup' }, ubicacionId: 'tienda', lineas: [{ productoId: p.id, cantidad: p.tienda, ...(p.series !== undefined ? { series: p.series } : {}) }] }),
      );
    }
  }
}
