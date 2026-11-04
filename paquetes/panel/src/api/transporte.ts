import type { ClienteApi } from './cliente.js';
import type { Entrada, NombreCallable, Salida } from './contrato.js';
import { ErrorApi } from './errores.js';
import { esPropuesta, TRADUCCION, type ContextoReal, type Modulo, type Traduccion } from './real.js';
import type { Rol } from './tipos.js';

/** Sobre estricto del servidor: `{ accion, tenantId, datos }` (docs/produccion/funciones.md §2). */
export interface Sobre {
  readonly accion: string;
  readonly tenantId: string;
  readonly datos?: object;
}

/** Una llamada al callable del módulo. Lanza `ErrorApi` si el servidor responde con un `HttpsError`. */
export interface Transporte {
  invocar(modulo: Modulo, sobre: Sobre): Promise<unknown>;
}

export interface OpcionesRemoto {
  /** El cliente real no llama a las acciones que el servidor aún no tiene; el doble sí. */
  readonly permitirPropuestas: boolean;
}

/**
 * Cliente del panel sobre el contrato real: traduce cada operación (`real.ts`) a llamadas `{ accion, tenantId, datos }`
 * y las envía por el transporte (Firebase Functions en producción, el servidor doble en pruebas).
 */
export class ClienteRemoto implements ClienteApi {
  constructor(
    private readonly transporte: Transporte,
    private readonly contexto: () => { readonly tenantId: string; readonly rol: Rol | undefined },
    private readonly opciones: OpcionesRemoto,
  ) {}

  async llamar<N extends NombreCallable>(nombre: N, entrada: Entrada<N>): Promise<Salida<N>> {
    const t = TRADUCCION[nombre] as unknown as Traduccion<N>;
    const { tenantId, rol } = this.contexto();
    const c: ContextoReal = {
      rol,
      llamar: (modulo, accion, datos) => {
        if (!this.opciones.permitirPropuestas && esPropuesta(modulo, accion)) {
          throw new ErrorApi('unavailable', `Acción pendiente en el servidor: ${modulo}.${accion}`, { codigo: 'no-disponible' });
        }
        return this.transporte.invocar(modulo, { accion, tenantId, ...(datos !== undefined ? { datos } : {}) });
      },
    };
    return t.ejecutar(c, entrada);
  }
}
