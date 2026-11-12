/** Ayudas de formulario: llevar el foco al primer campo con error y el contador de los campos con tope. */

/** Enfoca el primer control marcado `aria-invalid="true"` dentro de `contenedor`; devuelve si hubo alguno. */
export function enfocarPrimerError(contenedor: ParentNode): boolean {
  const campo = contenedor.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (campo === null) return false;
  campo.focus();
  campo.scrollIntoView?.({ block: 'center' });
  return true;
}

/** Texto del contador de un campo con tope: «32 de 70». */
export function textoContador(largo: number, tope: number): string {
  return `${largo} de ${tope}`;
}

/** El lector de pantalla solo oye el contador desde el 90 % del tope. */
export function contadorAnunciable(largo: number, tope: number): boolean {
  return tope > 0 && largo >= Math.ceil(tope * 0.9);
}
