import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { nuevoId, type ClienteApi } from '../../api/cliente.js';
import { ErrorApi } from '../../api/errores.js';
import { BYTES_LOGO, type MedioLogo } from '../../api/tipos.js';
import { useApp } from '../../ui/contexto.js';
import { formatoBytes } from '../../util/base64.js';
import { ESPERA_INICIAL_MS, ESPERA_TOPE_MS, RESPALDO_TRAS_MS, esEnCurso, mensajeDeSubida, type OpcionesEspera } from './esperar.js';

/**
 * Subida del logo del negocio: revisando, reservando, subiendo, procesando y listo (o error). Un solo logo vigente: al
 * terminar, el servidor reemplaza el anterior. Igual que las fotos, «Reintentar» solo existe para fallas de red o de
 * subida (mismo `subidaId`); si el servidor rechaza el archivo se muestra su motivo y la persona elige otro.
 */

export type FaseLogo = 'reposo' | 'revisando' | 'reservando' | 'subiendo' | 'procesando' | 'listo' | 'error';

const MIME_LOGO: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_LOGO: readonly string[] = ['jpg', 'jpeg', 'png', 'webp'];
const MIME_GENERICOS: readonly string[] = ['', 'application/octet-stream'];
export const TEXTO_FORMATOS_LOGO = 'JPG, PNG o WebP';
export const ACEPTA_LOGO = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

/** Revisa el archivo antes de reservar: devuelve el motivo del rechazo o `undefined` si puede subirse (el servidor vuelve a validar). */
export function validarLogo(a: Pick<File, 'name' | 'size' | 'type'>): string | undefined {
  const ext = a.name.includes('.') ? (a.name.split('.').pop() ?? '').toLowerCase() : '';
  if (ext === 'svg' || a.type === 'image/svg+xml') return `«${a.name}» es un SVG y no se admite como logo. Formatos: ${TEXTO_FORMATOS_LOGO}.`;
  const mimeOk = MIME_LOGO.includes(a.type);
  const extOk = EXT_LOGO.includes(ext);
  if (!mimeOk && !(MIME_GENERICOS.includes(a.type) && extOk)) return `«${a.name}» no es un formato permitido para el logo. Formatos: ${TEXTO_FORMATOS_LOGO}.`;
  if (a.size <= 0) return `«${a.name}» está vacío.`;
  if (a.size > BYTES_LOGO) return `El logo «${a.name}» pesa ${formatoBytes(a.size)} y el máximo es ${formatoBytes(BYTES_LOGO)}.`;
  return undefined;
}

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Como `esperarSubida` de las fotos, con las acciones del logo: consulta el estado y, pasado el respaldo, finaliza una vez. */
export async function esperarSubidaLogo(api: ClienteApi, subidaId: string, o: OpcionesEspera = {}): Promise<MedioLogo> {
  const esperar = o.esperar ?? pausa;
  const ahora = o.ahora ?? ((): number => Date.now());
  const respaldoTrasMs = o.respaldoTrasMs ?? RESPALDO_TRAS_MS;
  const inicio = ahora();
  let espera = ESPERA_INICIAL_MS;
  let respaldoHecho = false;
  for (;;) {
    try {
      const r = await api.llamar('estadoSubidaLogo', { subidaId });
      if (r.estado === 'procesada' && r.medio !== undefined) return r.medio;
      if (r.estado === 'rechazada') throw new ErrorApi('failed-precondition', r.motivo ?? '', { codigo: 'procesamiento' });
      if (r.estado === 'borrando') throw new ErrorApi('failed-precondition', '', { codigo: 'estado' });
    } catch (e) {
      const transitorio = e instanceof ErrorApi && (e.codigoHttps === 'unavailable' || e.codigoHttps === 'deadline-exceeded');
      if (!transitorio) throw e;
    }
    if (!respaldoHecho && ahora() - inicio >= respaldoTrasMs) {
      respaldoHecho = true;
      try {
        return await api.llamar('finalizarSubidaLogo', { subidaId });
      } catch (e) {
        if (!esEnCurso(e)) throw e;
      }
    }
    await esperar(espera);
    espera = Math.min(Math.round(espera * 1.5), ESPERA_TOPE_MS);
  }
}

function esReintentable(e: unknown, fase: FaseLogo): boolean {
  if (fase === 'subiendo') return true;
  if (!(e instanceof ErrorApi)) return true;
  return e.codigoHttps === 'unavailable' || e.codigoHttps === 'deadline-exceeded' || e.detalle.codigo === 'no-disponible';
}

export interface EstadoSubidaLogo {
  readonly fase: FaseLogo;
  readonly nombre: string;
  /** 0 a 100, en la fase `subiendo`. */
  readonly progreso: number;
  /** Segundos transcurridos en la fase `procesando`. */
  readonly segundos: number;
  readonly motivo: string | undefined;
  readonly reintentable: boolean;
}

const REPOSO: EstadoSubidaLogo = { fase: 'reposo', nombre: '', progreso: 0, segundos: 0, motivo: undefined, reintentable: false };
const EN_CURSO: readonly FaseLogo[] = ['revisando', 'reservando', 'subiendo', 'procesando'];

export interface SubidaLogo extends EstadoSubidaLogo {
  readonly enCurso: boolean;
  readonly elegir: (archivo: File) => void;
  readonly reintentar: () => void;
  readonly descartar: () => void;
}

export function useSubidaLogo(alListo: (medio: MedioLogo) => void): SubidaLogo {
  const { api, almacen } = useApp();
  const [estado, setEstado] = useState<EstadoSubidaLogo>(REPOSO);
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

  const cambiar = useCallback((c: Partial<EstadoSubidaLogo>): void => setEstado((s) => ({ ...s, ...c })), []);

  const correr = useCallback(async (): Promise<void> => {
    const a = archivo.current;
    if (a === null) return;
    const id = subidaId.current;
    let fase: FaseLogo = 'revisando';
    const ir = (f: FaseLogo, c: Partial<EstadoSubidaLogo> = {}): void => {
      fase = f;
      cambiar({ fase: f, ...c });
    };
    let reloj: ReturnType<typeof setInterval> | undefined;
    try {
      if (!subido.current) {
        ir('reservando');
        const r = await api.llamar('reservarSubidaLogo', { subidaId: id, bytes: a.size });
        if (abandonado.current) return;
        ir('subiendo', { progreso: 0 });
        await almacen.subir(r.rutaOriginal, a, (p) => {
          if (!abandonado.current) cambiar({ progreso: p });
        });
        if (abandonado.current) return;
        subido.current = true;
      }
      const inicio = Date.now();
      ir('procesando', { segundos: 0 });
      reloj = setInterval(() => cambiar({ segundos: Math.round((Date.now() - inicio) / 1000) }), 1000);
      const medio = await esperarSubidaLogo(api, id, {
        esperar: async (ms) => {
          if (abandonado.current) throw new Error('subida abandonada');
          await pausa(ms);
        },
      });
      if (abandonado.current) return;
      archivo.current = null;
      ir('listo', { motivo: undefined });
      alListoRef.current(medio);
    } catch (e) {
      if (abandonado.current) return;
      cambiar({ fase: 'error', motivo: mensajeDeSubida(e), reintentable: esReintentable(e, fase) });
    } finally {
      if (reloj !== undefined) clearInterval(reloj);
    }
  }, [api, almacen, cambiar]);

  const elegir = useCallback(
    (a: File): void => {
      if (EN_CURSO.includes(estado.fase)) return;
      const falla = validarLogo(a);
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
