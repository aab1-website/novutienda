import type { ClienteApi } from '../api/cliente.js';
import { ErrorApi } from '../api/errores.js';
import type { Medio } from '../api/tipos.js';

/** Primera espera entre consultas de `estadoSubida` (crece 1,5 veces por consulta hasta `ESPERA_TOPE_MS`). */
export const ESPERA_INICIAL_MS = 200;
export const ESPERA_TOPE_MS = 5000;
/** Si pasado este tiempo el disparador de Storage no resolvió la subida, se llama a `finalizarSubida` como respaldo. */
export const RESPALDO_TRAS_MS = 30_000;

export interface OpcionesEspera {
  /** Inyectable en las pruebas. */
  readonly esperar?: (ms: number) => Promise<void>;
  readonly ahora?: () => number;
  readonly respaldoTrasMs?: number;
}

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a que el disparador de Storage procese el original subido. Consulta `estadoSubida` (que no procesa nada, así el
 * original no se procesa dos veces) con retroceso hasta que la subida queda `procesada` (devuelve el medio) o `rechazada`
 * (lanza el error del procesamiento). Si tras `respaldoTrasMs` sigue pendiente, llama una sola vez a `finalizarSubida`,
 * que es idempotente y tiene su propia espera de hasta ~2 minutos para videos largos. Los cortes de red o de tiempo de
 * una consulta no interrumpen la espera.
 */
export async function esperarSubida(api: ClienteApi, subidaId: string, o: OpcionesEspera = {}): Promise<Medio> {
  const esperar = o.esperar ?? pausa;
  const ahora = o.ahora ?? ((): number => Date.now());
  const respaldoTrasMs = o.respaldoTrasMs ?? RESPALDO_TRAS_MS;
  const inicio = ahora();
  let espera = ESPERA_INICIAL_MS;
  for (;;) {
    try {
      const r = await api.llamar('estadoSubida', { subidaId });
      if (r.estado === 'procesada' && r.medio !== undefined) return r.medio;
      if (r.estado === 'rechazada') throw new ErrorApi('failed-precondition', r.motivo ?? '', { codigo: 'procesamiento' });
      if (r.estado === 'borrando') throw new ErrorApi('failed-precondition', '', { codigo: 'estado' });
    } catch (e) {
      const transitorio = e instanceof ErrorApi && (e.codigoHttps === 'unavailable' || e.codigoHttps === 'deadline-exceeded');
      if (!transitorio) throw e;
    }
    if (ahora() - inicio >= respaldoTrasMs) return api.llamar('finalizarSubida', { subidaId });
    await esperar(espera);
    espera = Math.min(Math.round(espera * 1.5), ESPERA_TOPE_MS);
  }
}
