import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../estilos/capas.css';
import { devolverFoco } from './capas.js';

export interface OpcionesError {
  /** Si se da, el aviso lleva un botón «Reintentar» que la llama y cierra el aviso. */
  reintentar?: () => void;
  /** El mismo error ya se muestra y se anuncia en otro sitio (`error: 'ambos'`): el aviso se ve, pero no se anuncia dos veces. */
  silencioso?: boolean;
}

export interface Avisos {
  ok(texto: string): number;
  info(texto: string): number;
  error(texto: string, opciones?: OpcionesError): number;
  cerrar(id: number): void;
}

interface AvisoActivo {
  readonly id: number;
  readonly tipo: 'ok' | 'info' | 'error';
  readonly texto: string;
  readonly reintentar?: (() => void) | undefined;
  readonly silencioso?: boolean | undefined;
}

export const MS_AVISO = 6000;
export const MAXIMO_AVISOS = 3;

const SIN_AVISOS: Avisos = { ok: () => 0, info: () => 0, error: () => 0, cerrar: () => undefined };
export const CtxAvisos = createContext<Avisos>(SIN_AVISOS);

/** Avisos de la pantalla. Fuera de un `ProveedorAvisos` (p. ej. pruebas aisladas) no hacen nada. */
export function useAvisos(): Avisos {
  return useContext(CtxAvisos);
}

function AvisoVista({ aviso, cerrar }: { aviso: AvisoActivo; cerrar: (id: number) => void }): JSX.Element {
  // Éxito e info se van solos a los 6 s; la pausa (puntero o foco encima) reinicia la cuenta. Los errores se quedan.
  // Puntero y foco son dos estados: salir con el puntero no reanuda la cuenta si el foco sigue dentro, y al revés.
  const [puntero, setPuntero] = useState(false);
  const [foco, setFoco] = useState(false);
  const pausado = puntero || foco;
  // Quién tenía el foco antes de entrar al aviso, para devolvérselo al cerrarlo con el teclado.
  const previo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (aviso.tipo === 'error' || pausado) return undefined;
    const t = setTimeout(() => cerrar(aviso.id), MS_AVISO);
    return () => clearTimeout(t);
  }, [aviso.id, aviso.tipo, pausado, cerrar]);
  const reintentar = aviso.reintentar;
  return (
    <div
      class={`aviso aviso-${aviso.tipo}`}
      onMouseEnter={() => setPuntero(true)}
      onMouseLeave={() => setPuntero(false)}
      onFocusIn={(e) => {
        setFoco(true);
        const origen = e.relatedTarget;
        if (origen instanceof HTMLElement && !e.currentTarget.contains(origen)) previo.current = origen;
      }}
      onFocusOut={(e) => {
        const destino = e.relatedTarget;
        if (!(destino instanceof Node) || !e.currentTarget.contains(destino)) setFoco(false);
      }}
    >
      <p class="aviso-texto">{aviso.texto}</p>
      <div class="aviso-acciones">
        {reintentar !== undefined && (
          <button
            type="button"
            class="boton boton-secundario boton-chico"
            onClick={() => {
              cerrar(aviso.id);
              reintentar();
            }}
          >
            Reintentar
          </button>
        )}
        <button
          type="button"
          class="boton boton-secundario boton-chico"
          onClick={() => {
            const origen = previo.current;
            cerrar(aviso.id);
            devolverFoco(origen);
          }}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

/**
 * Avisos fijos en pantalla: abajo a la derecha (a lo ancho en celular), por encima del velo de los diálogos. Las dos
 * regiones vivas existen desde el montaje (un lector de pantalla solo anuncia lo que se inserta en una región ya
 * presente). Usan `aria-live` y no `role="status"/"alert"` para no duplicar esos roles en cada pantalla.
 */
export function ProveedorAvisos({ children }: { children?: ComponentChildren }): JSX.Element {
  const [lista, setLista] = useState<readonly AvisoActivo[]>([]);
  const contador = useRef(0);

  const cerrar = useCallback((id: number) => setLista((l) => l.filter((a) => a.id !== id)), []);
  const agregar = useCallback((tipo: AvisoActivo['tipo'], texto: string, reintentar?: () => void, silencioso?: boolean): number => {
    contador.current += 1;
    const id = contador.current;
    setLista((l) => {
      // El mismo aviso repetido reemplaza al anterior; pasado el máximo se descarta el más viejo (primero éxito/info).
      const sinRepetido = l.filter((a) => !(a.tipo === tipo && a.texto === texto));
      const siguiente = [...sinRepetido, { id, tipo, texto, reintentar, silencioso }];
      while (siguiente.length > MAXIMO_AVISOS) {
        const i = siguiente.findIndex((a) => a.tipo !== 'error');
        siguiente.splice(i === -1 ? 0 : i, 1);
      }
      return siguiente;
    });
    return id;
  }, []);

  const api = useMemo<Avisos>(
    () => ({
      ok: (t) => agregar('ok', t),
      info: (t) => agregar('info', t),
      error: (t, o) => agregar('error', t, o?.reintentar, o?.silencioso),
      cerrar,
    }),
    [agregar, cerrar],
  );

  return (
    <CtxAvisos.Provider value={api}>
      {children}
      <div class="avisos" data-capa-viva>
        <div class="avisos-region" aria-live="polite" aria-atomic="false" data-region="avisos-estado">
          {lista.filter((a) => a.tipo !== 'error').map((a) => (
            <AvisoVista key={a.id} aviso={a} cerrar={cerrar} />
          ))}
        </div>
        <div class="avisos-region" aria-live="assertive" aria-atomic="false" data-region="avisos-error">
          {lista.filter((a) => a.tipo === 'error' && a.silencioso !== true).map((a) => (
            <AvisoVista key={a.id} aviso={a} cerrar={cerrar} />
          ))}
        </div>
        <div class="avisos-region" data-region="avisos-error-visual">
          {lista.filter((a) => a.tipo === 'error' && a.silencioso === true).map((a) => (
            <AvisoVista key={a.id} aviso={a} cerrar={cerrar} />
          ))}
        </div>
      </div>
    </CtxAvisos.Provider>
  );
}
