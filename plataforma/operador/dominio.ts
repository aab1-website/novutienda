// Mapeo host -> tenant (`dominios/{host}`). Lo ejecuta solo el operador. Lógica pura: la base llega por inyección; sin red.
// Los mensajes no llevan identificadores. El documento solo lo escribe el servidor (reglas `if false`).
import { esEstadoTenant, esTenantIdValido, registrarAuditoria, tenantOperativo } from '@novutienda/nucleo';
import type { TransaccionAuditoria } from '@novutienda/nucleo';
import { operadorDe } from './personal.js';

/** Transacción mínima: lectura, alta, actualización y borrado de un documento, más la auditoría. */
export interface TransaccionDominio extends TransaccionAuditoria {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  update(ruta: string, datos: Readonly<Record<string, unknown>>): void;
  delete(ruta: string): void;
}
export interface BaseDatosDominio {
  runTransaction<T>(fn: (tx: TransaccionDominio) => Promise<T>): Promise<T>;
}

const ETIQUETA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Un host válido va en minúsculas, sin esquema, puerto, ruta, consulta ni espacios; son al menos dos etiquetas DNS
 * (letras, dígitos y guion; sin guion en los bordes; hasta 63 caracteres cada una), hasta 253 en total, y la última no es
 * numérica (así se descartan las direcciones IP).
 */
export function esHostValido(host: unknown): host is string {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253) return false;
  const etiquetas = host.split('.');
  if (etiquetas.length < 2) return false;
  if (!etiquetas.every((e) => ETIQUETA.test(e))) return false;
  return !/^[0-9]+$/.test(etiquetas[etiquetas.length - 1] ?? '');
}

export interface DocumentoDominio {
  readonly tenantId: string;
  readonly creado: unknown;
  readonly actualizado: unknown;
}

/** Documento nuevo de `dominios/{host}`. Las marcas de tiempo las pone el servidor (se pasan ya resueltas). */
export function construirDominio(tenantId: string, marca: unknown): DocumentoDominio {
  if (!esTenantIdValido(tenantId)) throw new Error('el tenant no es un identificador válido');
  return { tenantId, creado: marca, actualizado: marca };
}

export interface ResultadoDominio {
  readonly aplicado: boolean;
  /** Líneas legibles sin identificadores. */
  readonly diferencias: readonly string[];
}

/**
 * Asigna (o, con `eliminar`, quita) el mapeo de un host. Sin `aplicar` solo informa.
 * Reglas: un host pertenece a un solo tenant; si ya es de otro, se rechaza salvo `reasignar`. El tenant destino debe existir
 * con estado `activo` o `suspendido` (no `baja`; `tenantOperativo` cubre solo `activo`, y suspendido se admite para poder
 * dejar el mapeo listo). Con `aplicar` escribe y audita en una transacción (`dominio.asignar`, `dominio.reasignar`,
 * `dominio.eliminar`); la auditoría cuelga del tenant afectado (en la reasignación, de ambos).
 * `eliminar` exige que el host exista; si se indica `tenantId`, debe ser su dueño actual.
 */
export async function gestionarDominio(o: {
  readonly host: string;
  readonly tenantId?: string;
  readonly db: BaseDatosDominio;
  readonly operador: string;
  readonly aplicar: boolean;
  readonly reasignar?: boolean;
  readonly eliminar?: boolean;
}): Promise<ResultadoDominio> {
  if (!esHostValido(o.host)) throw new Error('el host no es válido (minúsculas, sin esquema, puerto ni ruta; formato DNS)');
  if (o.tenantId !== undefined && !esTenantIdValido(o.tenantId)) throw new Error('el tenant no es un identificador válido');
  if (o.eliminar === true && o.reasignar === true) throw new Error('--eliminar y --reasignar son excluyentes');
  if (o.eliminar !== true && o.tenantId === undefined) throw new Error('indique el tenant (--tenant)');
  const operador = operadorDe(o.operador);
  const ruta = `dominios/${o.host}`;
  const auditar = (tx: TransaccionDominio, tenantId: string, accion: string, antes: string | null, despues: string | null): void => {
    registrarAuditoria(tx, {
      tenantId,
      uid: operador,
      // Mismo criterio que el cambio de estado: 'adm' es solo el valor admitido; quién actuó lo dicen `uid` y `motivo`.
      rol: 'adm',
      motivo: 'operador de plataforma',
      accion,
      ruta,
      resumenAntes: { asignado: antes !== null },
      resumenDespues: { asignado: despues !== null },
    });
  };

  const planear = async (tx: TransaccionDominio): Promise<{ readonly accion: 'asignar' | 'reasignar' | 'eliminar' | 'nada'; readonly previo?: string }> => {
    const actual = await tx.get(ruta);
    const previo = actual.existe ? actual.data()?.['tenantId'] : undefined;
    if (actual.existe && (typeof previo !== 'string' || !esTenantIdValido(previo))) throw new Error('el mapeo existente es inválido: revíselo a mano');
    if (o.eliminar === true) {
      if (!actual.existe) throw new Error('el host no está asignado');
      if (o.tenantId !== undefined && o.tenantId !== previo) throw new Error('el host pertenece a otro tenant');
      return { accion: 'eliminar', previo: previo as string };
    }
    const tenantId = o.tenantId as string;
    const t = await tx.get(`tenants/${tenantId}`);
    if (!t.existe) throw new Error('el tenant no existe');
    const estado = t.data()?.['estado'];
    if (!esEstadoTenant(estado)) throw new Error('el tenant no tiene un estado válido: corra el alta antes');
    if (!tenantOperativo({ estado }) && estado !== 'suspendido') throw new Error('el tenant está de baja: no admite dominios');
    if (!actual.existe) return { accion: 'asignar' };
    if (previo === tenantId) return { accion: 'nada', previo };
    if (o.reasignar !== true) throw new Error('el host ya pertenece a otro tenant: use --reasignar para moverlo');
    return { accion: 'reasignar', previo: previo as string };
  };

  const plan = await o.db.runTransaction(planear);
  const diferencias =
    plan.accion === 'asignar' ? ['host: sin asignar -> tenant indicado']
    : plan.accion === 'reasignar' ? ['host: tenant actual -> tenant indicado (reasignación)']
    : plan.accion === 'eliminar' ? ['host: asignado -> sin asignar']
    : [];
  if (plan.accion === 'nada' || !o.aplicar) return { aplicado: false, diferencias };

  await o.db.runTransaction(async (tx) => {
    // Se replanifica dentro de la transacción: si algo cambió entre la lectura y la escritura, se aborta.
    const ahora = await planear(tx);
    if (ahora.accion !== plan.accion || ahora.previo !== plan.previo) throw new Error('el mapeo cambió durante la operación: reintente');
    const marca = tx.marcaTiempoServidor();
    if (plan.accion === 'eliminar') {
      tx.delete(ruta);
      auditar(tx, plan.previo as string, 'dominio.eliminar', plan.previo as string, null);
    } else if (plan.accion === 'asignar') {
      tx.create(ruta, { ...construirDominio(o.tenantId as string, marca) });
      auditar(tx, o.tenantId as string, 'dominio.asignar', null, o.tenantId as string);
    } else {
      tx.update(ruta, { tenantId: o.tenantId as string, actualizado: marca });
      auditar(tx, plan.previo as string, 'dominio.reasignar', plan.previo as string, null);
      auditar(tx, o.tenantId as string, 'dominio.reasignar', null, o.tenantId as string);
    }
  });
  return { aplicado: true, diferencias };
}
