import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Entrada, NombreCallable, Salida } from './contrato.js';
import type { ClienteApi } from './cliente.js';
import { ErrorApi, type DetalleError } from './errores.js';

/**
 * Cliente real: una `httpsCallable` por nombre del contrato, región us-east1. Agrega `tenantId` a toda entrada.
 * La app de Firebase ya fue inicializada por `SesionFirebase`.
 */
export class ClienteFirebase implements ClienteApi {
  constructor(
    private readonly tenantId: () => string,
    private readonly region: string = 'us-east1',
  ) {}

  async llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>> {
    const fn = httpsCallable<unknown, Salida<N>>(getFunctions(getApp(), this.region), nombre);
    try {
      const r = await fn({ tenantId: this.tenantId(), ...entrada });
      return r.data;
    } catch (e) {
      const o = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; details?: unknown };
      const codigo = typeof o.code === 'string' ? o.code.replace(/^functions\//, '') : 'internal';
      const detalle = typeof o.details === 'object' && o.details !== null ? (o.details as DetalleError) : {};
      throw new ErrorApi(codigo, `Falló ${nombre}`, detalle);
    }
  }
}
