import { useState } from 'preact/hooks';

let contador = 0;

/**
 * Id único y estable por instancia. Sustituye a `useId` de preact, que numera por posición dentro de cada raíz
 * y se repite entre raíces (el portal del diálogo es otra raíz) y al montarse piezas tras el primer render.
 */
export function useIdUnico(): string {
  const [id] = useState(() => `u${(contador += 1)}`);
  return id;
}
