import { useCallback, useContext, useEffect, useRef, useState } from 'preact/hooks';
import { ErrorApi, mensajeDeError } from '../api/errores.js';
import { useAvisos } from './avisos.js';
import { CtxApp } from './contexto.js';

const esNoAutenticado = (e: unknown): boolean => e instanceof ErrorApi && e.codigoHttps === 'unauthenticated';

/**
 * El servidor responde `unauthenticated` también por App Check, correo sin verificar o cuenta anónima, no solo por una
 * sesión vencida. Tras renovar el token con éxito, solo este mensaje (el del token inválido o revocado) sigue siendo sesión.
 */
const MENSAJE_DE_SESION = /sesi[oó]n no es v[aá]lida|revocad/i;

/**
 * Texto de un error ya descartado como sesión vencida. `mensajeDeError` traduce todo `unauthenticated` a «Su sesión
 * venció», que aquí sería falso: se muestra el mensaje del servidor (App Check, correo sin verificar…), si trae uno.
 */
function textoDe(e: unknown): string {
  if (e instanceof SesionPerdida) return mensajeDeError(e.original);
  if (esNoAutenticado(e) && e instanceof Error && e.message.trim() !== '' && e.message.trim().toLowerCase() !== 'unauthenticated') return e.message;
  return mensajeDeError(e);
}

/** La sesión no se pudo recuperar: la aplicación debe cerrarla. Lleva el error original para mostrarlo. */
class SesionPerdida extends Error {
  constructor(readonly original: unknown) {
    super('sesión vencida');
  }
}

/**
 * Corre `fn`; ante `unauthenticated` fuerza la renovación del token y reintenta UNA vez (sin bucles). Si la renovación
 * falla, o el reintento sigue diciendo que la sesión no vale, lanza `SesionPerdida`; cualquier otro error (App Check,
 * correo sin verificar…) sale tal cual y se muestra como error normal. Sin `renovar` no hay nada que intentar.
 */
async function conRenovacion<R>(fn: () => Promise<R>, renovar: (() => Promise<boolean>) | undefined): Promise<R> {
  try {
    return await fn();
  } catch (e) {
    if (!esNoAutenticado(e) || renovar === undefined) throw e;
    let renovada: boolean;
    try {
      renovada = await renovar();
    } catch {
      renovada = false;
    }
    if (!renovada) throw new SesionPerdida(e);
    try {
      return await fn();
    } catch (e2) {
      if (esNoAutenticado(e2) && MENSAJE_DE_SESION.test(e2 instanceof Error ? e2.message : '')) throw new SesionPerdida(e2);
      throw e2;
    }
  }
}

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
  const renovarRef = useRef(ctx?.renovarSesion);
  renovarRef.current = ctx?.renovarSesion;

  useEffect(() => {
    let vivo = true;
    // Un `recargar()` con las mismas dependencias conserva lo que ya se ve (sin parpadeo); si cambian, se muestra la carga.
    const previas = depsPrevias.current;
    const mismas = previas !== null && previas.length === deps.length && previas.every((d, i) => Object.is(d, deps[i]));
    depsPrevias.current = deps;
    const cargar = (inicial: boolean): void => {
      if (inicial) setCargando(true);
      conRenovacion(() => fnRef.current(), renovarRef.current).then(
        (d) => {
          if (!vivo) return;
          setDatos(d);
          setError(null);
          setCargando(false);
        },
        (e: unknown) => {
          if (!vivo) return;
          if (e instanceof SesionPerdida) vencidaRef.current?.();
          setError(textoDe(e));
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
  const renovarRef = useRef(ctx?.renovarSesion);
  renovarRef.current = ctx?.renovarSesion;
  const ejecutar = useCallback(async <R,>(fn: () => Promise<R>, opciones?: OpcionesAccion<R>): Promise<R | undefined> => {
    if (enCurso.current) return undefined;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      const r = await conRenovacion(fn, renovarRef.current);
      if (opciones?.exito !== undefined) avisosRef.current.ok(typeof opciones.exito === 'function' ? opciones.exito(r) : opciones.exito);
      return r;
    } catch (e) {
      if (e instanceof SesionPerdida && vencidaRef.current !== undefined) {
        vencidaRef.current();
        return undefined;
      }
      const texto = textoDe(e);
      const modo = opciones?.error ?? 'local';
      if (modo !== 'aviso') setError(texto);
      // Con `ambos` el error local ya se anuncia (role=alert): el aviso fijo se ve, pero no se anuncia dos veces.
      if (modo !== 'local') avisosRef.current.error(texto, modo === 'ambos' ? { silencioso: true } : undefined);
      return undefined;
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  }, []);
  return { ocupado, error, ejecutar, limpiar: () => setError(null) };
}
