import { h, render, type ComponentChildren, type JSX } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import '../estilos/capas.css';
import { CtxAvisos } from './avisos.js';
import { CtxApp } from './contexto.js';
import { abrirCapa, devolverFoco, enfocables, enfocablesVivos, indiceDeFoco } from './capas.js';

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

/** Ciclo de Tab: lo enfocable del diálogo (sin los diálogos anidados) y, después, los avisos vivos. */
function tabular(e: KeyboardEvent, el: HTMLElement): void {
  const lista = [...enfocables(el).filter((x) => x.closest('.dialogo') === el), ...enfocablesVivos()];
  const i = indiceDeFoco(lista.length, lista.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  e.preventDefault();
  (i === -1 ? el : lista[i])?.focus();
}

/**
 * Monta sus hijos en un contenedor propio de `document.body` (portal mínimo: `render` de preact en vez de
 * `preact/compat`, que pesa ~2,5 KB comprimidos). Como es otro árbol, los contextos no se heredan: se vuelven a
 * proveer aquí los dos que usa el panel (aplicación y avisos). Si aparece un contexto nuevo, súmelo a este portal.
 */
function Portal({ children }: { children?: ComponentChildren }): null {
  const app = useContext(CtxApp);
  const avisos = useContext(CtxAvisos);
  const contenedor = useRef<HTMLDivElement | null>(null);
  contenedor.current ??= document.createElement('div');
  useLayoutEffect(() => {
    const c = contenedor.current;
    if (c === null) return undefined;
    document.body.append(c);
    return () => {
      render(null, c);
      c.remove();
    };
  }, []);
  useLayoutEffect(() => {
    if (contenedor.current !== null) render(h(CtxApp.Provider, { value: app }, h(CtxAvisos.Provider, { value: avisos }, children)), contenedor.current);
  });
  return null;
}

/**
 * Ventana modal accesible (montada = abierta, en un portal sobre `body`: los clics y envíos de lo que hay dentro no
 * llegan al `<form>` ni a la fila con `onClick` de quien la abrió): role=dialog, aria-modal, título y descripción asociados, foco atrapado,
 * Esc, fondo inerte, página sin desplazar y devolución del foco al control que la abrió.
 *
 * Norma: los avisos fijos siguen vivos con el diálogo abierto (entran en su ciclo de Tab), pero un error de la acción
 * del diálogo va LOCAL, dentro de él, junto a lo que falló: use `error: 'local'` o `'ambos'` en `useAccion`, no `'aviso'`.
 */
export function Dialogo(p: PropsDialogo): JSX.Element {
  return <Portal><DialogoInterno {...p} /></Portal>;
}

// No se usa `useId`: cada portal es otra raíz de preact y sus ids pueden repetirse entre raíces.
let contadorDeIds = 0;

function DialogoInterno(p: PropsDialogo): JSX.Element {
  const variante = p.variante ?? 'lateral';
  const raiz = useRef<HTMLDivElement>(null);
  const [serie] = useState(() => (contadorDeIds += 1));
  const idTitulo = `dialogo-${serie}-titulo`;
  const idDescripcion = `dialogo-${serie}-descripcion`;
  const [preguntando, setPreguntando] = useState(false);
  const respaldo = useRef(p.alCerrarEnfocar);
  respaldo.current = p.alCerrarEnfocar;

  useLayoutEffect(() => {
    const el = raiz.current;
    if (el === null) return undefined;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const soltar = abrirCapa(el.parentElement ?? el);
    focoInicial(el, p.foco ?? 'campo').focus();
    // Los avisos (fuera del diálogo, `data-capa-viva`) entran en el ciclo de Tab: el teclado alcanza «Reintentar»/«Cerrar».
    // Cuando el foco está en un aviso, el Tab no pasa por el diálogo: lo atiende el documento, solo el diálogo de más arriba.
    const enAviso = (e: KeyboardEvent): void => {
      const objetivo = e.target;
      if (e.key !== 'Tab' || !(objetivo instanceof Element) || el.contains(objetivo) || objetivo.closest('[data-capa-viva]') === null) return;
      const abiertos = document.querySelectorAll('.dialogo');
      if (abiertos[abiertos.length - 1] === el) tabular(e, el);
    };
    document.addEventListener('keydown', enAviso);
    return () => {
      document.removeEventListener('keydown', enAviso);
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
    tabular(e, el);
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
