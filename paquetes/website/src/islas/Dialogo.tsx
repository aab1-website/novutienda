import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { indiceDeFoco, SELECTOR_ENFOCABLE } from '../lib/foco.js';

interface Props {
  titulo: string;
  onCerrar(): void;
  /** `lateral` para el carrito; `centro` para el resto. */
  variante?: 'centro' | 'lateral';
  children: ComponentChildren;
  /** Si es verdadero, el foco inicial va al primer campo en lugar de al botón de cerrar. */
  enfocarCampo?: boolean;
}

let abiertos = 0;

/**
 * Ventana modal accesible: role=dialog, aria-modal, título asociado, foco atrapado, Escape
 * para cerrar, clic fuera para cerrar y devolución del foco al control que la abrió.
 */
export function Dialogo({ titulo, onCerrar, variante = 'centro', children, enfocarCampo = false }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const idTitulo = `dlg-${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    abiertos += 1;
    document.documentElement.classList.add('sin-desplazar');
    const el = raiz.current;
    const enfocables = (): HTMLElement[] => (el === null ? [] : Array.from(el.querySelectorAll<HTMLElement>(SELECTOR_ENFOCABLE)).filter((x) => x.offsetParent !== null || x === document.activeElement));
    const inicial = enfocarCampo ? el?.querySelector<HTMLElement>('input, textarea, select') : el?.querySelector<HTMLElement>('[data-cerrar]');
    (inicial ?? enfocables()[0] ?? el)?.focus();

    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCerrar();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables();
      const i = indiceDeFoco(lista.length, lista.indexOf(document.activeElement as HTMLElement), e.shiftKey);
      if (i === -1) {
        e.preventDefault();
        el?.focus();
        return;
      }
      e.preventDefault();
      lista[i]?.focus();
    };
    document.addEventListener('keydown', alTeclear, true);
    return () => {
      document.removeEventListener('keydown', alTeclear, true);
      abiertos -= 1;
      if (abiertos <= 0) {
        abiertos = 0;
        document.documentElement.classList.remove('sin-desplazar');
      }
      previo?.focus();
    };
    // El diálogo se monta una vez por apertura.
  }, []);

  return (
    <div class={`dialogo-fondo dialogo-${variante}`} onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div ref={raiz} class="dialogo" role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <div class="dialogo-cabecera">
          <h2 id={idTitulo} class="dialogo-titulo">{titulo}</h2>
          <button type="button" class="boton-icono" data-cerrar aria-label="Cerrar" onClick={onCerrar}>
            <svg class="icono" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
