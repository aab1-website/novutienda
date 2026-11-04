import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ErrorApi, type DetalleError } from './errores.js';
import type { Modulo } from './real.js';
import type { Sobre, Transporte } from './transporte.js';

/**
 * Transporte real: una `httpsCallable` por módulo (región us-east1) con `{ accion, tenantId, datos }`.
 * La app de Firebase ya fue inicializada por `SesionFirebase`. El `HttpsError` del servidor se conserva: `code`
 * (sin el prefijo `functions/`), `message` (apto para el usuario en los errores tipados) y `details`.
 */
export class TransporteFirebase implements Transporte {
  constructor(private readonly region: string = 'us-east1') {}

  async invocar(modulo: Modulo, sobre: Sobre): Promise<unknown> {
    const fn = httpsCallable<Sobre, unknown>(getFunctions(getApp(), this.region), modulo);
    try {
      return (await fn(sobre)).data;
    } catch (e) {
      const o = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown; details?: unknown };
      const codigo = typeof o.code === 'string' ? o.code.replace(/^functions\//, '') : 'internal';
      const detalle = typeof o.details === 'object' && o.details !== null ? (o.details as DetalleError) : {};
      throw new ErrorApi(codigo, typeof o.message === 'string' ? o.message : 'Error', detalle);
    }
  }
}
