// Funciones de la construcción del sitio en Cloud Build (DR-CB, modo `google`). Definidas aquí y NO exportadas desde `index.ts` hasta P5:
// exportarlas hace que el despliegue active Cloud Tasks y cree la cola y la suscripción al tema `cloud-builds`, y eso necesita la API
// activada y permisos que se dan con autorización de Andres. En modo `github` (o sin exportar) no tienen ningún efecto.
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

// Tarea agendada por `programar` (Cloud Tasks): despierta la construcción a la hora. `invoker: 'private'`: solo Cloud Tasks (con su cuenta) la invoca.
export const construirSitio = onTaskDispatched(
  {
    serviceAccount: PARAMETROS.cuentaFnConstructor, invoker: 'private',
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
