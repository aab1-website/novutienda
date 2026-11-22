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

const RE_TENANT_TAREA = /^[a-z0-9][a-z0-9-]{0,62}$/; // misma forma que el id de tenant del núcleo
/** Carga válida de la tarea: `{ tenantId, para }` con id de tenant de forma válida y `para` entero positivo. Otra cosa: `undefined`. */
export function tareaValida(d: unknown): { tenantId: string; para: number } | undefined {
  if (typeof d !== 'object' || d === null) return undefined;
  const { tenantId, para } = d as { tenantId?: unknown; para?: unknown };
  if (typeof tenantId !== 'string' || !RE_TENANT_TAREA.test(tenantId)) return undefined;
  if (typeof para !== 'number' || !Number.isSafeInteger(para) || para <= 0) return undefined;
  return { tenantId, para };
}

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
    // Se valida la carga ANTES de leer el entorno: cualquier cuenta invocadora podría encolar, y el tenantId arma rutas de Firestore.
    const tarea = tareaValida(req.data);
    if (tarea === undefined) {
      logger.error('tarea de construcción del sitio con forma inválida');
      return; // sin reintento: una tarea mal formada no mejora al repetirla
    }
    const deps = construccionDeLaInstancia(entorno());
    if (deps === undefined) return;
    logger.info('tarea de construcción del sitio', { resultado: await manejarTareaConstruccion(deps, tarea) });
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
