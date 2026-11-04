import type { ClienteApi } from '../api/cliente.js';
import { ROLES_CALLABLE, type Entrada, type NombreCallable, type Salida } from '../api/contrato.js';
import { ErrorApi } from '../api/errores.js';
import { ClienteRemoto } from '../api/transporte.js';
import type { Rol } from '../api/tipos.js';
import { crearEstado, type Contexto, type EstadoDoble } from './estado.js';
import { TransporteDoble } from './transporte.js';

export interface OpcionesDoble {
  /** Quién llama (uid y rol); en la app sale de la sesión. */
  readonly usuario: () => { readonly uid: string; readonly rol: Rol };
  readonly tenantId?: string;
  readonly ahora?: () => number;
  /** Retraso artificial por llamada, en ms (para ver estados de carga). */
  readonly retrasoMs?: number;
}

/**
 * Doble en memoria del servidor: es un `ClienteRemoto` (la misma traducción que el cliente real, `api/real.ts`) sobre un
 * `TransporteDoble` que atiende `{ accion, tenantId, datos }` por módulo con las reglas de los módulos (turno, precios
 * recalculados, tope de descuento, aprobaciones de un solo uso, pagos, stock y series, idempotencia por `requestId` y
 * `operacionId`, anulaciones con reembolso por los medios originales, arqueo sin tope en cero). Sirve para desarrollar y
 * probar el panel sin Firebase; NO sustituye las pruebas de los módulos ni las del emulador.
 */
export class ClienteDoble implements ClienteApi {
  readonly estado: EstadoDoble;
  /** Operaciones del panel pedidas (`llamar`). */
  llamadas: { nombre: NombreCallable; entrada: unknown }[] = [];
  readonly transporte: TransporteDoble;
  private readonly remoto: ClienteRemoto;
  private readonly ahora: () => number;

  constructor(private readonly o: OpcionesDoble) {
    this.ahora = o.ahora ?? ((): number => Date.now());
    this.estado = crearEstado(this.ahora());
    const tenantId = o.tenantId ?? 'demo';
    const contexto = (): Contexto => {
      const { uid, rol } = this.o.usuario();
      return { e: this.estado, uid, rol, ahora: this.ahora(), tenantId };
    };
    this.transporte = new TransporteDoble({ contexto, ...(o.retrasoMs !== undefined ? { retrasoMs: o.retrasoMs } : {}) });
    this.remoto = new ClienteRemoto(this.transporte, () => ({ tenantId, rol: this.o.usuario().rol }), { permitirPropuestas: true });
  }

  async llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>> {
    this.llamadas.push({ nombre, entrada });
    const { rol } = this.o.usuario();
    if (!ROLES_CALLABLE[nombre].includes(rol)) throw new ErrorApi('permission-denied', 'Sin permiso', { codigo: 'no-autorizado' });
    return this.remoto.llamar(nombre, entrada);
  }
}
