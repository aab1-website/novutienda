import { useEffect } from 'preact/hooks';

/**
 * En el celular (640 px o menos) la cabecera se oculta al bajar y vuelve al subir. Solo alterna una clase: el CSS la desplaza con
 * `transform` (la cabecera es `sticky`, así que no hay saltos de layout) y sin transición si se pidió menos movimiento.
 * Nunca se oculta con el menú abierto ni con el foco dentro de ella, y la cabecera vuelve sola al ensanchar la pantalla.
 */
export default function CabeceraMovil() {
  useEffect(() => {
    const cab = document.querySelector<HTMLElement>('.cabecera');
    if (cab === null) return;
    const celular = window.matchMedia('(max-width: 640px)');
    let ultimo = window.scrollY;
    let pendiente = false;
    const mostrar = (): void => cab.classList.remove('cabecera-oculta');
    const actualizar = (): void => {
      pendiente = false;
      const y = window.scrollY;
      const dy = y - ultimo;
      if (!celular.matches || y <= cab.offsetHeight || dy < -4) mostrar();
      else if (dy > 4 && cab.querySelector('details[open]') === null && !cab.contains(document.activeElement)) cab.classList.add('cabecera-oculta');
      if (Math.abs(dy) > 4) ultimo = y;
    };
    const alDesplazar = (): void => {
      if (pendiente) return;
      pendiente = true;
      window.requestAnimationFrame(actualizar);
    };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    cab.addEventListener('focusin', mostrar);
    celular.addEventListener('change', mostrar);
    return () => {
      window.removeEventListener('scroll', alDesplazar);
      cab.removeEventListener('focusin', mostrar);
      celular.removeEventListener('change', mostrar);
      mostrar();
    };
  }, []);
  return null;
}
