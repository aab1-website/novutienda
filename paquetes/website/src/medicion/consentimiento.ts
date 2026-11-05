/**
 * Consentimiento por categoría. Por defecto NADA se mide: rechazar es tan fácil como aceptar.
 * - analitica: Google Analytics.
 * - marketing: píxeles de Meta y TikTok, y las señales de publicidad de Google.
 * La decisión se guarda en el propio navegador (no viaja en cada petición).
 */
import { guardarSeguro, leerSeguro, type AlmacenClaveValor } from '../lib/almacen.js';

export const CLAVE_CONSENTIMIENTO = 'cb.consentimiento';

export interface Consentimiento {
  readonly analitica: boolean;
  readonly marketing: boolean;
}

export const SIN_CONSENTIMIENTO: Consentimiento = { analitica: false, marketing: false };
export const TODO_ACEPTADO: Consentimiento = { analitica: true, marketing: true };

/** Devuelve la decisión guardada, o null si la persona aún no decidió (entonces se pregunta). */
export function leerConsentimiento(a: AlmacenClaveValor | null): Consentimiento | null {
  const crudo = leerSeguro(a, CLAVE_CONSENTIMIENTO);
  if (crudo === null) return null;
  try {
    const x = JSON.parse(crudo) as Record<string, unknown>;
    if (x['v'] !== 1 || typeof x['analitica'] !== 'boolean' || typeof x['marketing'] !== 'boolean') return null;
    return { analitica: x['analitica'], marketing: x['marketing'] };
  } catch {
    return null;
  }
}

export function guardarConsentimiento(a: AlmacenClaveValor | null, c: Consentimiento): void {
  guardarSeguro(a, CLAVE_CONSENTIMIENTO, JSON.stringify({ v: 1, analitica: c.analitica, marketing: c.marketing }));
}
