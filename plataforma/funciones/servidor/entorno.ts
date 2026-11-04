// Composición: arma, en un solo lugar, los puertos reales de la plataforma sobre firebase-admin. Las funciones
// reciben un `Entorno`; las pruebas pueden construir otro con `crearEntorno` (reloj fijo, puertos simulados).
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { CatalogoPuerto, DisparadorSitio, ProcesadorMedios } from '@novutienda/consola';
import { crearCatalogoConsola, almacenCotizacionesDesde, catalogoParaPos, inventariosParaPos } from '../../adaptadores/index.js';
import {
  appCheckReal, appCheckSimulado, crearAlmacenMedios, crearAuthMin, crearBaseDatos, crearConsultaSubidas, crearEjecutorRecibos, crearGuardarContacto,
  crearLecturaRecibos, crearLectorDisponibilidad, crearProcesadorMedios, recaptchaEnterprise, recaptchaSimulado,
  type BaseDatosFirestore, type Bucket,
} from '../../adaptadores/firebase/index.js';
import type { AlmacenMedios, ConsultaSubidas } from '@novutienda/consola';
import type { AlmacenCotizaciones, AuthMin, Redondeo } from '@novutienda/nucleo';
import type { DepsPos } from '@novutienda/pos';
import type { EjecutorRecibos, LecturaRecibos } from '@novutienda/recibos';
import type { GuardarContacto, LectorDisponibilidad, VerificadorAppCheck, VerificadorRecaptcha } from '@novutienda/website';
import { PARAMETROS } from './config.js';
import { crearDisparadorSitio } from './disparador-sitio.js';
import { emisorEnlaceEmulador, emisorEnlaceFirmado, type EmisorEnlacePdf } from './enlace-pdf.js';
import { lectorRedondeo } from './redondeo.js';

export interface Entorno {
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly authMin: AuthMin;
  readonly bucket: Bucket;
  readonly db: BaseDatosFirestore;
  readonly almacenCotizaciones: AlmacenCotizaciones;
  readonly catalogo: CatalogoPuerto;
  readonly ejecutorRecibos: EjecutorRecibos;
  readonly lecturaRecibos: LecturaRecibos;
  readonly almacenMedios: AlmacenMedios;
  readonly procesador: ProcesadorMedios;
  readonly consultaSubidas: ConsultaSubidas;
  readonly disparadorSitio: DisparadorSitio;
  readonly emisorEnlacePdf: EmisorEnlacePdf;
  readonly ahora: () => number;
  readonly redondeo: (tenantId: string) => Promise<Redondeo>;
  /** `DepsPos` del tenant, con la política de redondeo de su configuración. */
  depsPos(tenantId: string): Promise<DepsPos>;
  readonly leerDisponibilidad: (tenantId: string) => LectorDisponibilidad;
  readonly guardarContacto: (tenantId: string) => GuardarContacto;
}

export interface OpcionesEntorno {
  readonly firestore: Firestore;
  readonly auth: Auth;
  readonly bucket: Bucket;
  readonly ahora?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly emisorEnlacePdf?: EmisorEnlacePdf;
  readonly procesador?: ProcesadorMedios;
}

export function crearEntorno(o: OpcionesEntorno): Entorno {
  const ahora = o.ahora ?? Date.now;
  const env = o.env ?? process.env;
  const db = crearBaseDatos(o.firestore);
  const redondeo = lectorRedondeo(db, ahora);
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  return {
    firestore: o.firestore,
    auth: o.auth,
    authMin: crearAuthMin(o.auth),
    bucket: o.bucket,
    db,
    almacenCotizaciones: almacenCotizacionesDesde(db),
    catalogo: crearCatalogoConsola({ db, lector: db }),
    ejecutorRecibos: crearEjecutorRecibos(o.firestore),
    lecturaRecibos: crearLecturaRecibos(o.firestore),
    almacenMedios: crearAlmacenMedios(o.bucket),
    procesador: o.procesador ?? crearProcesadorMedios(o.bucket, env),
    consultaSubidas: crearConsultaSubidas(o.firestore),
    disparadorSitio: crearDisparadorSitio(o.firestore, ahora),
    emisorEnlacePdf: o.emisorEnlacePdf ?? (emulador ? emisorEnlaceEmulador(o.bucket) : emisorEnlaceFirmado(o.bucket, ahora)),
    ahora,
    redondeo,
    depsPos: async (tenantId) => ({
      db, inventarios: inventariosParaPos, catalogo: catalogoParaPos, redondeo: await redondeo(tenantId), ahora,
    }),
    leerDisponibilidad: (tenantId) => crearLectorDisponibilidad(o.firestore, tenantId),
    guardarContacto: (tenantId) => crearGuardarContacto(o.firestore, tenantId),
  };
}

let unico: Entorno | undefined;

/** Entorno de producción (o del emulador): una sola instancia por proceso. */
export function entorno(): Entorno {
  if (unico === undefined) {
    if (getApps().length === 0) initializeApp();
    const env = {
      ...process.env,
      FFMPEG_PATH: PARAMETROS.ffmpegPath.value() || undefined,
      FFPROBE_PATH: PARAMETROS.ffprobePath.value() || undefined,
    };
    unico = crearEntorno({ firestore: getFirestore(), auth: getAuth(), bucket: getStorage().bucket(), env });
  }
  return unico;
}

/** Verificadores del sitio según la configuración (`real` o `simulado`; el simulado solo existe en pruebas). */
export function verificadoresSitio(env: Readonly<Record<string, string | undefined>> = process.env): {
  readonly appCheck: VerificadorAppCheck;
  readonly recaptcha: VerificadorRecaptcha;
} {
  const appCheck = PARAMETROS.appCheckModo.value() === 'simulado' ? appCheckSimulado(env) : appCheckReal(getAppCheck());
  let recaptcha: VerificadorRecaptcha;
  if (PARAMETROS.recaptchaModo.value() === 'simulado') recaptcha = recaptchaSimulado(env);
  else {
    const app = getApps()[0];
    const credencial = app?.options.credential;
    const proyecto = env['GCLOUD_PROJECT'] ?? env['GOOGLE_CLOUD_PROJECT'] ?? '';
    recaptcha = recaptchaEnterprise({
      proyecto,
      claveSitio: PARAMETROS.recaptchaClaveSitio.value(),
      tokenAcceso: async () => {
        if (credencial === undefined) throw new Error('sin credenciales');
        return (await credencial.getAccessToken()).access_token;
      },
    });
  }
  return { appCheck, recaptcha };
}
