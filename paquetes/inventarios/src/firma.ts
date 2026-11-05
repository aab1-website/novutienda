import { createHmac, timingSafeEqual } from 'node:crypto';

/** Ventana de validez de la marca de tiempo firmada: 5 minutos a cada lado. */
export const VENTANA_FIRMA_MS = 5 * 60 * 1000;

export type MotivoFirma = 'marca-invalida' | 'fuera-de-ventana' | 'firma-invalida';
export type ResultadoFirma = { readonly ok: true } | { readonly ok: false; readonly motivo: MotivoFirma };

/**
 * Firma HMAC-SHA256 (hex) de `{marcaTiempo}.{cuerpo}`; `marcaTiempo` son milisegundos Unix
 * (13 dígitos). Se firma el cuerpo EXACTO recibido, sin reserializar.
 */
export function calcularFirma(secreto: string, marcaTiempo: string, cuerpo: string): string {
  if (secreto === '') throw new Error('secreto de firma vacío');
  return createHmac('sha256', secreto).update(`${marcaTiempo}.${cuerpo}`).digest('hex');
}

/** Verificación pura: ventana de 5 minutos y comparación en tiempo constante. */
export function verificarFirma(p: {
  secreto: string;
  marcaTiempo: string;
  cuerpo: string;
  firma: string;
  ahoraMs: number;
  ventanaMs?: number;
}): ResultadoFirma {
  if (typeof p.marcaTiempo !== 'string' || !/^\d{13}$/.test(p.marcaTiempo)) return { ok: false, motivo: 'marca-invalida' };
  if (typeof p.firma !== 'string' || !/^[0-9a-f]{64}$/.test(p.firma)) return { ok: false, motivo: 'firma-invalida' };
  const esperada = Buffer.from(calcularFirma(p.secreto, p.marcaTiempo, p.cuerpo), 'hex');
  const recibida = Buffer.from(p.firma, 'hex');
  const iguales = timingSafeEqual(esperada, recibida);
  if (!iguales) return { ok: false, motivo: 'firma-invalida' };
  if (Math.abs(p.ahoraMs - Number(p.marcaTiempo)) > (p.ventanaMs ?? VENTANA_FIRMA_MS)) return { ok: false, motivo: 'fuera-de-ventana' };
  return { ok: true };
}
