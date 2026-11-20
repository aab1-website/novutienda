/** Teléfono del cliente: se acepta lo que ya acepta el envío del recibo (de 6 a 15 dígitos), con formato libre. */
export const MENSAJE_TELEFONO = 'El teléfono debe tener de 6 a 15 dígitos.';
export const MENSAJE_TELEFONO_SIN_NOMBRE = 'Escriba el nombre del cliente: el teléfono se guarda con él.';

/** Vacío es válido (el teléfono es opcional). Solo dígitos, espacios, guiones, paréntesis y un «+» inicial. */
export function telefonoValido(texto: string): boolean {
  const t = texto.trim();
  if (t === '') return true;
  if (!/^\+?[\d\s\-()]+$/u.test(t)) return false;
  const digitos = t.replace(/\D/gu, '').length;
  return digitos >= 6 && digitos <= 15;
}
