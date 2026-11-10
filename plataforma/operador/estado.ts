// Ciclo de vida de un tenant (activo <-> suspendido, y baja terminal). Lo ejecuta solo el operador.
// Lógica pura: la base, el almacén de miembros y Auth llegan por inyección; aquí no hay red. Los mensajes no llevan identificadores.
import { esEstadoTenant, esTenantIdValido, registrarAuditoria, transicionValida } from '@novutienda/nucleo';
import type { EstadoTenant, TransaccionAuditoria } from '@novutienda/nucleo';
import { operadorDe } from './personal.js';

/** Transacción mínima: lectura, actualización de un documento y auditoría en la misma transacción. */
export interface TransaccionEstado extends TransaccionAuditoria {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  update(ruta: string, datos: Readonly<Record<string, unknown>>): void;
}
export interface BaseDatosEstado {
  runTransaction<T>(fn: (tx: TransaccionEstado) => Promise<T>): Promise<T>;
}
export interface AuthEstado {
  revokeRefreshTokens(uid: string): Promise<void>;
}
export interface AlmacenMiembros {
  /** Uids de `tenants/{t}/miembros`. */
  listarMiembros(tenantId: string): Promise<readonly string[]>;
}

export interface ResultadoEstado {
  readonly de: EstadoTenant;
  readonly a: EstadoTenant;
  readonly aplicado: boolean;
  /** Sesiones revocadas (solo al pasar a suspendido o baja). */
  readonly revocados: number;
  /** Líneas legibles sin identificadores. */
  readonly diferencias: readonly string[];
}

/**
 * Cambia el estado de `tenants/{t}`. Sin `aplicar` solo informa. Reglas: el documento debe existir con estado válido;
 * `baja` es terminal (`transicionValida`) y exige `confirmacion` igual al id; si ya está en el estado pedido no escribe
 * (activo -> activo no hace nada; suspendido o baja con `aplicar` repite la revocación, para poder reintentar).
 * Con `aplicar`: 1) en una transacción actualiza el estado y audita (`tenant.estado`); 2) al pasar a suspendido o baja,
 * revoca los refresh tokens de los miembros. Si la revocación falla en alguien, el estado ya quedó escrito y se lanza
 * un error con el conteo para reintentar el mismo comando.
 * Efecto real: las reglas de Firestore rechazan de inmediato (leen el estado); los callables y HTTP, hasta 60 s después
 * por la caché positiva del estado; la reactivación tarda hasta 10 s por la caché negativa. Revocar refresh tokens NO
 * invalida el ID token vigente (hasta 1 h): el control efectivo es la lectura del estado, no la revocación.
 * `operador` es la cuenta sin envolver; aquí se envuelve una sola vez con `operadorDe`.
 */
export async function cambiarEstado(o: {
  readonly tenantId: string;
  readonly a: EstadoTenant;
  readonly db: BaseDatosEstado;
  readonly miembros: AlmacenMiembros;
  readonly auth: AuthEstado;
  readonly operador: string;
  readonly aplicar: boolean;
  readonly confirmacion?: string;
}): Promise<ResultadoEstado> {
  if (!esTenantIdValido(o.tenantId)) throw new Error('el tenant no es un identificador válido');
  if (!esEstadoTenant(o.a)) throw new Error('estado destino desconocido');
  const operador = operadorDe(o.operador);
  const ruta = `tenants/${o.tenantId}`;
  const leerActual = async (tx: TransaccionEstado): Promise<EstadoTenant> => {
    const doc = await tx.get(ruta);
    if (!doc.existe) throw new Error('el tenant no existe');
    const estado = doc.data()?.['estado'];
    if (!esEstadoTenant(estado)) throw new Error('el tenant no tiene un estado válido: corra el alta antes');
    return estado;
  };
  const de = await o.db.runTransaction(leerActual);
  const revocar = async (): Promise<number> => {
    let revocados = 0;
    const uids = await o.miembros.listarMiembros(o.tenantId);
    let fallidos = 0;
    for (const uid of uids) {
      try {
        await o.auth.revokeRefreshTokens(uid);
        revocados += 1;
      } catch {
        fallidos += 1;
      }
    }
    if (fallidos > 0) throw new Error(`estado escrito, pero falló la revocación de ${String(fallidos)} de ${String(uids.length)} sesiones: reintente`);
    return revocados;
  };
  if (de === o.a) {
    // Reintento idempotente: si una corrida previa escribió el estado y falló al revocar, se revoca de nuevo.
    if (!o.aplicar || o.a === 'activo') return { de, a: o.a, aplicado: false, revocados: 0, diferencias: [] };
    return { de, a: o.a, aplicado: true, revocados: await revocar(), diferencias: [] };
  }
  if (!transicionValida(de, o.a)) throw new Error(`transición no permitida: ${de} -> ${o.a}`);
  const diferencias = [`estado: ${de} -> ${o.a}`];
  if (o.a === 'baja' && o.confirmacion !== o.tenantId) throw new Error('la baja exige confirmar el id del tenant (--confirmar-baja <tenant>)');
  if (!o.aplicar) return { de, a: o.a, aplicado: false, revocados: 0, diferencias };

  await o.db.runTransaction(async (tx) => {
    // Se relee dentro de la transacción: si el estado cambió entre la lectura y la escritura, se aborta.
    if ((await leerActual(tx)) !== de) throw new Error('el estado cambió durante la operación: reintente');
    tx.update(ruta, { estado: o.a });
    registrarAuditoria(tx, {
      tenantId: o.tenantId,
      uid: operador,
      // El núcleo exige un rol del conjunto de roles de un tenant y el operador no tiene ninguno: 'adm' es solo el valor
      // admitido por `registrarAuditoria`; quién actuó lo dice `uid` (`operador:<cuenta>`) y `motivo`.
      rol: 'adm',
      motivo: 'operador de plataforma',
      accion: 'tenant.estado',
      ruta,
      resumenAntes: { estado: de },
      resumenDespues: { estado: o.a },
    });
  });

  const revocados = o.a !== 'activo' ? await revocar() : 0;
  return { de, a: o.a, aplicado: true, revocados, diferencias };
}
