import type { MotivoStockCambiado, Resumen, Rol, TransaccionIdentidad } from '@novutienda/nucleo';
import { aplicarPlan, type Contexto } from './aplicar.js';
import { EntradaInvalida, OperacionConflicto, SinPermiso } from './errores.js';
import { hashCarga } from './hash.js';
import { exigirSegmento, exigirTenant } from './ids.js';
import { Lector, Trabajo, type Autor, type Datos, type Referencia } from './motor.js';

const ROLES: readonly Rol[] = ['caj', 'sup', 'adm'];
export const TODOS: readonly Rol[] = ['caj', 'sup', 'adm'];
export const SUPERVISION: readonly Rol[] = ['sup', 'adm'];
export const SOLO_ADM: readonly Rol[] = ['adm'];

/** Permisos por operación. Es la única tabla: cambiar un permiso se hace aquí. */
export const PERMISOS = {
  ingreso: SUPERVISION,
  traspaso: SUPERVISION,
  ajuste: SOLO_ADM,
  mermaSolicitar: TODOS,
  mermaResolver: SUPERVISION,
  conteoAbrir: SUPERVISION,
  conteoRegistrar: TODOS,
  conteoCerrar: SUPERVISION,
  producto: SOLO_ADM,
  ubicacion: SOLO_ADM,
  importacion: SOLO_ADM,
} as const;

export function exigirAutor(por: unknown): Autor {
  const p = por as Partial<Autor> | null | undefined;
  if (typeof p?.uid !== 'string' || p.uid.trim() === '' || !ROLES.includes(p.rol as Rol)) {
    throw new EntradaInvalida('autor inválido (uid y rol requeridos)');
  }
  return { uid: p.uid, rol: p.rol as Rol };
}

export function exigirMotivo(x: unknown): string {
  if (typeof x !== 'string' || x.trim() === '' || x.length > 500) throw new EntradaInvalida('motivo obligatorio');
  return x;
}

export interface ResultadoOperacion<R> {
  readonly resultado: R;
  /** `true` si ya existía con el mismo contenido: no se escribió nada. */
  readonly repetida: boolean;
}

export interface Construido {
  readonly trabajo: Trabajo;
  readonly resultado: Datos;
  readonly referencia: Referencia;
  readonly tipoMovimiento: MotivoStockCambiado;
  readonly motivo?: string;
  /** Resumen de la auditoría (valores simples, sin datos personales). */
  readonly resumen?: Resumen;
}

export interface EspecOperacion {
  readonly tenantId: string;
  readonly operacionId: string;
  readonly tipo: string;
  readonly accion: string;
  /** Contenido que define la identidad de la operación (para el hash). */
  readonly carga: unknown;
  readonly por: Autor;
  readonly roles: readonly Rol[];
  /** Solo lecturas y cálculo en memoria. Si lanza, no se escribe nada. */
  construir(trabajo: Trabajo): Promise<Omit<Construido, 'trabajo'>>;
}

/**
 * Plantilla de toda operación: permiso, idempotencia por `operacionId` + hash, todas las
 * lecturas antes de escribir, y una sola tanda de escrituras (movimientos con `create`).
 */
export async function ejecutarOperacion(
  tx: TransaccionIdentidad,
  e: EspecOperacion,
): Promise<ResultadoOperacion<Datos>> {
  exigirTenant(e.tenantId);
  exigirSegmento(e.operacionId, 'operacionId');
  if (!e.roles.includes(e.por.rol)) throw new SinPermiso(`El rol ${e.por.rol} no puede ejecutar ${e.tipo}`);
  const lector = new Lector(tx, e.tenantId);
  const hash = hashCarga(e.tipo, e.carga);
  const previa = await lector.leer('operaciones', e.operacionId);
  if (previa !== undefined) {
    if (previa['hashCarga'] !== hash) throw new OperacionConflicto(e.operacionId);
    return { resultado: (previa['resultado'] ?? {}) as Datos, repetida: true };
  }
  const trabajo = new Trabajo(lector);
  const c = await e.construir(trabajo);
  const ctx: Contexto = {
    operacionId: e.operacionId,
    tipoOperacion: e.tipo,
    accion: e.accion,
    referencia: c.referencia,
    tipoMovimiento: c.tipoMovimiento,
    por: e.por,
    hashCarga: hash,
    resultado: c.resultado,
    ...(c.motivo !== undefined ? { motivo: c.motivo } : {}),
    ...(c.resumen !== undefined ? { resumen: c.resumen } : {}),
  };
  aplicarPlan(tx, trabajo.plan(), ctx);
  return { resultado: c.resultado, repetida: false };
}

/** Líneas comunes de entrada de ingreso/traspaso/merma/ajuste. */
export function exigirListaLineas(x: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(x) || x.length < 1 || x.length > max) throw new EntradaInvalida(`lineas debe tener entre 1 y ${max} elementos`);
  return x;
}
