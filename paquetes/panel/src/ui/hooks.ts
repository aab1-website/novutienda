import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { ErrorApi, mensajeDeError } from '../api/errores.js';
import { useAvisos } from './avisos.js';
import { CtxApp } from './contexto.js';

const esSesionVencida = (e: unknown): boolean => e instanceof ErrorApi && e.codigoHttps === 'unauthenticated';

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
  const depsPrevias = useRef<readonly unknown[] | null>(null);
  const ctx = useContext(CtxApp);
  const vencidaRef = useRef(ctx?.sesionVencida);
  vencidaRef.current = ctx?.sesionVencida;

  useEffect(() => {
    let vivo = true;
    // Un `recargar()` con las mismas dependencias conserva lo que ya se ve (sin parpadeo); si cambian, se muestra la carga.
    const previas = depsPrevias.current;
    const mismas = previas !== null && previas.length === deps.length && previas.every((d, i) => Object.is(d, deps[i]));
    depsPrevias.current = deps;
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
          if (esSesionVencida(e)) vencidaRef.current?.();
          setError(mensajeDeError(e));
          setCargando(false);
        },
      );
    };
    cargar(!mismas);
    const t = cadaMs === undefined ? undefined : setInterval(() => cargar(false), cadaMs);
    return () => {
      vivo = false;
      if (t !== undefined) clearInterval(t);
    };
  }, [...deps, version, cadaMs]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  return { datos, error, cargando, recargar };
}

export interface OpcionesAccion<R> {
  /** Aviso de éxito (texto fijo o calculado con el resultado). Sin esto no hay aviso. */
  readonly exito?: string | ((resultado: R) => string);
  /** Dónde se ve el error: `local` (el de siempre, en `error`), `aviso` (aviso fijo) o `ambos`. */
  readonly error?: 'local' | 'aviso' | 'ambos';
}

export interface Accion {
  readonly ocupado: boolean;
  readonly error: string | null;
  readonly ejecutar: <R>(fn: () => Promise<R>, opciones?: OpcionesAccion<R>) => Promise<R | undefined>;
  readonly limpiar: () => void;
}

/** Ejecuta una escritura: evita el doble envío y deja el error traducido. */
export function useAccion(): Accion {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enCurso = useRef(false);
  const avisos = useAvisos();
  const ctx = useContext(CtxApp);
  const avisosRef = useRef(avisos);
  avisosRef.current = avisos;
  const vencidaRef = useRef(ctx?.sesionVencida);
  vencidaRef.current = ctx?.sesionVencida;
  const ejecutar = useCallback(async <R,>(fn: () => Promise<R>, opciones?: OpcionesAccion<R>): Promise<R | undefined> => {
    if (enCurso.current) return undefined;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      const r = await fn();
      if (opciones?.exito !== undefined) avisosRef.current.ok(typeof opciones.exito === 'function' ? opciones.exito(r) : opciones.exito);
      return r;
    } catch (e) {
      if (esSesionVencida(e) && vencidaRef.current !== undefined) {
        vencidaRef.current();
        return undefined;
      }
      const texto = mensajeDeError(e);
      const modo = opciones?.error ?? 'local';
      if (modo !== 'aviso') setError(texto);
      if (modo !== 'local') avisosRef.current.error(texto);
      return undefined;
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  }, []);
  return { ocupado, error, ejecutar, limpiar: () => setError(null) };
}
