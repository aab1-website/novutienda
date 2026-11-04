import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { mensajeDeError } from '../api/errores.js';

export interface Carga<T> {
  readonly datos: T | undefined;
  readonly error: string | null;
  readonly cargando: boolean;
  readonly recargar: () => void;
}

/** Carga datos al montar y cuando cambian las dependencias; el error se traduce a un mensaje legible. */
export function useCarga<T>(fn: () => Promise<T>, deps: readonly unknown[], cadaMs?: number): Carga<T> {
  const [datos, setDatos] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let vivo = true;
    const cargar = (inicial: boolean): void => {
      if (inicial) setCargando(true);
      fnRef.current().then(
        (d) => {
          if (!vivo) return;
          setDatos(d);
          setError(null);
          setCargando(false);
        },
        (e: unknown) => {
          if (!vivo) return;
          setError(mensajeDeError(e));
          setCargando(false);
        },
      );
    };
    cargar(true);
    const t = cadaMs === undefined ? undefined : setInterval(() => cargar(false), cadaMs);
    return () => {
      vivo = false;
      if (t !== undefined) clearInterval(t);
    };
  }, [...deps, version, cadaMs]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos, error, cargando, recargar };
}

export interface Accion {
  readonly ocupado: boolean;
  readonly error: string | null;
  readonly ejecutar: <R>(fn: () => Promise<R>) => Promise<R | undefined>;
  readonly limpiar: () => void;
}

/** Ejecuta una escritura: evita el doble envío y deja el error traducido. */
export function useAccion(): Accion {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);
  const ejecutar = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    if (enCurso.current) return undefined;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(mensajeDeError(e));
      return undefined;
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  }, []);
  return { ocupado, error, ejecutar, limpiar: () => setError(null) };
}
