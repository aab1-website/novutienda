/** Mensajería mínima entre islas (todas viven en la misma página): eventos del documento. */

export const EVENTOS = {
  mercado: 'cb:mercado',
  carrito: 'cb:carrito',
  abrirCarrito: 'cb:abrir-carrito',
  abrirBuscador: 'cb:abrir-buscador',
  abrirConvertidor: 'cb:abrir-convertidor',
  abrirConsentimiento: 'cb:abrir-consentimiento',
  consentimiento: 'cb:consentimiento',
  agregarAlCarrito: 'cb:agregar',
} as const;
export type NombreEventoBus = (typeof EVENTOS)[keyof typeof EVENTOS];

export function emitir<T>(nombre: NombreEventoBus, detalle?: T, destino: EventTarget = window): void {
  destino.dispatchEvent(new CustomEvent<T>(nombre, { detail: detalle as T }));
}

export function escuchar<T>(nombre: NombreEventoBus, fn: (detalle: T) => void, destino: EventTarget = window): () => void {
  const f = (e: Event): void => fn((e as CustomEvent<T>).detail);
  destino.addEventListener(nombre, f);
  return () => destino.removeEventListener(nombre, f);
}
