import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import { ID_PORTADA, type Medio } from '../../api/tipos.js';
import { useApp } from '../../ui/contexto.js';
import { esperarSubida, mensajeDeSubida } from './esperar.js';
import { validarArchivo } from './validar-archivo.js';

/**
 * Subida de una foto propia para el carrusel de portada (no es de ningún producto): revisando, reservando, subiendo,
 * procesando y listo (o error). Una a la vez. Usa la subida de las fotos con el destino fijo `_portada`; el cupo sale del plan
 * y el servidor lo hace valer al reservar. «Reintentar» solo existe para fallas de red o de subida (mismo `subidaId`).
 */

export type FasePortada = 'reposo' | 'revisando' | 'reservando' | 'subiendo' | 'procesando' | 'listo' | 'error';

export interface EstadoSubidaPortada {
  readonly fase: FasePortada;
  readonly nombre: string;
  /** 0 a 100, en la fase `subiendo`. */
  readonly progreso: number;
  readonly motivo: string | undefined;
  readonly reintentable: boolean;
}

const REPOSO: EstadoSubidaPortada = { fase: 'reposo', nombre: '', progreso: 0, motivo: undefined, reintentable: false };
const EN_CURSO: readonly FasePortada[] = ['revisando', 'reservando', 'subiendo', 'procesando'];

function esReintentable(e: unknown, fase: FasePortada): boolean {
  if (fase === 'subiendo') return true;
  if (!(e instanceof ErrorApi)) return true;
  return e.codigoHttps === 'unavailable' || e.codigoHttps === 'deadline-exceeded' || e.detalle.codigo === 'no-disponible';
}

export interface SubidaPortada extends EstadoSubidaPortada {
  readonly enCurso: boolean;
  readonly elegir: (archivo: File) => void;
  readonly reintentar: () => void;
  readonly descartar: () => void;
}

export function useSubidaPortada(alListo: (medio: Medio) => void): SubidaPortada {
  const { api, almacen } = useApp();
  const [estado, setEstado] = useState<EstadoSubidaPortada>(REPOSO);
  const archivo = useRef<File | null>(null);
  const subidaId = useRef('');
  const subido = useRef(false);
  const abandonado = useRef(false);
  const alListoRef = useRef(alListo);
  alListoRef.current = alListo;

  useEffect(
    () => () => {
      abandonado.current = true;
      archivo.current = null;
    },
    [],
  );

  const cambiar = useCallback((c: Partial<EstadoSubidaPortada>): void => setEstado((s) => ({ ...s, ...c })), []);

  const correr = useCallback(async (): Promise<void> => {
    const a = archivo.current;
    if (a === null) return;
    const id = subidaId.current;
    let fase: FasePortada = 'revisando';
    const ir = (f: FasePortada, c: Partial<EstadoSubidaPortada> = {}): void => {
      fase = f;
      cambiar({ fase: f, ...c });
    };
    try {
      if (!subido.current) {
        ir('reservando');
        const r = await api.llamar('reservarSubida', { subidaId: id, productoId: ID_PORTADA, tipo: 'portada', bytes: a.size });
        if (abandonado.current) return;
        ir('subiendo', { progreso: 0 });
        await almacen.subir(r.rutaOriginal, a, (p) => {
          if (!abandonado.current) cambiar({ progreso: p });
        });
        if (abandonado.current) return;
        subido.current = true;
      }
      ir('procesando');
      const medio = await esperarSubida(api, id, {
        esperar: async (ms) => {
          if (abandonado.current) throw new Error('subida abandonada');
          await new Promise<void>((r) => setTimeout(r, ms));
        },
      });
      if (abandonado.current) return;
      archivo.current = null;
      ir('listo', { motivo: undefined });
      alListoRef.current(medio);
    } catch (e) {
      if (abandonado.current) return;
      cambiar({ fase: 'error', motivo: mensajeDeSubida(e), reintentable: esReintentable(e, fase) });
    }
  }, [api, almacen, cambiar]);

  const elegir = useCallback(
    (a: File): void => {
      if (EN_CURSO.includes(estado.fase)) return;
      // Se marca «revisando» de inmediato: la revisión es asíncrona y no debe poder elegirse otro archivo mientras tanto.
      setEstado({ ...REPOSO, fase: 'revisando', nombre: a.name });
      void validarArchivo(a, 'foto').then((falla) => {
        if (abandonado.current) return;
        if (falla !== undefined) {
          archivo.current = null;
          setEstado({ ...REPOSO, fase: 'error', nombre: a.name, motivo: falla });
          return;
        }
        archivo.current = a;
        subidaId.current = nuevoId();
        subido.current = false;
        setEstado({ ...REPOSO, fase: 'revisando', nombre: a.name });
        void correr();
      });
    },
    [correr, estado.fase],
  );

  const reintentar = useCallback((): void => {
    if (estado.fase !== 'error' || !estado.reintentable || archivo.current === null) return;
    cambiar({ fase: subido.current ? 'procesando' : 'reservando', motivo: undefined, reintentable: false });
    void correr();
  }, [cambiar, correr, estado.fase, estado.reintentable]);

  const descartar = useCallback((): void => {
    archivo.current = null;
    setEstado(REPOSO);
  }, []);

  return { ...estado, enCurso: EN_CURSO.includes(estado.fase), elegir, reintentar, descartar };
}
