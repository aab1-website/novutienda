import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Dialogo } from './dialogo.js';

/**
 * Guardia de cambios sin guardar y borradores en memoria (G-05).
 *
 * - Una pantalla con cambios sin guardar llama `useCambiosSinGuardar(sucio)`. Mientras haya alguna, la guardia
 *   intercepta los enlaces internos (`#/…`), «atrás» del navegador, cerrar la pestaña (`beforeunload`) y «Salir»
 *   (`confirmarSalida`), y pregunta con el `Dialogo` antes de descartar.
 * - «Atrás» no duplica la entrada del historial: la URL se restaura con `replaceState` (sin entrada nueva) y, si
 *   la persona descarta, el destino se aplica también con `replaceState`. El costo: tras cancelar «atrás», la
 *   entrada anterior queda reemplazada por la actual.
 * - Los borradores viven solo en memoria del panel (un `Map` del proveedor): sobreviven al cambio de pestaña dentro
 *   del panel, pero no a recargar, cerrar la pestaña ni cerrar sesión (el proveedor se desmonta). Nunca se escriben
 *   en el dispositivo, por privacidad.
 */

interface ContextoGuardia {
  /** Registra (o quita) una fuente de cambios sin guardar bajo un identificador propio. */
  readonly marcar: (id: string, sucio: boolean) => void;
  /** Ejecuta `accion` ya; si hay cambios sin guardar, antes pregunta si se descartan. */
  readonly confirmarSalida: (accion: () => void) => void;
  readonly borradores: Map<string, unknown>;
}

const CtxGuardia = createContext<ContextoGuardia | null>(null);

interface Pendiente {
  readonly aplicar: () => void;
}

const hashDe = (href: string): string | null => {
  try {
    const u = new URL(href, window.location.href);
    return u.origin === window.location.origin && u.pathname === window.location.pathname && u.search === window.location.search && u.hash !== '' ? u.hash : null;
  } catch {
    return null;
  }
};

export function ProveedorGuardia({ children }: { children?: ComponentChildren }): JSX.Element {
  const fuentes = useRef(new Set<string>());
  const borradores = useRef(new Map<string, unknown>());
  const ultimo = useRef(window.location.hash);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const pendienteRef = useRef<Pendiente | null>(null);
  pendienteRef.current = pendiente;

  const haySucio = (): boolean => fuentes.current.size > 0;
  const marcar = useCallback((id: string, sucio: boolean) => {
    if (sucio) {
      if (fuentes.current.size === 0) ultimo.current = window.location.hash;
      fuentes.current.add(id);
    } else fuentes.current.delete(id);
  }, []);
  const preguntar = useCallback((aplicar: () => void) => setPendiente({ aplicar }), []);
  const confirmarSalida = useCallback(
    (accion: () => void) => {
      if (haySucio()) preguntar(accion);
      else accion();
    },
    [preguntar],
  );

  useEffect(() => {
    // Sin cambios, el hash vigente es el de referencia para restaurar.
    const registrar = (): void => {
      if (!haySucio()) ultimo.current = window.location.hash;
    };
    const alClic = (e: MouseEvent): void => {
      if (!haySucio() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (a === null || (a.getAttribute('target') ?? '') !== '' || a.hasAttribute('download')) return;
      const destino = hashDe((a as HTMLAnchorElement).href);
      if (destino === null || destino === window.location.hash) return;
      e.preventDefault();
      preguntar(() => {
        window.location.hash = destino;
      });
    };
    // «Atrás»/«adelante» (popstate) y cualquier cambio de hash ajeno a un clic (hashchange): se restaura la URL sin
    // entrada nueva y se pregunta. El hashchange que sigue a un popstate ya trae el hash restaurado.
    const alVolver = (e: Event): void => {
      if (!haySucio() || window.location.hash === ultimo.current) {
        registrar();
        return;
      }
      const destino = window.location.hash;
      window.history.replaceState(window.history.state, '', ultimo.current === '' ? window.location.pathname + window.location.search : ultimo.current);
      if (e.type === 'hashchange') e.stopImmediatePropagation();
      if (pendienteRef.current !== null) return;
      preguntar(() => {
        window.history.replaceState(window.history.state, '', destino);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    };
    const alCerrarPestana = (e: BeforeUnloadEvent): void => {
      if (!haySucio()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('click', alClic, true);
    window.addEventListener('popstate', alVolver, true);
    window.addEventListener('hashchange', alVolver, true);
    window.addEventListener('beforeunload', alCerrarPestana);
    return () => {
      document.removeEventListener('click', alClic, true);
      window.removeEventListener('popstate', alVolver, true);
      window.removeEventListener('hashchange', alVolver, true);
      window.removeEventListener('beforeunload', alCerrarPestana);
    };
  }, [preguntar]);

  const valor = useMemo<ContextoGuardia>(() => ({ marcar, confirmarSalida, borradores: borradores.current }), [marcar, confirmarSalida]);
  const descartar = (): void => {
    const p = pendiente;
    setPendiente(null);
    fuentes.current.clear();
    p?.aplicar();
  };

  return (
    <CtxGuardia.Provider value={valor}>
      {children}
      {pendiente !== null && (
        <Dialogo
          variante="centro"
          titulo="¿Salir sin guardar?"
          descripcion="Tiene cambios sin guardar. Si sale ahora, se perderán."
          foco="seguro"
          onCerrar={() => setPendiente(null)}
          pie={
            <>
              <button type="button" class="boton boton-secundario" data-seguro onClick={() => setPendiente(null)}>
                Seguir editando
              </button>
              <button type="button" class="boton boton-peligro" onClick={descartar}>
                Salir sin guardar
              </button>
            </>
          }
        />
      )}
    </CtxGuardia.Provider>
  );
}

let serieFuente = 0;

/** Declara que la pantalla tiene (o ya no tiene) cambios sin guardar. Sin proveedor no hace nada. */
export function useCambiosSinGuardar(sucio: boolean): void {
  const g = useContext(CtxGuardia);
  const [id] = useState(() => `fuente-${(serieFuente += 1)}`);
  useEffect(() => {
    g?.marcar(id, sucio);
    return () => g?.marcar(id, false);
  }, [g, id, sucio]);
}

/** Para «Salir» y similares: `confirmarSalida(accion)` pregunta antes si hay cambios sin guardar. */
export function useGuardia(): Pick<ContextoGuardia, 'confirmarSalida'> {
  const g = useContext(CtxGuardia);
  return { confirmarSalida: g?.confirmarSalida ?? ((accion) => accion()) };
}

type Actualizacion<T> = T | ((previo: T) => T);

/**
 * Estado que sobrevive al cambio de pestaña (y de pantalla) dentro del panel: vive en memoria del proveedor bajo
 * `clave` (inclúyala con el nombre de la pantalla y, si aplica, el registro editado). `descartar` lo borra y
 * restaura el inicial; llámelo al guardar con éxito o al cancelar. Sin proveedor se comporta como `useState`.
 */
export function useBorrador<T>(clave: string, inicial: T): { valor: T; poner: (v: Actualizacion<T>) => void; descartar: () => void; hayBorrador: boolean } {
  const g = useContext(CtxGuardia);
  const [valor, setValor] = useState<T>(() => (g !== null && g.borradores.has(clave) ? (g.borradores.get(clave) as T) : inicial));
  const ref = useRef(valor);
  ref.current = valor;
  const poner = useCallback(
    (v: Actualizacion<T>) => {
      const nuevo = typeof v === 'function' ? (v as (p: T) => T)(ref.current) : v;
      ref.current = nuevo;
      g?.borradores.set(clave, nuevo);
      setValor(nuevo);
    },
    [g, clave],
  );
  const inicialRef = useRef(inicial);
  const descartar = useCallback(() => {
    g?.borradores.delete(clave);
    ref.current = inicialRef.current;
    setValor(inicialRef.current);
  }, [g, clave]);
  return { valor, poner, descartar, hayBorrador: g?.borradores.has(clave) ?? false };
}
