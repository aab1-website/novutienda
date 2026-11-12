/**
 * Mecánica de las capas modales (diálogos y paneles): fondo inerte, desplazamiento bloqueado y foco atrapado.
 * La idea se copió de la isla del sitio (Central no importa de un módulo ni del sitio).
 */

/** Elementos que pueden recibir el foco con el teclado. */
export const SELECTOR_ENFOCABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** Índice al que debe ir el foco dentro de `total` elementos; -1 si no hay ninguno. */
export function indiceDeFoco(total: number, actual: number, retroceso: boolean): number {
  if (total <= 0) return -1;
  if (actual < 0 || actual >= total) return retroceso ? total - 1 : 0;
  if (retroceso) return actual === 0 ? total - 1 : actual - 1;
  return actual === total - 1 ? 0 : actual + 1;
}

/** Enfocables dentro de `raiz`, sin los ocultos ni los que están bajo un ancestro inerte. */
export function enfocables(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)).filter((e) => !e.hidden && e.closest('[inert], [hidden]') === null);
}

let capasAbiertas = 0;

/** Cuántas capas modales hay abiertas (para pruebas). */
export function cuentaDeCapas(): number {
  return capasAbiertas;
}

/**
 * Abre una capa: deja inertes los hermanos de `el` y de cada uno de sus ancestros hasta `body` (menos las regiones
 * marcadas `data-capa-viva`) y bloquea el desplazamiento de la página. Devuelve la función que lo deshace; solo
 * restaura lo que esta capa marcó, de modo que las capas anidadas se deshacen en cualquier orden.
 */
export function abrirCapa(el: HTMLElement): () => void {
  const marcados: Element[] = [];
  let nodo: HTMLElement = el;
  while (nodo !== document.body && nodo.parentElement !== null) {
    const padre: HTMLElement = nodo.parentElement;
    for (const hermano of Array.from(padre.children)) {
      if (hermano === nodo || hermano.hasAttribute('inert') || hermano.hasAttribute('data-capa-viva')) continue;
      hermano.setAttribute('inert', '');
      marcados.push(hermano);
    }
    nodo = padre;
  }
  capasAbiertas += 1;
  document.documentElement.classList.add('sin-desplazar');
  let abierta = true;
  return () => {
    if (!abierta) return;
    abierta = false;
    for (const m of marcados) m.removeAttribute('inert');
    capasAbiertas = Math.max(0, capasAbiertas - 1);
    if (capasAbiertas === 0) document.documentElement.classList.remove('sin-desplazar');
  };
}

function enfocarSi(el: HTMLElement | null): boolean {
  if (el === null || !el.isConnected) return false;
  el.focus();
  return document.activeElement === el;
}

function alTitulo(): void {
  const h1 = document.querySelector<HTMLElement>('h1');
  if (h1 === null) return;
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
  h1.focus();
}

/**
 * Devuelve el foco a `previo`; si ya no existe, a `respaldo` y, al final, al título de la pantalla. El control de
 * origen puede desaparecer en el mismo ciclo (p. ej. al quitar una fila): por eso se revisa de nuevo al terminar.
 */
export function devolverFoco(previo: HTMLElement | null, respaldo?: () => HTMLElement | null): void {
  enfocarSi(previo);
  queueMicrotask(() => {
    const a = document.activeElement;
    if (a !== null && a !== document.body) return;
    if (enfocarSi(previo) || enfocarSi(respaldo?.() ?? null)) return;
    alTitulo();
  });
}
