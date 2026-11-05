// Punto de entrada de las Cloud Functions v2 (región us-east1, Node 22). Todo lo que se exporta aquí se
// despliega; la lógica vive en módulos probados por separado.
//
//  Callables (uno por módulo; contrato en docs/produccion/funciones.md):  pos · inventarios · consola · recibos · medios
//  HTTP:                                                                   api  (rutas /api/** de Hosting)
//  Eventos:                                                                eventos (bus) · subidaFinalizada (Storage)
//  Programadas:                                                            cotizacion · limpiezaSubidas · temporizadorSitio
import { getApps, initializeApp } from 'firebase-admin/app';
import { logger, setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, onRequest, type Request } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { limiteMemoria, type LimiteTasa } from '@novutienda/website';
import { crearLimiteTasa, esEntornoDePruebas } from '../../adaptadores/firebase/index.js';
import { entregarEvento } from './bus.js';
import { enteroDe, exigirConfiguracionDeServicio, PARAMETROS, REGION, SECRETOS } from './config.js';
import { entorno, verificadoresSitio } from './entorno.js';
import { ipDelCliente } from './origen.js';
import { enrutar, type ConfigRouter } from './http/router.js';
import type { PeticionHttp } from './http/tipos.js';
import { accionesConsola } from './llamadas/consola.js';
import { accionesInventarios } from './llamadas/inventarios.js';
import { crearManejador } from './llamadas/marco.js';
import { accionesMedios } from './llamadas/medios.js';
import { accionesPos } from './llamadas/pos.js';
import { accionesRecibos } from './llamadas/recibos.js';
import { accionesUsuarios } from './llamadas/usuarios.js';
import { ejecutarLimpiezaSubidas, ejecutarTemporizadorSitio } from './programadas/consola.js';
import { ejecutarCotizaciones } from './programadas/cotizacion.js';
import { procesarObjetoSubido } from './trigger-medios.js';

// Los disparadores (Firestore, Storage) necesitan la app por defecto desde el arranque.
if (getApps().length === 0) initializeApp();

// `serviceAccount` sale de un parámetro: vacío = cuenta por defecto (solo emulador y, si se acepta, staging); en producción,
// una cuenta dedicada con roles mínimos (docs/produccion/pase-a-staging.md, paso 6).
setGlobalOptions({ region: REGION, maxInstances: 10, memory: '256MiB', timeoutSeconds: 60, serviceAccount: PARAMETROS.cuentaServicio });

const appCheckExigido = (): boolean => PARAMETROS.appCheckExigido.value();
const callable = (modulo: string, acciones: Parameters<typeof crearManejador>[0]['acciones']) =>
  crearManejador({ modulo, acciones, entorno, appCheckExigido });

// ---- Callables ------------------------------------------------------------------------------------------------
export const pos = onCall({ memory: '512MiB' }, callable('pos', accionesPos));
export const inventarios = onCall({ memory: '512MiB' }, callable('inventarios', accionesInventarios));
// Las acciones de usuarios (Central, `llamadas/usuarios.ts`) viajan en el callable `consola` para no cambiar el contrato del panel.
export const consola = onCall({ memory: '512MiB' }, callable('consola', { ...accionesConsola, ...accionesUsuarios }));
export const recibos = onCall({ memory: '512MiB' }, callable('recibos', accionesRecibos));
export const medios = onCall({ memory: '2GiB', timeoutSeconds: 540, maxInstances: 3 }, callable('medios', accionesMedios));

// ---- API HTTP -------------------------------------------------------------------------------------------------
function unico(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function aPeticion(req: Request): PeticionHttp {
  const cabeceras: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) cabeceras[k.toLowerCase()] = unico(v);
  const consulta: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) consulta[k] = typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
  const esJson = (cabeceras['content-type'] ?? '').toLowerCase().startsWith('application/json');
  const cuerpoCrudo = req.rawBody instanceof Buffer ? req.rawBody.toString('utf8') : '';
  return {
    metodo: req.method.toUpperCase(),
    ruta: req.path,
    url: req.url,
    consulta,
    cabeceras,
    cuerpoCrudo,
    cuerpo: esJson ? (req.body as unknown) : undefined,
    // Último salto confiable de X-Forwarded-For (ver origen.ts); nunca `fastly-client-ip` ni el primer elemento.
    origen: ipDelCliente(cabeceras['x-forwarded-for'], enteroDe(PARAMETROS.proxySaltos.value(), 2)),
  };
}

// Límites en memoria POR INSTANCIA y por origen, antes de autenticar o de verificar App Check (el límite de Firestore por token se paga con una lectura
// del token y una escritura transaccional). Se crean una vez, con los valores de los parámetros de la primera petición.
let memoria: { readonly novuchat: LimiteTasa; readonly disponibilidad: LimiteTasa; readonly contacto: LimiteTasa } | undefined;
function limitesEnMemoria(): NonNullable<typeof memoria> {
  memoria ??= {
    novuchat: limiteMemoria(enteroDe(PARAMETROS.novuchatMaximoPorMinuto.value(), 120), 60_000),
    disponibilidad: limiteMemoria(enteroDe(PARAMETROS.disponibilidadMaximoPorMinuto.value(), 60), 60_000),
    contacto: limiteMemoria(enteroDe(PARAMETROS.contactoMaximoPorMinuto.value(), 30), 60_000),
  };
  return memoria;
}

function configRouter(e: ReturnType<typeof entorno>): ConfigRouter {
  // Falla si falta la sal del límite o la base de medios fuera de las pruebas (nunca un valor por defecto).
  const { sal, mediosBaseUrl } = exigirConfiguracionDeServicio(
    { sal: SECRETOS.salLimite.value(), mediosBaseUrl: PARAMETROS.mediosBaseUrl.value() },
    esEntornoDePruebas(process.env),
  );
  const verificadores = verificadoresSitio();
  const tenantId = PARAMETROS.tenantId.value();
  return {
    tenantId,
    secretoReconstruccion: SECRETOS.reconstruccion.value(),
    limiteContacto: crearLimiteTasa(e.firestore, {
      maximo: enteroDe(PARAMETROS.contactoMaximo.value(), 5), ventanaMs: enteroDe(PARAMETROS.contactoVentanaSeg.value(), 600) * 1000, sal,
    }),
    limiteMemoria: limitesEnMemoria(),
    recaptcha: verificadores.recaptcha,
    appCheck: verificadores.appCheck,
    novuchat: {
      sitioUrl: PARAMETROS.sitioUrl.value().replace(/\/+$/, ''),
      mediosBaseUrl,
      limite: crearLimiteTasa(e.firestore, { maximo: enteroDe(PARAMETROS.novuchatMaximoPorMinuto.value(), 120), ventanaMs: 60_000, sal }),
      secretoPedidos: SECRETOS.pedidos.value(),
      tenantPedidos: tenantId,
    },
  };
}

// `invoker: 'public'` explícito: Hosting reescribe `/api/**` y `/healthz` a esta función sin credencial, y la
// autenticación (App Check, token NovuChat, firma HMAC) la hace la propia función por ruta. En el primer despliegue a
// staging (05/11/2026) la función quedó sin `allUsers` como invocador y el sitio respondía 403/404 en esas rutas.
/**
 * Cabeceras de seguridad que la función pone en TODA respuesta, también en las de error. Hosting solo agrega las de
 * `firebase.json` a las respuestas 2xx de una reescritura: en staging (05/11/2026) `/api/cotizacion` → 503 y `/api/` → 404
 * salían sin HSTS y el DAST (ZAP 10035) lo marcó FAIL. Mismos valores que la regla `**` del sitio.
 */
export const CABECERAS_SEGURIDAD_API: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
};

export const api = onRequest(
  { memory: '512MiB', cors: false, invoker: 'public', secrets: [SECRETOS.pedidos, SECRETOS.reconstruccion, SECRETOS.salLimite] },
  async (req, res) => {
    res.set(CABECERAS_SEGURIDAD_API);
    try {
      const e = entorno();
      const r = await enrutar(e, aPeticion(req), configRouter(e));
      res.status(r.status).set(r.headers);
      if (r.cuerpo === undefined) res.end();
      else res.send(typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo));
    } catch (error) {
      logger.error('error interno en la API', { error: error instanceof Error ? { nombre: error.name, mensaje: error.message } : String(error) });
      res.status(500).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send('{"error":"interno"}');
    }
  },
);

// ---- Eventos --------------------------------------------------------------------------------------------------
export const eventos = onDocumentCreated({ document: 'tenants/{tenantId}/eventos/{eventoId}', retry: true, maxInstances: 5 }, async (ev) => {
  const datos = ev.data?.data();
  if (datos === undefined) return;
  await entregarEvento(entorno(), ev.params.tenantId, ev.params.eventoId, datos);
});

export const subidaFinalizada = onObjectFinalized({ memory: '2GiB', timeoutSeconds: 540, maxInstances: 3, retry: false }, async (ev) => {
  const r = await procesarObjetoSubido(entorno(), ev.data.bucket, ev.data.name);
  if (r !== 'ignorada') logger.info('subida procesada', { resultado: r });
});

// ---- Programadas (Cloud Scheduler; hora de La Paz) ------------------------------------------------------------
export const cotizacion = onSchedule({ schedule: '0 7,13,19 * * *', timeZone: 'America/La_Paz', timeoutSeconds: 300, retryCount: 1 }, async () => {
  const r = await ejecutarCotizaciones(entorno());
  logger.info('cotización actualizada', { resultados: r });
});

export const limpiezaSubidas = onSchedule({ schedule: 'every 60 minutes', timeZone: 'America/La_Paz', memory: '512MiB', timeoutSeconds: 300 }, async () => {
  logger.info('limpieza de subidas', { resultado: await ejecutarLimpiezaSubidas(entorno()) });
});

export const temporizadorSitio = onSchedule({ schedule: 'every 5 minutes', timeZone: 'America/La_Paz' }, async () => {
  await ejecutarTemporizadorSitio(entorno());
});
