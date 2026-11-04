// `VerificadorAppCheck` y `VerificadorRecaptcha` del sitio: cada uno con su implementación real y una
// simulada para el emulador. La simulada SOLO se puede construir si el entorno declara que es un emulador
// o una prueba: en producción, pedirla lanza (nunca se degrada la verificación por una variable olvidada).
import type { AppCheck } from 'firebase-admin/app-check';
import type { VerificadorAppCheck, VerificadorRecaptcha } from '@novutienda/website';

export type EntornoMin = Readonly<Record<string, string | undefined>>;

/** `true` en el emulador de Functions o con `PLATAFORMA_PRUEBAS=1`. */
export function esEntornoDePruebas(env: EntornoMin): boolean {
  return env['FUNCTIONS_EMULATOR'] === 'true' || env['PLATAFORMA_PRUEBAS'] === '1';
}

function exigirPruebas(env: EntornoMin, que: string): void {
  if (!esEntornoDePruebas(env)) throw new Error(`${que} simulado solo existe en el emulador o en pruebas`);
}

/**
 * App Check real. Con `consumir` (replay protection de Admin SDK) cada token vale UNA sola verificación: el servidor lo marca
 * consumido y rechaza el segundo uso. Exige que el cliente pida un token nuevo por envío (`getLimitedUseToken`).
 */
export function appCheckReal(appCheck: Pick<AppCheck, 'verifyToken'>, opciones: { readonly consumir?: boolean } = {}): VerificadorAppCheck {
  const consumir = opciones.consumir === true;
  return {
    async verificar(token) {
      try {
        const r = await appCheck.verifyToken(token, consumir ? { consume: true } : undefined);
        return !(consumir && r.alreadyConsumed === true);
      } catch {
        return false;
      }
    },
  };
}

/** Acepta solo el token exacto `simulado-valido`; sirve para probar el rechazo y la aceptación en el emulador. */
export function appCheckSimulado(env: EntornoMin): VerificadorAppCheck {
  exigirPruebas(env, 'App Check');
  return { verificar: (token) => Promise.resolve(token === 'simulado-valido') };
}

export interface ConfigRecaptchaEnterprise {
  readonly proyecto: string;
  readonly claveSitio: string;
  /** Devuelve un token de acceso OAuth del servicio (credenciales por defecto del entorno). */
  readonly tokenAcceso: () => Promise<string>;
  readonly fetch?: typeof fetch;
}

interface Evaluacion {
  readonly tokenProperties?: { readonly valid?: boolean; readonly action?: string };
  readonly riskAnalysis?: { readonly score?: number };
}

/** reCAPTCHA Enterprise por REST (`projects.assessments.create`). Si algo falla, el token se rechaza. */
export function recaptchaEnterprise(c: ConfigRecaptchaEnterprise): VerificadorRecaptcha {
  const llamar = c.fetch ?? fetch;
  return {
    async verificar(token, accion) {
      try {
        const r = await llamar(`https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(c.proyecto)}/assessments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${await c.tokenAcceso()}` },
          body: JSON.stringify({ event: { token, siteKey: c.claveSitio, expectedAction: accion } }),
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return { valido: false, puntaje: null };
        const e = (await r.json()) as Evaluacion;
        const valido = e.tokenProperties?.valid === true && e.tokenProperties.action === accion;
        const puntaje = typeof e.riskAnalysis?.score === 'number' ? e.riskAnalysis.score : null;
        return { valido, puntaje: valido ? puntaje : null };
      } catch {
        return { valido: false, puntaje: null };
      }
    },
  };
}

/** Token `simulado-humano` → puntaje 0.9; `simulado-bot` → 0.1; cualquier otro, inválido. */
export function recaptchaSimulado(env: EntornoMin): VerificadorRecaptcha {
  exigirPruebas(env, 'reCAPTCHA');
  return {
    verificar: (token) =>
      Promise.resolve(
        token.startsWith('simulado-humano') ? { valido: true, puntaje: 0.9 } : token.startsWith('simulado-bot') ? { valido: true, puntaje: 0.1 } : { valido: false, puntaje: null },
      ),
  };
}
