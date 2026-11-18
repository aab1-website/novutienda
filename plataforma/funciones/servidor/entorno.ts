// Composición: arma, en un solo lugar, los puertos reales de la plataforma sobre firebase-admin. Las funciones
// reciben un `Entorno`; las pruebas pueden construir otro con `crearEntorno` (reloj fijo, puertos simulados).
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { getStorage } from 'firebase-admin/storage';
import type { CatalogoPuerto, DisparadorSitio, ProcesadorMedios } from '@novutienda/consola';
import { crearDisparoGithub, repoValido, tokenValido, type DisparoGithub } from '../../conectores/github/index.js';
import { crearLectorDominios, type LectorDominios } from '../../coordinador/dominios.js';
import { crearLectoresModulos, type LectorEstadoModulos, type LectorModulos } from '../../coordinador/modulos-activos.js';
import { crearLectorComercial, type LectorComercial } from '../../coordinador/comercial.js';
import { crearLectorHojas } from '../../coordinador/lector-hojas.js';
import { crearCatalogoConsola, crearLogoDelNegocio, almacenCotizacionesDesde, catalogoParaPos, inventariosParaPos, type LogoDelNegocio } from '../../coordinador/index.js';
import {
  appCheckReal, appCheckSimulado, crearAlmacenMedios, esEntornoDePruebas, crearAuthMin, crearBaseDatos, crearConsultaSubidas, crearEjecutorRecibos, crearGuardarContacto, crearIndiceInvitaciones, crearLimiteTasa,
  crearLecturaRecibos, crearLectorDisponibilidad, crearProcesadorMedios, recaptchaEnterprise, recaptchaSimulado,
  type BaseDatosFirestore, type Bucket,
} from '../../conectores/firebase/index.js';
import type { AlmacenMedios, ConsultaSubidas } from '@novutienda/consola';
import type { AlmacenCotizaciones, AuthMin, IndiceInvitaciones, LimiteTasa, Redondeo } from '@novutienda/nucleo';
import type { LectorHojas } from '@novutienda/inventarios';
import type { DepsPos } from '@novutienda/pos';
import type { EjecutorRecibos, LecturaRecibos } from '@novutienda/recibos';
import type { GuardarContacto, LectorDisponibilidad, VerificadorAppCheck, VerificadorRecaptcha } from '@novutienda/website';
import { exigirBucketPublico, PARAMETROS, SECRETOS } from './config.js';
import { crearDisparadorSitio } from './disparador-sitio.js';
import { emisorEnlaceEmulador, emisorEnlaceFirmado, type EmisorEnlacePdf } from './enlace-pdf.js';
import { MAXIMO_BUSQUEDAS_SERIE_POR_HORA, MAXIMO_BUSQUEDAS_SERIE_POR_MINUTO } from './llamadas/inventarios.js';
import { MAXIMO_ACTIVACIONES_POR_HORA, MAXIMO_INVITACIONES_POR_HORA, VENTANA_INVITACIONES_MS } from './llamadas/usuarios.js';
import { lectorRedondeo, lectorRedondeoDe, type LectorRedondeo } from './redondeo.js';

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
  /**
   * Aviso a GitHub para reconstruir el sitio sin esperar el sondeo (S7-3). Opcional: sin él (emulador, pruebas, parámetro o
   * secreto sin cargar) no se avisa y el trabajo `pendiente` lo recoge el sondeo. Solo lo arma `disparoSitioDeConfiguracion`.
   */
  readonly disparoSitio?: DisparoGithub;
  readonly emisorEnlacePdf: EmisorEnlacePdf;
  /** Lector de .xlsx de la importación de Inventarios (adaptador del coordinador, con topes contra archivos no confiables). */
  readonly lectorHojas: LectorHojas;
  /** Consultas de invitaciones (`miembros` en estado `invitado`), para `llamadas/usuarios.ts` y la activación. */
  readonly indiceInvitaciones: IndiceInvitaciones;
  /** Tope de activaciones por uid y hora (clave `activar:{uid}`). */
  readonly limiteActivaciones: LimiteTasa;
  /** Tope de invitaciones y reenvíos por comercio y hora (5). */
  readonly limiteInvitaciones: LimiteTasa;
  /** Tope de búsquedas de serie por el comienzo: 30 por minuto por usuario (clave `serie:{tenant}:{uid}`). */
  readonly limiteBusquedaSerieUsuario: LimiteTasa;
  /** Tope de búsquedas de serie por el comienzo: 300 por hora por tenant (clave `serie:{tenant}`). */
  readonly limiteBusquedaSerieTenant: LimiteTasa;
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
  /** Puerto de Recibos: URL pública del logo subido del negocio (módulo consola), o `null`. Sin `mediosBaseUrl` siempre devuelve `null`. */
  readonly logoDelNegocio: LogoDelNegocio;
  /** Política de redondeo efectiva por moneda de venta del tenant (su configuración; `config/redondeo` la sobrescribe si existe). Un cambio del operador tarda hasta 60 s en propagarse. */
  readonly redondeoDelTenant: LectorRedondeo;
  /** @deprecated LEGADO, como en main: política BOB/ARS de `config/redondeo`, sin leer `tenants/{t}`. Usar `redondeoDelTenant` (B2 a B4). */
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
  /** Origen público de los medios (`MEDIOS_BASE_URL`); vacío o ausente: el logo subido no se entrega a Recibos. */
  readonly mediosBaseUrl?: string;
  /** Disparo de GitHub (doble en pruebas); ausente = sin aviso. */
  readonly disparoSitio?: DisparoGithub;
  /** Habilita el plan `pruebas` (`PLAN_PRUEBAS_HABILITADO=si`); ausente o `false`: un tenant con ese plan es inválido. */
  readonly planPruebasHabilitado?: boolean;
}

export function crearEntorno(o: OpcionesEntorno): Entorno {
  const ahora = o.ahora ?? Date.now;
  const env = o.env ?? process.env;
  const db = crearBaseDatos(o.firestore);
  const comercialDelTenant = crearLectorComercial(o.firestore, ahora);
  const redondeoDelTenant = lectorRedondeoDe(db, ahora, comercialDelTenant);
  const redondeo = lectorRedondeo(db, ahora); // LEGADO: como en main (misma fuente y mismos fallos), hasta B2 a B4
  const emulador = env['FUNCTIONS_EMULATOR'] === 'true';
  const lectoresModulos = crearLectoresModulos(o.firestore, ahora, undefined, o.planPruebasHabilitado === true);
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
    ...(o.disparoSitio === undefined ? {} : { disparoSitio: o.disparoSitio }),
    emisorEnlacePdf: o.emisorEnlacePdf ?? (emulador ? emisorEnlaceEmulador(o.bucket) : emisorEnlaceFirmado(o.bucket, ahora)),
    lectorHojas: crearLectorHojas(),
    // La clave es `invitar:{tenantId}` (sin IP ni datos personales): la sal solo separa el espacio de claves, no es secreta.
    indiceInvitaciones: crearIndiceInvitaciones(o.firestore),
    limiteInvitaciones: crearLimiteTasa(o.firestore, { maximo: MAXIMO_INVITACIONES_POR_HORA, ventanaMs: VENTANA_INVITACIONES_MS, sal: 'invitaciones-v1' }),
    limiteActivaciones: crearLimiteTasa(o.firestore, { maximo: MAXIMO_ACTIVACIONES_POR_HORA, ventanaMs: VENTANA_INVITACIONES_MS, sal: 'invitaciones-v1' }),
    limiteBusquedaSerieUsuario: crearLimiteTasa(o.firestore, { maximo: MAXIMO_BUSQUEDAS_SERIE_POR_MINUTO, ventanaMs: 60_000, sal: 'busqueda-serie-usuario-v1' }),
    limiteBusquedaSerieTenant: crearLimiteTasa(o.firestore, { maximo: MAXIMO_BUSQUEDAS_SERIE_POR_HORA, ventanaMs: 3_600_000, sal: 'busqueda-serie-tenant-v1' }),
    ahora,
    modulosDelTenant: lectoresModulos.modulos,
    estadoModulosDelTenant: lectoresModulos.estado,
    tenantDelHost: crearLectorDominios(o.firestore, ahora),
    comercialDelTenant,
    logoDelNegocio: crearLogoDelNegocio({ db, modulosDelTenant: lectoresModulos.modulos, baseMedios: o.mediosBaseUrl ?? '', avisar: (m, d) => logger.warn(m, d) }),
    redondeoDelTenant,
    redondeo,
    depsPos: async (tenantId) => ({
      db, inventarios: inventariosParaPos, catalogo: catalogoParaPos, comercial: await comercialDelTenant(tenantId), redondeo: await redondeoDelTenant(tenantId), ahora,
    }),
    leerDisponibilidad: (tenantId) => crearLectorDisponibilidad(o.firestore, tenantId),
    guardarContacto: (tenantId) => crearGuardarContacto(o.firestore, tenantId),
  };
}

/**
 * Disparo de GitHub según la configuración, o `undefined` si queda deshabilitado (parámetro o secreto vacíos o con forma
 * inválida, emulador o pruebas: ahí nunca se llama a la red real). `avisar` recibe un texto fijo, nunca el valor del token.
 */
export function disparoSitioDeConfiguracion(
  repo: string,
  token: string,
  env: Readonly<Record<string, string | undefined>>,
  avisar: (mensaje: string) => void,
): DisparoGithub | undefined {
  if (esEntornoDePruebas(env)) return undefined;
  const r = repo.trim();
  const t = token.trim();
  if (r === '' || t === '') {
    avisar('disparo de reconstrucción deshabilitado: falta GITHUB_REPO_SITIO o GITHUB_DISPARO_SITIO');
    return undefined;
  }
  if (!repoValido(r) || !tokenValido(t)) {
    avisar('disparo de reconstrucción deshabilitado: GITHUB_REPO_SITIO o GITHUB_DISPARO_SITIO tienen una forma inválida');
    return undefined;
  }
  return crearDisparoGithub({ repo: r, token: t });
}

let disparoUnico: { readonly valor: DisparoGithub | undefined } | undefined;

/** Disparo de esta instancia (una sola construcción y un solo log informativo por instancia). Solo `temporizadorSitio` tiene el secreto. */
export function disparoSitioDeLaInstancia(): DisparoGithub | undefined {
  disparoUnico ??= {
    valor: disparoSitioDeConfiguracion(PARAMETROS.githubRepoSitio.value(), SECRETOS.disparoSitio.value(), process.env, (m) => logger.info(m)),
  };
  return disparoUnico.valor;
}

let unico: Entorno | undefined;

/** El plan `pruebas` solo se habilita con el valor exacto `si` (sin mayúsculas, espacios ni sinónimos). */
export function planPruebasHabilitado(valor: string): boolean {
  return valor === 'si';
}

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
    unico = crearEntorno({ firestore: getFirestore(), auth: getAuth(), bucket, bucketPublico, env, procesador, mediosBaseUrl: PARAMETROS.mediosBaseUrl.value(), planPruebasHabilitado: planPruebasHabilitado(PARAMETROS.planPruebasHabilitado.value()) });
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
