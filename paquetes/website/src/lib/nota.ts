/**
 * Nota del cliente en Mi pedido: texto libre y opcional que viaja en el mensaje de WhatsApp como «Nota: …».
 * Se guarda aparte del carrito (otra clave) y nunca se envía a un servidor: solo forma parte del mensaje.
 */

export const MAX_NOTA = 500;
export const CLAVE_NOTA = 'cb.nota';

/**
 * Deja la nota en una sola línea y sin caracteres de control (un salto de línea partiría el formato «Nota: …»),
 * sin espacios repetidos ni en los bordes, y con como mucho `MAX_NOTA` caracteres (por puntos de código).
 * Lo que no es texto queda vacío.
 */
export function limpiarNota(x: unknown): string {
  if (typeof x !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const plano = x.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const puntos = Array.from(plano);
  return puntos.length <= MAX_NOTA ? plano : puntos.slice(0, MAX_NOTA).join('').trimEnd();
}
