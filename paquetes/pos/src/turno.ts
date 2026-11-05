import { abrirCaja, cerrarCaja, type DatosTurnoCerradoV1, type Moneda, type TransaccionIdentidad } from '@novutienda/nucleo';
import { calcularArqueo } from './arqueo.js';
import {
  ahoraDe, auditar, exigirActor, exigirCentavos, exigirRol, exigirTenant, exigirTexto, exigirUuid, leerObligatorio, publicar,
  rutaTurno, rutaTurnoActivo, type DepsPos,
} from './contexto.js';
import { ErrorPos } from './errores.js';
import { leerTurno, textoDe } from './lectura.js';
import { CAJA_UNICA, MONEDAS_POS, type ActorPos, type MontosPorMoneda, type TurnoPos } from './tipos.js';

/** Valida un objeto de montos por moneda (apertura o conteo): solo BOB, USD, ARS, centavos enteros no negativos. */
export function validarMontosPorMoneda(x: unknown, nombre: string, exigirAlguna: boolean): MontosPorMoneda {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new ErrorPos('entrada-invalida', `${nombre} debe indicar los montos por moneda`);
  const r: Partial<Record<Moneda, number>> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!MONEDAS_POS.includes(k as Moneda)) throw new ErrorPos('entrada-invalida', `${nombre}: moneda desconocida «${k}»`);
    r[k as Moneda] = exigirCentavos(v, `${nombre}.${k}`);
  }
  if (exigirAlguna && Object.keys(r).length === 0) throw new ErrorPos('entrada-invalida', `${nombre} necesita al menos una moneda`);
  return r;
}

/**
 * Abre un turno (idempotente por `turnoId`, un UUID del cliente). Reserva el cupo de caja del núcleo
 * en la misma transacción: con la caja ocupada lanza `LimiteDelPlan`.
 */
export async function abrirTurno(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  turnoIdEntrada: string,
  aperturaEntrada: unknown,
): Promise<TurnoPos> {
  exigirTenant(tenantId);
  exigirActor(actor);
  const turnoId = exigirUuid(turnoIdEntrada, 'turnoId');
  const apertura = validarMontosPorMoneda(aperturaEntrada, 'apertura', true);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx) => {
    const previo = await leerObligatorio(tx, rutaTurno(tenantId, turnoId));
    if (previo !== undefined) {
      if (textoDe(previo, 'cajeroUid') !== actor.uid) throw new ErrorPos('request-en-uso', 'Ese identificador de turno ya se usó');
      return leerTurno(previo);
    }
    if ((await tx.get(rutaTurnoActivo(tenantId))).existe) throw new ErrorPos('turno-ya-abierto', 'Ya hay un turno abierto en la caja');
    await abrirCaja(tx, tenantId);
    const turno: TurnoPos = {
      turnoId,
      cajaId: CAJA_UNICA,
      cajeroUid: actor.uid,
      estado: 'abierto',
      apertura,
      totales: {},
      abiertoEnMs: ahora,
    };
    tx.set(rutaTurno(tenantId, turnoId), { ...turno, creadoEn: tx.marcaTiempoServidor() });
    tx.set(rutaTurnoActivo(tenantId), { turnoId, cajeroUid: actor.uid });
    auditar(tx, tenantId, actor, {
      accion: 'pos.turno.abrir',
      ruta: rutaTurno(tenantId, turnoId),
      despues: { turnoId, monedas: Object.keys(apertura) },
    });
    return turno;
  });
}

interface OpcionesCierre {
  readonly forzado: boolean;
  readonly motivo?: string;
}

async function cerrar(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  turnoId: string,
  contadoEntrada: unknown,
  opc: OpcionesCierre,
): Promise<{ turno: TurnoPos; arqueo: DatosTurnoCerradoV1['monedas'] }> {
  const contado = validarMontosPorMoneda(contadoEntrada, 'contado', false);
  const ahora = ahoraDe(deps);
  return deps.db.runTransaction(async (tx: TransaccionIdentidad) => {
    const raw = await leerObligatorio(tx, rutaTurno(tenantId, turnoId));
    if (raw === undefined) throw new ErrorPos('sin-turno', 'El turno no existe');
    const turno = leerTurno(raw);
    // Solo se cierra un turno abierto: un doble cierre liberaría el cupo de la caja de otro turno.
    if (turno.estado !== 'abierto') throw new ErrorPos('turno-no-abierto', 'El turno ya está cerrado');
    if (!opc.forzado && turno.cajeroUid !== actor.uid) throw new ErrorPos('turno-ajeno', 'Solo quien abrió el turno puede cerrarlo');
    const activo = await leerObligatorio(tx, rutaTurnoActivo(tenantId));
    const arqueo = calcularArqueo(turno, contado);
    await cerrarCaja(tx, tenantId);
    const esperado: Partial<Record<Moneda, number>> = {};
    const contadoFinal: Partial<Record<Moneda, number>> = {};
    const diferencia: Partial<Record<Moneda, number>> = {};
    for (const [m, a] of Object.entries(arqueo) as [Moneda, (typeof arqueo)[Moneda] & object][]) {
      esperado[m] = a.esperado;
      contadoFinal[m] = a.contado;
      diferencia[m] = a.diferencia;
    }
    const estado = opc.forzado ? 'cerrado_forzado' : 'cerrado';
    const cerrado: TurnoPos = {
      ...turno,
      estado,
      cerradoEnMs: ahora,
      cerradoPor: actor.uid,
      ...(opc.motivo !== undefined ? { motivoCierre: opc.motivo } : {}),
      contado: contadoFinal,
      esperado,
      diferencia,
    };
    tx.set(rutaTurno(tenantId, turnoId), { ...raw, ...cerrado });
    if (activo !== undefined && activo['turnoId'] === turnoId) tx.delete(rutaTurnoActivo(tenantId));
    publicar(tx, {
      tenantId,
      tipo: 'turno.cerrado',
      clave: `turno-cerrado.${turnoId}`,
      ocurridoEnMs: ahora,
      datos: { turnoId, cajaId: turno.cajaId, cajeroUid: turno.cajeroUid, monedas: arqueo },
    });
    auditar(tx, tenantId, actor, {
      accion: opc.forzado ? 'pos.turno.cerrar_forzado' : 'pos.turno.cerrar',
      ruta: rutaTurno(tenantId, turnoId),
      despues: { turnoId, estado, diferencia: { ...diferencia } },
      ...(opc.motivo !== undefined ? { motivo: opc.motivo } : {}),
    });
    return { turno: cerrado, arqueo };
  });
}

/** Cierre normal: lo hace quien abrió el turno, con el conteo de efectivo por moneda. Publica `turno.cerrado`. */
export async function cerrarTurno(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  turnoId: string,
  contado: unknown,
) {
  exigirTenant(tenantId);
  exigirActor(actor);
  return cerrar(deps, tenantId, actor, exigirUuid(turnoId, 'turnoId'), contado, { forzado: false });
}

/** Cierre forzado (solo `adm`, con motivo): misma fórmula de arqueo que el cierre normal. */
export async function cerrarTurnoForzado(
  deps: DepsPos,
  tenantId: string,
  actor: ActorPos,
  turnoId: string,
  contado: unknown,
  motivo: string,
) {
  exigirTenant(tenantId);
  exigirActor(actor);
  exigirRol(actor, ['adm'], 'forzar el cierre de un turno');
  return cerrar(deps, tenantId, actor, exigirUuid(turnoId, 'turnoId'), contado, { forzado: true, motivo: exigirTexto(motivo, 'motivo') });
}

/** Turno abierto vigente (puntero `pos_config/turno_activo`), leído dentro de la transacción. */
export async function leerTurnoAbierto(tx: TransaccionIdentidad, tenantId: string): Promise<{ turno: TurnoPos; raw: Readonly<Record<string, unknown>> } | undefined> {
  const activo = await leerObligatorio(tx, rutaTurnoActivo(tenantId));
  if (activo === undefined) return undefined;
  const raw = await leerObligatorio(tx, rutaTurno(tenantId, textoDe(activo, 'turnoId')));
  if (raw === undefined) throw new ErrorPos('dato-corrupto', 'El turno activo no existe');
  const turno = leerTurno(raw);
  if (turno.estado !== 'abierto') throw new ErrorPos('dato-corrupto', 'El turno activo no está abierto');
  return { turno, raw };
}
