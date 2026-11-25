// Política de redondeo del precio final, leída de `tenants/{t}/config/redondeo`. Decisión vigente (Andres,
// 25/11/2026): BOB a bolivianos enteros; ARS al múltiplo de 1000 más cercano; la mitad sube. Sin documento rige esa política;
// con un documento inválido NO se adivina al leer: se falla; solo el operador lo repara con `fijarRedondeoDe`.
import { z } from 'zod';
import { esReglaRedondeoValida, publicarEvento, redondeoPorMoneda, registrarAuditoria, type BaseDatosIdentidad, type ConfiguracionComercial, type Redondeo, type RedondeoPorMoneda, type Resumen, type SobreEvento, type TransaccionAuditoria, type TransaccionBandeja } from '@novutienda/nucleo';

/** @deprecated LEGADO del tenant de tres monedas: la política por defecto sale de `redondeoPorMoneda(comercial)`. */
export const REDONDEO_POR_DEFECTO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 0, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'cercano' },
};

const modo = z.enum(['cercano', 'arriba', 'abajo']);
export const reglaRedondeoEsquema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('decimales'), decimales: z.number().int().min(0).max(2), modo }).strict(),
  z.object({ tipo: z.literal('multiplo'), multiplo: z.number().min(0.01).max(1_000_000), modo }).strict(),
]).refine((r) => esReglaRedondeoValida(r)); // D7: múltiplo exacto en centavos; sin «ninguno» ni más de 2 decimales
const esquemaRedondeo = z.object({ BOB: reglaRedondeoEsquema, ARS: reglaRedondeoEsquema }).strict();

export class RedondeoInvalido extends Error {
  constructor() {
    super('La configuración de redondeo del tenant es inválida');
    this.name = 'RedondeoInvalido';
  }
}

export const rutaRedondeo = (tenantId: string): string => `tenants/${tenantId}/config/redondeo`;

/** @deprecated LEGADO (solo BOB y ARS): usar `interpretarRedondeoDe`. Interpreta el documento; `undefined` = no existe (rige la política por defecto). */
export function interpretarRedondeo(datos: Readonly<Record<string, unknown>> | undefined): Redondeo {
  if (datos === undefined) return REDONDEO_POR_DEFECTO;
  const r = esquemaRedondeo.safeParse(datos);
  if (!r.success) throw new RedondeoInvalido();
  return r.data;
}

/**
 * Política efectiva de un tenant: la de su configuración comercial (`redondeoPorMoneda`). El documento `config/redondeo`
 * es una sobrescritura opcional heredada: si existe debe traer EXACTAMENTE las monedas de venta del tenant, cada una con
 * una regla válida; si no, se falla (un precio mal redondeado se cobra). Sin documento rige la configuración.
 */
export function interpretarRedondeoDe(datos: Readonly<Record<string, unknown>> | undefined, comercial: ConfiguracionComercial): RedondeoPorMoneda {
  const base = redondeoPorMoneda(comercial);
  if (datos === undefined) return base;
  const monedas = [...new Set(comercial.mercados.map((m) => m.monedaVenta))];
  const claves = Object.keys(datos);
  if (claves.length !== monedas.length || !claves.every((k) => monedas.includes(k))) throw new RedondeoInvalido();
  const salida: Record<string, RedondeoPorMoneda[string]> = {};
  for (const m of monedas) {
    const r = reglaRedondeoEsquema.safeParse(datos[m]);
    if (!r.success) throw new RedondeoInvalido();
    salida[m] = r.data;
  }
  return salida;
}

/** Lector de la política efectiva por tenant. `invalidar()` la vacía (pruebas). */
export interface LectorRedondeo {
  (tenantId: string): Promise<RedondeoPorMoneda>;
  invalidar(tenantId?: string): void;
}

/**
 * Política efectiva del tenant (`interpretarRedondeoDe`). Propagación: un cambio del operador en `tenants/{t}` o en
 * `config/redondeo` tarda como máximo 60 s en notarse en una instancia ya caliente. Las dos cachés NO se encadenan: este lector
 * guarda solo el documento `config/redondeo` (60 s) y recalcula la política en cada llamada (cálculo puro) con la configuración
 * comercial que entrega su lector (60 s propios), de modo que cada fuente expira por su cuenta.
 */
export function lectorRedondeoDe(
  db: BaseDatosIdentidad,
  ahora: () => number,
  comercialDe: (tenantId: string) => Promise<ConfiguracionComercial>,
  ttlMs = 60_000,
): LectorRedondeo {
  const cache = new Map<string, { readonly hasta: number; readonly datos: Readonly<Record<string, unknown>> | undefined }>();
  const leer = async (tenantId: string): Promise<RedondeoPorMoneda> => {
    const comercial = await comercialDe(tenantId);
    const t = ahora();
    let entrada = cache.get(tenantId);
    if (entrada === undefined || entrada.hasta <= t) {
      const datos = await db.runTransaction(async (tx) => (await tx.get(rutaRedondeo(tenantId))).data());
      entrada = { hasta: t + ttlMs, datos };
      cache.set(tenantId, entrada);
    }
    return interpretarRedondeoDe(entrada.datos, comercial);
  };
  return Object.assign(leer, { invalidar: (tenantId?: string): void => { if (tenantId === undefined) cache.clear(); else cache.delete(tenantId); } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Edición del redondeo por el operador de NovuTienda (`propietario`). El administrador del comercio solo lo ve.
/** Transacción que necesita `fijarRedondeoDe`: lee y escribe el documento, audita y publica en la bandeja, todo atómico. */
export interface TransaccionRedondeo extends TransaccionAuditoria, TransaccionBandeja {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  set(ruta: string, datos: Readonly<Record<string, unknown>>): void;
}

export interface EntradaFijarRedondeo {
  readonly tenantId: string;
  readonly comercial: ConfiguracionComercial;
  /** Reglas nuevas por moneda de venta (sin validar: se validan aquí). */
  readonly reglas: Readonly<Record<string, unknown>>;
  /** Reglas que quien edita vio al abrir la pantalla; si ya no son las vigentes, hay conflicto. `null`: el documento vigente estaba inválido y se repara. */
  readonly esperadas: Readonly<Record<string, unknown>> | null;
  /** uid del operador de NovuTienda. */
  readonly uid: string;
  readonly motivo?: string;
  readonly ahora?: () => number;
}

export type ResultadoFijarRedondeo =
  | { readonly tipo: 'fijado'; readonly cambiadas: readonly string[]; readonly reglas: RedondeoPorMoneda }
  | { readonly tipo: 'sin-cambios' }
  | { readonly tipo: 'conflicto'; readonly actuales: RedondeoPorMoneda }
  | { readonly tipo: 'invalido'; readonly motivo: string };

const canonica = (r: unknown): string => JSON.stringify(r, Object.keys((r ?? {}) as object).sort());
const mismasClaves = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((k) => b.includes(k));

/**
 * Fija el redondeo de un tenant dentro de la transacción dada: valida cada regla con el esquema, exige que las claves sean
 * exactamente las monedas de venta, compara `esperadas` con las vigentes (si difieren, `conflicto`), escribe
 * `tenants/{t}/config/redondeo`, audita `redondeo.fijar` (antes y después) y publica `redondeo.cambiado` con solo las monedas
 * que cambiaron. Si nada cambió no escribe nada. Un documento vigente inválido se repara: las reglas actuales pasan a ser `redondeoPorMoneda(comercial)`, se acepta `esperadas: null`, se escribe siempre y la auditoría anota `resumenAntes: {invalido: true}`.
 */
export async function fijarRedondeoDe(tx: TransaccionRedondeo, e: EntradaFijarRedondeo): Promise<ResultadoFijarRedondeo> {
  const monedas = [...new Set(e.comercial.mercados.map((m) => m.monedaVenta))];
  if (!mismasClaves(Object.keys(e.reglas), monedas)) return { tipo: 'invalido', motivo: 'Las reglas deben cubrir exactamente las monedas de venta del tenant' };
  const nuevas: Record<string, RedondeoPorMoneda[string]> = {};
  for (const m of monedas) {
    const r = reglaRedondeoEsquema.safeParse(e.reglas[m]);
    if (!r.success) return { tipo: 'invalido', motivo: `Regla de redondeo inválida para ${m}` };
    nuevas[m] = r.data;
  }
  const ruta = rutaRedondeo(e.tenantId);
  let actuales: RedondeoPorMoneda;
  let invalidoAntes = false;
  try {
    actuales = interpretarRedondeoDe((await tx.get(ruta)).data(), e.comercial);
  } catch (err) {
    if (!(err instanceof RedondeoInvalido)) throw err;
    actuales = redondeoPorMoneda(e.comercial);
    invalidoAntes = true;
  }
  if (!(invalidoAntes && e.esperadas === null)) {
    const esp = e.esperadas ?? {};
    if (!mismasClaves(Object.keys(esp), monedas) || monedas.some((m) => canonica(esp[m]) !== canonica(actuales[m]))) return { tipo: 'conflicto', actuales };
  }
  const cambiadas = invalidoAntes ? monedas : monedas.filter((m) => canonica(nuevas[m]) !== canonica(actuales[m]));
  if (cambiadas.length === 0) return { tipo: 'sin-cambios' };

  tx.set(ruta, nuevas);
  registrarAuditoria(tx, {
    tenantId: e.tenantId, uid: e.uid, rol: 'propietario', accion: 'redondeo.fijar', ruta,
    resumenAntes: (invalidoAntes ? { invalido: true } : actuales) as unknown as Resumen, resumenDespues: nuevas as unknown as Resumen,
    ...(e.motivo === undefined ? {} : { motivo: e.motivo }),
  });
  const id = tx.nuevoId(`tenants/${e.tenantId}/eventos`);
  const sobre: SobreEvento = {
    id, tipo: 'redondeo.cambiado', version: 1, tenantId: e.tenantId, origen: 'nucleo',
    ocurridoEn: new Date((e.ahora ?? Date.now)()).toISOString(), claveIdempotencia: id, datos: { monedas: cambiadas },
  };
  publicarEvento(tx, sobre);
  return { tipo: 'fijado', cambiadas, reglas: nuevas };
}
