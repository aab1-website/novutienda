import { useEffect, useRef, useState } from 'preact/hooks';
import { useAccion, useCarga } from '../../ui/hooks.js';

export interface Pagina<F, C> {
  readonly filas: readonly F[];
  readonly siguiente: C | null;
}

export interface Paginado<F> {
  readonly filas: readonly F[];
  readonly cargando: boolean;
  readonly error: string | null;
  readonly hayMas: boolean;
  readonly cargandoMas: boolean;
  readonly errorMas: string | null;
  readonly cargarMas: () => void;
  readonly recargar: () => void;
}

/**
 * Lista paginada por cursor: la primera página se carga al entrar o al cambiar `deps`; «Cargar más» pide la siguiente
 * con el cursor que devolvió el servidor y la agrega al final. Recargar vuelve a la primera página.
 * Un contador de generación descarta la respuesta de «Cargar más» que llega después de un cambio de filtro o de una recarga.
 */
export function usePaginado<F, C>(pedir: (cursor: C | undefined) => Promise<Pagina<F, C>>, deps: readonly unknown[]): Paginado<F> {
  const primera = useCarga(() => pedir(undefined), deps);
  const accion = useAccion();
  const [extra, setExtra] = useState<Pagina<F, C> | null>(null);
  const generacion = useRef(0);
  useEffect(() => {
    generacion.current += 1;
    setExtra(null);
  }, [primera.datos]);
  // Un cambio de filtro invalida las respuestas en vuelo desde el mismo instante, sin esperar la nueva primera página.
  const claveDeps = useRef<readonly unknown[]>(deps);
  if (claveDeps.current.length !== deps.length || claveDeps.current.some((x, i) => !Object.is(x, deps[i]))) {
    claveDeps.current = deps;
    generacion.current += 1;
  }
  const siguiente = extra !== null ? extra.siguiente : (primera.datos?.siguiente ?? null);
  const cargarMas = (): void => {
    if (siguiente === null) return;
    const mia = generacion.current;
    void accion.ejecutar(async () => {
      const r = await pedir(siguiente);
      if (mia !== generacion.current) return;
      setExtra((previo) => ({ filas: [...(previo?.filas ?? []), ...r.filas], siguiente: r.siguiente }));
    });
  };
  return {
    filas: [...(primera.datos?.filas ?? []), ...(extra?.filas ?? [])],
    cargando: primera.cargando,
    error: primera.error,
    hayMas: siguiente !== null,
    cargandoMas: accion.ocupado,
    errorMas: accion.error,
    cargarMas,
    recargar: primera.recargar,
  };
}
