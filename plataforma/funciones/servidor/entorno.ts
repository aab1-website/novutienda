// Composición: arma, en un solo lugar, los puertos reales de la plataforma sobre firebase-admin. Las funciones
// reciben un `Entorno`; las pruebas pueden construir otro con `crearEntorno` (reloj fijo, puertos simulados).
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { getStorage } from 'firebase-admin/storage';
import type { CatalogoPuerto, DisparadorSitio, ProcesadorMedios } from '@novutienda/consola';
import { crearLectorDominios, type LectorDominios } from '../../coordinador/dominios.js';
import { crearLectoresModulos, type LectorEstadoModulos, type LectorModulos } from '../../coordinador/modulos-activos.js';
import { crearLectorComercial, type LectorComercial } from '../../coordinador/comercial.js';
import { crearLectorHojas } from '../../coordinador/lector-hojas.js';
import { crearCatalogoConsola, almacenCotizacionesDesde, catalogoParaPos, inventariosParaPos } from '../../coordinador/index.js';
import {
  appCheckReal, appCheckSimulado, crearAlmacenMedios, esEntornoDePruebas, crearAuthMin, crearBaseDatos, crearConsultaSubidas, crearEjecutorRecibos, crearGuardarContacto,
  crearLecturaRecibos, crearLectorDisponibilidad, crearProcesadorMedios, recaptchaEnterprise, recaptchaSimulado,
  type BaseDatosFirestore, type Bucket,
} from '../../conectores/firebase/index.js';
import type { AlmacenMedios, ConsultaSubidas } from '@novutienda/consola';
import type { AlmacenCotizaciones, AuthMin, Redondeo } from '@novutienda/nucleo';
import type { LectorHojas } from '@novutienda/inventarios';
import type { DepsPos } from '@novutienda/pos';
import type { EjecutorRecibos, LecturaRecibos } from '@novutienda/recibos';
import type { GuardarContacto, LectorDisponibilidad, VerificadorAppCheck, VerificadorRecaptcha } from '@novutienda/website';
import { exigirBucketPublico, PARAMETROS } from './config.js';
import { crearDisparadorSitio } from './disparador-sitio.js';
import { emisorEnlaceEmulador, emisorEnlaceFirmado, type EmisorEnlacePdf } from './enlace-pdf.js';
import { comoRedondeoLegado, lectorRedondeo, type LectorRedondeo } from './redondeo.js';

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
  /** Lector de .xlsx de la importación de Inventarios (adaptador del coordinador, con topes contra archivos no confiables). */
  readonly lectorHojas: LectorHojas;
  readonly ahora: () => number;
  /** Módulos efectivos del tenant (cache de 60 s por instancia); `undefined` si el tenant no existe o es inválido. */
  readonly modulosDelTenant: LectorModulos;
  /** Igual que `modulosDelTenant` pero con el motivo cuando no hay módulos (lo usa el marco para el propietario). */
  readonly estadoModulosDelTenant: LectorEstadoModulos;
  /** Tenant del host de la petición (`dominios/{host}`, caché de 60 s; `undefined` si no hay mapeo). */
  readonly tenantDelHost: LectorDominios;
  /**
   * Mercados y monedas del tenant (`tenants/{t}`, caché de 60 s; `invalidar()` para pruebas). Falla cerrado: tenant inexistente o
   * documento inválido lanzan `ComercialInvalida`; nunca entrega una configuración por defecto. Firma: `(tenantId: string) => Promise<ConfiguracionComercial>`.
   */
  readonly comercialDelTenant: LectorComercial;
  /** Política de redondeo efectiva por moneda de venta del tenant (su configuración; `config/redondeo` la sobrescribe si existe). */
  readonly redondeoDelTenant: LectorRedondeo;
  /** @deprecated LEGADO con la forma BOB/ARS (falla si el tenant no vende en ambas): usar `redondeoDelTenant` (B2 a B4). */
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
  /** Bucket público de los medios (solo `publico/medios/`); sin él, el bucket por defecto (emulador y pruebas). */
  readonly bucketPublico?: Bucket;
  readonly ahora?: () => number;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly emisorEnlacePdf?: EmisorEnlacePdf;
  readonly procesador?: ProcesadorMedios;
}

export function crearEntorno(o: OpcionesEntorno): Entorno {
  const ahora = o.ahora ?? Date.now;
  const env = o.env ?? process.env;
  const db = crearBaseDatos(o.firestore);
  const comercialDelTenant = crearLectorComercial(o.firestore, ahora);
  const redondeoDelTenant = lectorRedondeo(db, ahora, comercialDelTenant);
  const redondeo = async (tenantId: string): Promise<Redondeo> => comoRedondeoLegado(await redondeoDelTenant(tenantId));
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  const lectoresModulos = crearLectoresModulos(o.firestore, ahora);
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
    almacenMedios: crearAlmacenMedios(o.bucket, o.bucketPublico ?? o.bucket),
    procesador: o.procesador ?? crearProcesadorMedios(o.bucket, env),
    consultaSubidas: crearConsultaSubidas(o.firestore),
    disparadorSitio: crearDisparadorSitio(o.firestore, ahora),
    emisorEnlacePdf: o.emisorEnlacePdf ?? (emulador ? emisorEnlaceEmulador(o.bucket) : emisorEnlaceFirmado(o.bucket, ahora)),
    lectorHojas: crearLectorHojas(),
    ahora,
    modulosDelTenant: lectoresModulos.modulos,
    estadoModulosDelTenant: lectoresModulos.estado,
    tenantDelHost: crearLectorDominios(o.firestore, ahora),
    comercialDelTenant,
    redondeoDelTenant,
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
    const almacenamiento = getStorage();
    const bucket = almacenamiento.bucket();
    // Falla cerrado: fuera de pruebas sin bucket público válido y distinto no hay entorno (nunca se publica en el por defecto).
    const nombrePublico = exigirBucketPublico(PARAMETROS.mediosBucketPublico.value(), bucket.name, esEntornoDePruebas(process.env));
    const bucketPublico = nombrePublico === '' ? bucket : almacenamiento.bucket(nombrePublico);
    const procesador = crearProcesadorMedios(bucket, env, esEntornoDePruebas(process.env) ? undefined : logger);
    unico = crearEntorno({ firestore: getFirestore(), auth: getAuth(), bucket, bucketPublico, env, procesador });
  }
  return unico;
}

/** Verificadores del sitio según la configuración (`real` o `simulado`; el simulado solo existe en pruebas). */
export function verificadoresSitio(env: Readonly<Record<string, string | undefined>> = process.env): {
  readonly appCheck: VerificadorAppCheck;
  readonly recaptcha: VerificadorRecaptcha;
} {
  const appCheck = PARAMETROS.appCheckModo.value() === 'simulado' ? appCheckSimulado(env) : appCheckReal(getAppCheck(), { consumir: true }); // el único uso es /api/contacto: un token por envío
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
