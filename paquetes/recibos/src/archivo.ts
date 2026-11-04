import { ErrorRecibo } from './errores.js';
import type { Recibo } from './tipos.js';

export interface FiltroLectura {
  readonly numero?: string;
  readonly desde?: string;
  readonly hasta?: string;
}

/**
 * Lectura mínima inyectable: el adaptador de Firestore resuelve las consultas
 * indexadas por número y por fecha; la búsqueda por cliente se completa aquí.
 */
export interface LecturaRecibos {
  consultar(tenantId: string, filtro: FiltroLectura): Promise<readonly Recibo[]>;
}

export interface ConsultaArchivo {
  /** Número exacto (A-000123) o fragmento. */
  readonly numero?: string;
  /** Fecha aaaa-mm-dd inclusive. */
  readonly desde?: string;
  readonly hasta?: string;
  /** Fragmento del nombre del cliente, sin distinguir mayúsculas ni tildes. */
  readonly cliente?: string;
  readonly limite?: number;
}

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Busca comprobantes por número, fecha o cliente. Pura sobre `LecturaRecibos`:
 * descarta cualquier documento de otro tenant, reaplica todos los filtros, ordena
 * del más reciente al más antiguo y acota el resultado. Los anulados se incluyen.
 */
export async function buscarComprobantes(lectura: LecturaRecibos, tenantId: string, consulta: ConsultaArchivo): Promise<Recibo[]> {
  for (const f of [consulta.desde, consulta.hasta]) {
    if (f !== undefined && !FECHA.test(f)) throw new ErrorRecibo('Las fechas deben tener la forma aaaa-mm-dd');
  }
  const limite = consulta.limite ?? LIMITE_POR_DEFECTO;
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) throw new ErrorRecibo(`limite debe estar entre 1 y ${String(LIMITE_MAXIMO)}`);
  const numero = consulta.numero === undefined ? undefined : normalizar(consulta.numero);
  const cliente = consulta.cliente === undefined ? undefined : normalizar(consulta.cliente);
  const filtro: FiltroLectura = {
    ...(consulta.numero !== undefined && { numero: consulta.numero }),
    ...(consulta.desde !== undefined && { desde: consulta.desde }),
    ...(consulta.hasta !== undefined && { hasta: consulta.hasta }),
  };
  const candidatos = await lectura.consultar(tenantId, filtro);
  return candidatos
    .filter((r) => r.tenantId === tenantId)
    .filter((r) => numero === undefined || normalizar(r.numero).includes(numero))
    .filter((r) => consulta.desde === undefined || r.fecha >= consulta.desde)
    .filter((r) => consulta.hasta === undefined || r.fecha <= consulta.hasta)
    .filter((r) => cliente === undefined || (r.cliente !== undefined && normalizar(r.cliente.nombre).includes(cliente)))
    .sort((a, b) => b.emitidoEn.localeCompare(a.emitidoEn) || b.numero.localeCompare(a.numero))
    .slice(0, limite);
}
