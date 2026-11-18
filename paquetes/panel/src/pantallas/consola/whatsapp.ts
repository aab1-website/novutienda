/**
 * Número de WhatsApp de la tienda: mismas reglas que `esWhatsappValido` y `pareceNumeroDeRelleno` de
 * `@novutienda/consola` (las compara `pruebas/consola/sitio.test.ts`). El segundo solo avisa: no bloquea el guardado.
 */
export function esWhatsappValido(valor: unknown): boolean {
  return typeof valor === 'string' && /^[1-9]\d{7,14}$/.test(valor);
}

/** Un `0` justo después del código de país 591 o 54: relleno de la demo que WhatsApp no acepta. */
export function pareceNumeroDeRelleno(valor: unknown): boolean {
  return typeof valor === 'string' && /^(591|54)0/.test(valor);
}
