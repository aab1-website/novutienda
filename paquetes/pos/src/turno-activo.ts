import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { leerObligatorio, rutaTurno, rutaTurnoActivo } from './contexto.js';
import { ErrorPos } from './errores.js';
import { leerTurno, textoDe } from './lectura.js';
import type { TurnoPos } from './tipos.js';

/** Turno abierto vigente (puntero `pos_config/turno_activo`), leído dentro de la transacción. */
export async function leerTurnoAbierto(tx: TransaccionIdentidad, tenantId: string, declaradas?: readonly string[]): Promise<{ turno: TurnoPos; raw: Readonly<Record<string, unknown>> } | undefined> {
  const activo = await leerObligatorio(tx, rutaTurnoActivo(tenantId));
  if (activo === undefined) return undefined;
  const raw = await leerObligatorio(tx, rutaTurno(tenantId, textoDe(activo, 'turnoId')));
  if (raw === undefined) throw new ErrorPos('dato-corrupto', 'El turno activo no existe');
  const turno = leerTurno(raw, declaradas);
  if (turno.estado !== 'abierto') throw new ErrorPos('dato-corrupto', 'El turno activo no está abierto');
  return { turno, raw };
}
