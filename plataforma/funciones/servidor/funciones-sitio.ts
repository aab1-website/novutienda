// Funciones de la construcción del sitio en Cloud Build (DR-CB, modo `google`), exportadas desde `index.ts` (P5). Al desplegarlas se crea la cola
// de Cloud Tasks y la suscripción al tema `cloud-builds`: necesitan la API activada y los permisos de P5 (el PR no se fusiona antes).
// En modo `github` salen antes de hacer nada: sin efecto.
//
// Cuenta propia: ambas corren con `CUENTA_FN_CONSTRUCTOR_SITIO`, la única con permiso de crear/consultar builds, actuar como
// `sitio-constructor` y leer `SITIOS_TENANT`. El temporizador (cuenta general) nunca lanza builds: solo encola la tarea de `construirSitio`.
import { logger } from 'firebase-functions';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { idDeMensajeBuild, interpretarAvisoBuild } from '../../conectores/firebase/index.js';
import { PARAMETROS } from './config.js';
import { manejarAvisoConstruccion, manejarTareaConstruccion } from './construccion-sitio.js';
import { consultaBuildDeLaInstancia, constructorSitioEsGoogle, construccionDeLaInstancia, entorno, sitiosDeLaInstancia } from './entorno.js';

// Tarea agendada por `programar` (Cloud Tasks): despierta la construcción a la hora.
// Invocador explícito (D-P5-2 = A). El formato `nombre@` lo completa firebase-tools con el proyecto del despliegue (ningún id queda en el repositorio).
// En cada despliegue firebase-tools deja `cloudtasks.enqueuer` en la cola y `run.invoker` en el servicio solo a estas dos cuentas, que son las de los
// parámetros `FUNCIONES_SERVICE_ACCOUNT` y `CUENTA_FN_CONSTRUCTOR_SITIO`. Los nombres van fijos y no salen de los parámetros porque `invoker`
// solo admite texto literal (no expresiones de parámetros): si se renombran las cuentas, se cambian aquí y en el script de preparación.
export const INVOCADORES_TAREA_SITIO = ['novutienda-funciones@', 'fn-constructor-sitio@'];
export const construirSitio = onTaskDispatched(
  {
    serviceAccount: PARAMETROS.cuentaFnConstructor, invoker: INVOCADORES_TAREA_SITIO,
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10 }, rateLimits: { maxConcurrentDispatches: 3 },
  },
  async (req) => {
    if (!constructorSitioEsGoogle()) return; // modo `github`: sin efecto y sin tocar el entorno
    const deps = construccionDeLaInstancia(entorno());
    if (deps === undefined) return;
    const d = req.data as { tenantId?: unknown; para?: unknown } | undefined;
    if (typeof d?.tenantId !== 'string' || typeof d.para !== 'number' || !Number.isFinite(d.para)) {
      logger.error('tarea de construcción del sitio con forma inválida');
      return; // sin reintento: una tarea mal formada no mejora al repetirla
    }
    logger.info('tarea de construcción del sitio', { resultado: await manejarTareaConstruccion(deps, { tenantId: d.tenantId, para: d.para }) });
  },
);

// Aviso de Cloud Build al terminar cada construcción (tema `cloud-builds`). No se confía en el mensaje: de él solo se toma el id y el estado y
// las etiquetas salen de `builds.get`. Solo atiende los builds con la etiqueta `sitio-<clave>` de un sitio de `SITIOS_TENANT`.
export const avisoConstruccionSitio = onMessagePublished(
  { topic: 'cloud-builds', retry: false, serviceAccount: PARAMETROS.cuentaFnConstructor },
  async (ev) => {
    if (!constructorSitioEsGoogle()) return;
    const deps = construccionDeLaInstancia(entorno());
    if (deps === undefined) return;
    const id = idDeMensajeBuild(ev.data.message.json);
    if (id === undefined) return;
    const build = await consultaBuildDeLaInstancia()(id);
    const aviso = interpretarAvisoBuild({ id: build.id, status: build.status, tags: build.tags }, await sitiosDeLaInstancia());
    if (aviso === undefined) return;
    logger.info('aviso de construcción del sitio', { resultado: await manejarAvisoConstruccion(deps, aviso) });
  },
);
