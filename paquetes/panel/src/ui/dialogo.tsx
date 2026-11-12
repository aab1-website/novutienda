import type { ComponentChildren, JSX } from 'preact';
import { useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import '../estilos/capas.css';
import { abrirCapa, devolverFoco, enfocables, indiceDeFoco } from './capas.js';

export interface PropsDialogo {
  titulo: string;
  onCerrar: () => void;
  /** `lateral` (por omisión) para editar; `centro` para confirmaciones. */
  variante?: 'centro' | 'lateral' | undefined;
  lado?: 'derecha' | 'izquierda' | undefined;
  descripcion?: string | undefined;
  /** Botones fijos al pie (siempre a la vista). */
  pie?: ComponentChildren;
  /** Dónde cae el foco al abrir: el primer campo, el botón de cerrar o el botón marcado `data-seguro`. */
  foco?: 'campo' | 'cerrar' | 'seguro' | undefined;
  /** Hay cambios sin guardar: cerrar por Esc, la X o el fondo pregunta antes de descartar. */
  sucio?: boolean | undefined;
  /** Dónde enfocar al cerrar si el control que abrió ya no existe (si falta, el título de la pantalla). */
  alCerrarEnfocar?: (() => HTMLElement | null) | undefined;
  children?: ComponentChildren;
}

const CAMPOS = 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';

function focoInicial(el: HTMLElement, foco: 'campo' | 'cerrar' | 'seguro'): HTMLElement {
  const cerrar = el.querySelector<HTMLElement>('[data-cerrar]');
  const dentro = enfocables(el).filter((x) => x !== cerrar && x.closest('.dialogo') === el);
  if (foco === 'cerrar') return cerrar ?? el;
  if (foco === 'seguro') return dentro.find((x) => x.hasAttribute('data-seguro')) ?? cerrar ?? el;
  return dentro.find((x) => x.matches(CAMPOS)) ?? dentro[0] ?? cerrar ?? el;
}

/**
 * Ventana modal accesible (montada = abierta): role=dialog, aria-modal, título y descripción asociados, foco atrapado,
 * Esc, fondo inerte, página sin desplazar y devolución del foco al control que la abrió.
 */
export function Dialogo(p: PropsDialogo): JSX.Element {
  const variante = p.variante ?? 'lateral';
  const raiz = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const idDescripcion = useId();
  const [preguntando, setPreguntando] = useState(false);
  const respaldo = useRef(p.alCerrarEnfocar);
  respaldo.current = p.alCerrarEnfocar;

  useLayoutEffect(() => {
    const el = raiz.current;
    if (el === null) return undefined;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const soltar = abrirCapa(el.parentElement ?? el);
    focoInicial(el, p.foco ?? 'campo').focus();
    return () => {
      soltar();
      devolverFoco(previo, () => respaldo.current?.() ?? null);
    };
    // El diálogo se monta una vez por apertura.
  }, []);

  const intentarCerrar = (): void => {
    if (p.sucio === true) setPreguntando(true);
    else p.onCerrar();
  };

  const alTeclear = (e: KeyboardEvent): void => {
    const el = raiz.current;
    if (el === null) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      intentarCerrar();
      return;
    }
    if (e.key !== 'Tab') return;
    e.stopPropagation();
    const lista = enfocables(el).filter((x) => x.closest('.dialogo') === el);
    const i = indiceDeFoco(lista.length, lista.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    e.preventDefault();
    (i === -1 ? el : lista[i])?.focus();
  };

  return (
    <div class={`dialogo-fondo dialogo-${variante} dialogo-${p.lado ?? 'derecha'}`} onClick={(e) => e.target === e.currentTarget && intentarCerrar()}>
      <div
        ref={raiz}
        class="dialogo"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={p.descripcion === undefined ? undefined : idDescripcion}
        tabIndex={-1}
        onKeyDown={alTeclear}
      >
        <div class="dialogo-cabecera">
          <h2 id={idTitulo} class="dialogo-titulo">
            {p.titulo}
          </h2>
          <button type="button" class="boton-icono" data-cerrar aria-label="Cerrar" onClick={intentarCerrar}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="dialogo-cuerpo">
          {p.descripcion !== undefined && (
            <p id={idDescripcion} class="dialogo-descripcion">
              {p.descripcion}
            </p>
          )}
          {p.children}
        </div>
        {p.pie !== undefined && <div class="dialogo-pie">{p.pie}</div>}
        {preguntando && (
          <Dialogo
            variante="centro"
            titulo="¿Descartar los cambios?"
            descripcion="Lo que cambió y no guardó se perderá."
            foco="seguro"
            onCerrar={() => setPreguntando(false)}
            pie={
              <>
                <button type="button" class="boton boton-secundario" data-seguro onClick={() => setPreguntando(false)}>
                  Seguir editando
                </button>
                <button
                  type="button"
                  class="boton boton-peligro"
                  onClick={() => {
                    setPreguntando(false);
                    p.onCerrar();
                  }}
                >
                  Descartar cambios
                </button>
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
