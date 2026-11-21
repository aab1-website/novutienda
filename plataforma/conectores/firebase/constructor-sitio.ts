// Conector de Cloud Build (sirve a la consola, vía el coordinador): lanza la construcción del sitio de un tenant por REST,
// `projects/{p}/locations/us-east1/builds`, con el token de las credenciales por defecto de la aplicación (sin dependencias nuevas).
// Contrato: DR-CB y el plan «publicar el sitio con Cloud Build». Un solo paso con la imagen del constructor fijada por digest.
//
// Seguridad: los secretos NUNCA viajan en el cuerpo: solo sus nombres de versión en `availableSecrets` (los resuelve Cloud Build con
// la cuenta de servicio del build). El cuerpo solo lleva valores públicos (configuración web, URL). Los errores no incluyen el cuerpo
// de la respuesta ni el token; solo el estado HTTP. Sin redirecciones.
import type { ConstruccionLanzada, ConstructorSitio } from '@novutienda/consola';

export const REGION_CONSTRUCTOR = 'us-east1';
export const SECRETO_RECONSTRUCCION = 'SITIO_RECONSTRUCCION_SECRETO';
/**
 * El script termina con código 10 cuando no desplegó sin ser un fallo (409, respuesta `repetido`, sin pendiente). En Cloud Build un
 * paso con código distinto de 0 es FAILURE (y reintentaría); por eso el paso convierte 10 en 0 (`$$` escapa el `$` para Cloud Build). Así SUCCESS ya no prueba que se
 * desplegó: el manejador del aviso debe comprobar en Firestore que el trabajo propio quedó `completada`.
 */
const ORDEN_DEL_CONSTRUCTOR = 'bash /app/scripts/reconstruir-sitio.sh reconstruir; rc=$$?; [ "$$rc" = 10 ] && exit 0; exit "$$rc"';
const TIEMPO_MAXIMO_PETICION_MS = 15_000;

const RE_CLAVE = /^[a-z0-9]{1,12}$/;
const RE_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RE_SITIO = /^[a-z0-9-]{6,30}$/;
const RE_URL = /^https:\/\/[^/?#\s@]+\/?$/;
const RE_PROYECTO = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const RE_CUENTA = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const RE_TRABAJO = /^[A-Za-z0-9._-]{1,128}$/;
/** Imagen del constructor: siempre por digest (una etiqueta móvil permitiría cambiar lo que corre con permisos de despliegue). */
const RE_IMAGEN = /^[a-z0-9.-]+(\/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$/;

export class ErrorConstructorSitio extends Error {
  /** Estado HTTP, `'red'` (sin respuesta) o `'respuesta'` (respuesta sin id de build). */
  readonly estado: number | 'red' | 'respuesta' | undefined;
  constructor(mensaje: string, estado?: number | 'red' | 'respuesta') {
    super(mensaje);
    this.name = 'ErrorConstructorSitio';
    this.estado = estado;
  }
}

export interface SitioDeConstruccion {
  readonly clave: string;
  readonly tenant: string;
  readonly sitio: string;
  readonly url: string;
}

/** Interpreta `SITIOS_TENANT` (JSON `[{clave, tenant, sitio, url}]`, mismos formatos que `scripts/sitios-tenant.mjs`). Falla cerrado; los mensajes no incluyen valores. */
export function leerSitios(texto: string): readonly SitioDeConstruccion[] {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorConstructorSitio('SITIOS_TENANT no es JSON');
  }
  if (!Array.isArray(datos) || datos.length === 0) throw new ErrorConstructorSitio('SITIOS_TENANT debe ser una lista no vacía');
  const claves = new Set<string>();
  return datos.map((e: unknown, i) => {
    const o = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
    const { clave, tenant, sitio, url } = o;
    const ok = typeof clave === 'string' && RE_CLAVE.test(clave) && typeof tenant === 'string' && RE_TENANT.test(tenant)
      && typeof sitio === 'string' && RE_SITIO.test(sitio) && typeof url === 'string' && RE_URL.test(url);
    if (!ok) throw new ErrorConstructorSitio(`SITIOS_TENANT: la entrada ${String(i + 1)} es inválida`);
    if (claves.has(clave)) throw new ErrorConstructorSitio('SITIOS_TENANT: clave repetida');
    claves.add(clave);
    return { clave, tenant, sitio, url };
  });
}

/** Subconjunto de `fetch` que usa el conector (lo cumple `fetch` global y un doble de pruebas). */
export type FetchConstructor = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; redirect: 'error'; signal: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown> }>;

export interface OpcionesConstructorSitio {
  readonly proyecto: string;
  /** `registro/proyecto/repositorio/imagen@sha256:…` (`CONSTRUCTOR_SITIO_IMAGEN`). */
  readonly imagen: string;
  /** Cuenta de servicio del build: nombre corto o correo. Debe tener solo el rol mínimo de DR-CB. */
  readonly cuentaServicio: string;
  /** Sitios por tenant; se lee al lanzar (el secreto `SITIOS_TENANT` solo se puede leer dentro de un manejador). */
  readonly sitios: () => readonly SitioDeConstruccion[];
  /** Variables públicas del build (`VITE_*`, `MEDIOS_BASE_URL`, `FIREBASE_SITE_PANEL`, …). Nunca secretos. */
  readonly entorno: Readonly<Record<string, string>>;
  readonly tokenAcceso: () => Promise<string>;
  readonly fetchFn?: FetchConstructor;
  /** `options.machineType` de Cloud Build; ausente = la máquina por defecto del grupo regional (e2-standard-2, por verificar en staging). */
  readonly maquina?: string;
}

const NOMBRE_VARIABLE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function crearConstructorSitio(o: OpcionesConstructorSitio): ConstructorSitio {
  if (!RE_PROYECTO.test(o.proyecto)) throw new ErrorConstructorSitio('proyecto inválido');
  if (!RE_IMAGEN.test(o.imagen)) throw new ErrorConstructorSitio('la imagen del constructor debe ir fijada por digest (@sha256)');
  const cuenta = o.cuentaServicio.includes('@') ? o.cuentaServicio.split('@')[0] ?? '' : o.cuentaServicio;
  if (!RE_CUENTA.test(cuenta)) throw new ErrorConstructorSitio('cuenta de servicio del constructor inválida');
  const cuentaCompleta = `projects/${o.proyecto}/serviceAccounts/${cuenta}@${o.proyecto}.iam.gserviceaccount.com`;
  for (const [k, v] of Object.entries(o.entorno)) {
    // Cloud Build sustituye `$VAR` en los valores de `env`: un `$` cambiaría lo que ve el script.
    if (!NOMBRE_VARIABLE.test(k) || v.includes('$') || /[\r\n]/.test(v)) throw new ErrorConstructorSitio(`variable pública inválida: ${k}`);
  }
  const fetchFn: FetchConstructor = o.fetchFn ?? ((url, init) => fetch(url, init));

  return {
    async lanzar(tenantId: string, trabajoId: string): Promise<ConstruccionLanzada> {
      if (!RE_TRABAJO.test(trabajoId)) throw new ErrorConstructorSitio('id de trabajo inválido');
      const sitio = o.sitios().find((s) => s.tenant === tenantId);
      if (sitio === undefined) throw new ErrorConstructorSitio('el tenant no tiene sitio en SITIOS_TENANT');
      const secretoNegocio = `SITIO_NEGOCIO_${sitio.clave.toUpperCase()}`;
      const secretos = [SECRETO_RECONSTRUCCION, secretoNegocio];
      const env = {
        ...o.entorno,
        CLAVE: sitio.clave, TENANT: sitio.tenant, SITIO: sitio.sitio, URL_SITIO: sitio.url,
        PROYECTO: o.proyecto, TRABAJO: trabajoId, OMITIR_INSTALAR: '1',
      };
      const cuerpo = {
        steps: [{
          name: o.imagen,
          entrypoint: 'bash',
          args: ['-c', ORDEN_DEL_CONSTRUCTOR],
          env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
          secretEnv: secretos,
        }],
        availableSecrets: {
          secretManager: secretos.map((s) => ({ versionName: `projects/${o.proyecto}/secrets/${s}/versions/latest`, env: s })),
        },
        serviceAccount: cuentaCompleta,
        timeout: '300s',
        queueTtl: '120s',
        options: { logging: 'CLOUD_LOGGING_ONLY', ...(o.maquina === undefined ? {} : { machineType: o.maquina }) },
        tags: [`sitio-${sitio.clave}`],
      };
      let token: string;
      try {
        token = await o.tokenAcceso();
      } catch {
        throw new ErrorConstructorSitio('sin token de acceso para Cloud Build', 'red');
      }
      let r;
      try {
        r = await fetchFn(`https://cloudbuild.googleapis.com/v1/projects/${o.proyecto}/locations/${REGION_CONSTRUCTOR}/builds`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
          redirect: 'error',
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_PETICION_MS),
        });
      } catch {
        throw new ErrorConstructorSitio('Cloud Build no respondió', 'red');
      }
      if (!r.ok) throw new ErrorConstructorSitio(`Cloud Build rechazó la construcción (estado ${String(r.status)})`, r.status);
      const buildId = idDeBuild(await r.json().catch(() => undefined));
      if (buildId === undefined) throw new ErrorConstructorSitio('Cloud Build respondió sin id de construcción', 'respuesta');
      return { buildId, imagen: o.imagen };
    },
  };
}

/** `builds.create` devuelve una operación; el id está en `metadata.build.id`. */
function idDeBuild(r: unknown): string | undefined {
  const id = ((r as { metadata?: { build?: { id?: unknown } } } | undefined)?.metadata?.build?.id);
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : undefined;
}

export interface AvisoBuild {
  readonly tenantId: string;
  readonly buildId: string;
  readonly estado: string;
}

/**
 * Interpreta el mensaje del tema `cloud-builds` (el `Build` en JSON). Devuelve `undefined` si no es de un sitio: sin etiqueta
 * `sitio-<clave>`, clave que no está en `SITIOS_TENANT`, o forma inválida. Una clave desconocida nunca se adivina.
 */
export function interpretarAvisoBuild(mensaje: unknown, sitios: readonly SitioDeConstruccion[]): AvisoBuild | undefined {
  if (typeof mensaje !== 'object' || mensaje === null) return undefined;
  const { id, status, tags } = mensaje as { id?: unknown; status?: unknown; tags?: unknown };
  if (typeof id !== 'string' || typeof status !== 'string' || !Array.isArray(tags)) return undefined;
  const etiqueta = tags.find((t): t is string => typeof t === 'string' && /^sitio-[a-z0-9]{1,12}$/.test(t));
  if (etiqueta === undefined) return undefined;
  const sitio = sitios.find((s) => `sitio-${s.clave}` === etiqueta);
  if (sitio === undefined) return undefined;
  return { tenantId: sitio.tenant, buildId: id, estado: status };
}
