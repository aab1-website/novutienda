import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import { LIMITES_PANEL, type Medio, type TipoMedio } from '../../api/tipos.js';
import { useApp } from '../../ui/contexto.js';
import { esperarSubida, mensajeDeSubida } from './esperar.js';
import { validarArchivo } from './validar-archivo.js';

/**
 * Subidas de la página de un producto: cada archivo pasa por revisando, reservando, subiendo, procesando y listo (o error).
 * «Reintentar» solo existe para fallas de red o de subida (mismo `subidaId`, el `File` sigue en memoria); si el servidor
 * rechaza el archivo se muestra su motivo y la persona elige otro.
 */

export type FaseSubida = 'revisando' | 'reservando' | 'subiendo' | 'procesando' | 'listo' | 'error';

export interface Subida {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: TipoMedio;
  readonly fase: FaseSubida;
  /** 0 a 100, en la fase `subiendo`. */
  readonly progreso: number;
  /** Segundos transcurridos en la fase `procesando`. */
  readonly segundos: number;
  readonly motivo: string | undefined;
  readonly reintentable: boolean;
  /** El servidor ya tiene reservado el lugar de esta subida (cuenta para el cupo mientras se pueda reintentar). */
  readonly reservada: boolean;
  readonly medioId: string | undefined;
}

const EN_CURSO: readonly FaseSubida[] = ['revisando', 'reservando', 'subiendo', 'procesando'];

export const topeDe = (tipo: TipoMedio): number => (tipo === 'foto' ? LIMITES_PANEL.fotosPorProducto : LIMITES_PANEL.videosPorProducto);

/** Foto o video según el archivo (para soltar archivos sueltos en la zona de carga). */
export function tipoDeArchivo(a: { readonly name: string; readonly type: string }): TipoMedio {
  return a.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(a.name) ? 'video' : 'foto';
}

function ocupaCupo(s: Subida): boolean {
  if (EN_CURSO.includes(s.fase)) return true;
  // `listo` ya no cuenta: el medio forma parte de los medios reales (y si se borró, el lugar se recupera).
  // Falló con la reserva puesta y se puede reintentar: el servidor sigue contándolo.
  return s.reservada && s.reintentable;
}

/** Lugares libres: el tope menos lo ya subido al producto (según el servidor) menos las subidas que ocupan lugar. */
export function cupoLibre(tipo: TipoMedio, medios: readonly Medio[], subidas: readonly Subida[]): number {
  const subidos = medios.filter((m) => m.tipo === tipo).length;
  const ocupan = subidas.filter((s) => s.tipo === tipo && ocupaCupo(s)).length;
  return Math.max(0, topeDe(tipo) - subidos - ocupan);
}

function esReintentable(e: unknown, fase: FaseSubida): boolean {
  if (fase === 'subiendo') return true;
  if (!(e instanceof ErrorApi)) return true;
  return e.codigoHttps === 'unavailable' || e.codigoHttps === 'deadline-exceeded' || e.detalle.codigo === 'no-disponible';
}

const plural = (n: number, uno: string, varios: string): string => `${String(n)} ${n === 1 ? uno : varios}`;
const nombreDe = (tipo: TipoMedio, n: number): string => (tipo === 'foto' ? plural(n, 'foto', 'fotos') : plural(n, 'video', 'videos'));

export interface OpcionesSubidas {
  readonly productoId: string;
  /** Medios que el servidor tiene del producto (`listarMedios`). */
  readonly medios: readonly Medio[];
  /** Un archivo terminó de procesarse. */
  readonly alListo: (medio: Medio, archivo: File) => void;
}

export interface Subidas {
  readonly subidas: readonly Subida[];
  readonly enCurso: number;
  /** Aviso del último intento cuando algunos archivos no cupieron. */
  readonly avisoCupo: string | null;
  readonly cupo: (tipo: TipoMedio) => number;
  readonly agregar: (archivos: readonly File[], tipo?: TipoMedio) => void;
  readonly reintentar: (id: string) => void;
  readonly descartar: (id: string) => void;
}

export function useSubidas(o: OpcionesSubidas): Subidas {
  const { api, almacen } = useApp();
  const [lista, setLista] = useState<readonly Subida[]>([]);
  const [avisoCupo, setAvisoCupo] = useState<string | null>(null);
  const ref = useRef<readonly Subida[]>([]);
  const archivos = useRef(new Map<string, File>());
  const revisados = useRef(new Set<string>());
  /** Hasta dónde llegó cada subida: con `subida` el original ya está en el servidor y solo falta esperar su procesamiento. */
  const etapas = useRef(new Map<string, 'subida'>());
  const abandonado = useRef(false);
  const opciones = useRef(o);
  opciones.current = o;

  // Al desmontar (el panel se cierra) las subidas en curso se abandonan: no se avisa a nadie ni se encolan guardados.
  useEffect(
    () => () => {
      abandonado.current = true;
      archivos.current.clear();
    },
    [],
  );

  const poner = useCallback((f: (s: readonly Subida[]) => readonly Subida[]): void => {
    ref.current = f(ref.current);
    setLista(ref.current);
  }, []);
  const cambiar = useCallback((id: string, c: Partial<Subida>): void => poner((s) => s.map((x) => (x.id === id ? { ...x, ...c } : x))), [poner]);

  const correr = useCallback(
    async (id: string): Promise<void> => {
      const archivo = archivos.current.get(id);
      const inicial = ref.current.find((x) => x.id === id);
      if (archivo === undefined || inicial === undefined) return;
      const tipo = inicial.tipo;
      let fase: FaseSubida = 'revisando';
      const ir = (f: FaseSubida, c: Partial<Subida> = {}): void => {
        fase = f;
        cambiar(id, { fase: f, ...c });
      };
      let reloj: ReturnType<typeof setInterval> | undefined;
      try {
        if (!revisados.current.has(id)) {
          ir('revisando');
          const falla = await validarArchivo(archivo, tipo);
          if (falla !== undefined) {
            ir('error', { motivo: falla, reintentable: false });
            return;
          }
          revisados.current.add(id);
        }
        if (etapas.current.get(id) !== 'subida') {
          ir('reservando');
          const r = await api.llamar('reservarSubida', { subidaId: id, productoId: opciones.current.productoId, tipo, bytes: archivo.size });
          if (abandonado.current) return;
          cambiar(id, { reservada: true });
          ir('subiendo', { progreso: 0 });
          await almacen.subir(r.rutaOriginal, archivo, (p) => {
            if (!abandonado.current) cambiar(id, { progreso: p });
          });
          if (abandonado.current) return;
          etapas.current.set(id, 'subida');
        }
        // El disparador de Storage procesa el original; el panel consulta el estado y solo fuerza el procesamiento como respaldo.
        const inicio = Date.now();
        ir('procesando', { segundos: 0 });
        reloj = setInterval(() => cambiar(id, { segundos: Math.round((Date.now() - inicio) / 1000) }), 1000);
        const medio = await esperarSubida(api, id, {
          esperar: async (ms) => {
            if (abandonado.current) throw new Error('subida abandonada');
            await new Promise<void>((r) => setTimeout(r, ms));
          },
        });
        if (abandonado.current) return;
        // Terminó: la fila deja de contar como «en curso» y se libera el archivo.
        archivos.current.delete(id);
        revisados.current.delete(id);
        etapas.current.delete(id);
        ir('listo', { medioId: medio.id, motivo: undefined });
        opciones.current.alListo(medio, archivo);
      } catch (e) {
        if (abandonado.current) return;
        cambiar(id, { fase: 'error', motivo: mensajeDeSubida(e), reintentable: esReintentable(e, fase) });
      } finally {
        if (reloj !== undefined) clearInterval(reloj);
      }
    },
    [api, almacen, cambiar],
  );

  const agregar = useCallback(
    (nuevos: readonly File[], forzado?: TipoMedio): void => {
      if (nuevos.length === 0) return;
      const avisos: string[] = [];
      for (const tipo of ['foto', 'video'] as const) {
        const deTipo = nuevos.filter((a) => (forzado ?? tipoDeArchivo(a)) === tipo);
        if (deTipo.length === 0) continue;
        const cupo = cupoLibre(tipo, opciones.current.medios, ref.current);
        const caben = deTipo.slice(0, cupo);
        const fuera = deTipo.length - caben.length;
        const maximo = tipo === 'foto' ? `${String(topeDe(tipo))} fotos` : '1 video';
        if (fuera > 0) {
          avisos.push(caben.length === 0 ? `No se subió ${nombreDe(tipo, fuera)}: el máximo es ${maximo} por producto y ya no queda lugar.` : `Se suben ${nombreDe(tipo, caben.length)} y ${nombreDe(tipo, fuera)} quedaron fuera: el máximo es ${maximo} por producto.`);
        }
        const ids = caben.map((a) => {
          const id = nuevoId();
          archivos.current.set(id, a);
          return { id, a };
        });
        poner((s) => [...s, ...ids.map(({ id, a }): Subida => ({ id, nombre: a.name, tipo, fase: 'revisando', progreso: 0, segundos: 0, motivo: undefined, reintentable: false, reservada: false, medioId: undefined }))]);
        for (const { id } of ids) void correr(id);
      }
      setAvisoCupo(avisos.length === 0 ? null : avisos.join(' '));
    },
    [correr, poner],
  );

  const reintentar = useCallback(
    (id: string): void => {
      const s = ref.current.find((x) => x.id === id);
      if (s === undefined || s.fase !== 'error' || !s.reintentable) return;
      cambiar(id, { fase: etapas.current.get(id) === 'subida' ? 'procesando' : 'reservando', motivo: undefined, reintentable: false });
      void correr(id);
    },
    [cambiar, correr],
  );

  const descartar = useCallback(
    (id: string): void => {
      archivos.current.delete(id);
      revisados.current.delete(id);
      etapas.current.delete(id);
      poner((s) => s.filter((x) => x.id !== id));
    },
    [poner],
  );

  return {
    subidas: lista,
    enCurso: lista.filter((s) => EN_CURSO.includes(s.fase)).length,
    avisoCupo,
    cupo: (tipo) => cupoLibre(tipo, o.medios, lista),
    agregar,
    reintentar,
    descartar,
  };
}
