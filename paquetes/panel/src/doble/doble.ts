import type { ClienteApi } from '../api/cliente.js';
import { ROLES_CALLABLE, type Entrada, type NombreCallable, type Salida } from '../api/contrato.js';
import { ErrorApi } from '../api/errores.js';
import type { Rol } from '../api/tipos.js';
import { crearEstado, fallo, type Contexto, type EstadoDoble } from './estado.js';
import { handlersInventario } from './inventario.js';
import { handlersOtros } from './otros.js';
import { handlersPos } from './pos.js';

type Manejador = (c: Contexto, e: never) => unknown;

const MANEJADORES = { ...handlersPos, ...handlersInventario, ...handlersOtros } as unknown as Record<NombreCallable, Manejador>;

export interface OpcionesDoble {
  /** Quién llama (uid y rol); en la app sale de la sesión. */
  readonly usuario: () => { readonly uid: string; readonly rol: Rol };
  readonly tenantId?: string;
  readonly ahora?: () => number;
  /** Retraso artificial por llamada, en ms (para ver estados de carga). */
  readonly retrasoMs?: number;
}

/**
 * Doble en memoria del servidor: aplica los permisos del contrato y reproduce las reglas de los módulos (turno, precios
 * recalculados, tope de descuento, aprobaciones de un solo uso, pagos, stock y series, idempotencia por `requestId` y
 * `operacionId`, anulaciones con reembolso por los medios originales, arqueo sin tope en cero). Sirve para desarrollar y
 * probar el panel sin Firebase; NO sustituye las pruebas de los módulos.
 */
export class ClienteDoble implements ClienteApi {
  readonly estado: EstadoDoble;
  llamadas: { nombre: NombreCallable; entrada: unknown }[] = [];
  private readonly ahora: () => number;

  constructor(private readonly o: OpcionesDoble) {
    this.ahora = o.ahora ?? ((): number => Date.now());
    this.estado = crearEstado(this.ahora());
  }

  async llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>> {
    if (this.o.retrasoMs !== undefined && this.o.retrasoMs > 0) await new Promise((r) => setTimeout(r, this.o.retrasoMs));
    this.llamadas.push({ nombre, entrada });
    const { uid, rol } = this.o.usuario();
    const h = MANEJADORES[nombre];
    if (!ROLES_CALLABLE[nombre].includes(rol)) throw new ErrorApi('permission-denied', 'Sin permiso', { codigo: 'no-autorizado' });
    const c: Contexto = { e: this.estado, uid, rol, ahora: this.ahora(), tenantId: this.o.tenantId ?? 'demo' };
    try {
      // Clon profundo de la entrada: el servidor nunca comparte objetos con el cliente.
      const copia = structuredClone(entrada);
      const r = await h(c, copia as never);
      return structuredClone(r) as Salida<N>;
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
      throw fallo('estado', e instanceof Error ? e.message : 'error');
    }
  }
}
