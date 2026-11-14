// Comprobación D7 del redondeo de un tenant: solo se admite redondear a 0, 1 o 2 decimales, o a un múltiplo de al menos 0,01
// y exacto en centavos; ni «ninguno» ni más de 2 decimales. Lógica pura (sin Firestore): la usa `scripts/verificar-comercial.mjs`.
// La política efectiva es la del servidor (`interpretarRedondeoDe`): el documento `config/redondeo` si existe; si no, la de la
// configuración comercial del tenant (la declarada en `comercial` o la derivada de la forma anterior). Sin identificadores ni datos.
import { comercialDe, esPlanId, esReglaRedondeoValida, redondeoPorMoneda, validarTenant, type ReglaRedondeo } from '@novutienda/nucleo';

export type MotivoD7 = 'regla ninguno' | 'regla inválida' | 'múltiplo no exacto en centavos' | `decimales ${string}`;

export interface LineaMoneda {
  readonly moneda: string;
  readonly cumple: boolean;
  readonly motivo?: MotivoD7;
}

export interface InformeComercial {
  readonly forma: 'v3 (comercial)' | 'anterior';
  /** Plan del tenant si es uno conocido; si no, `desconocido`. */
  readonly plan: string;
  readonly origen: 'documento config/redondeo' | 'valores por omisión del servidor';
  readonly monedas: readonly LineaMoneda[];
  readonly cumple: boolean;
}

export type ResultadoVerificacion = { readonly ok: true; readonly informe: InformeComercial } | { readonly ok: false; readonly error: string };

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** `null` si la regla cumple D7; si no, el motivo. */
export function motivoIncumpleD7(regla: unknown): MotivoD7 | null {
  if (!esObjeto(regla) || !esReglaRedondeoValida(regla as unknown as ReglaRedondeo)) {
    // Una regla de decimales con más de 2 es «válida» para el núcleo anterior: se distingue para dar el motivo exacto.
    if (esObjeto(regla) && regla['tipo'] === 'decimales' && Number.isInteger(regla['decimales']) && (regla['decimales'] as number) > 2) {
      return `decimales ${String(regla['decimales'])}`;
    }
    return 'regla inválida';
  }
  const r = regla as unknown as ReglaRedondeo;
  if (r.tipo === 'ninguno') return 'regla ninguno';
  if (r.tipo === 'decimales') return r.decimales > 2 ? `decimales ${String(r.decimales)}` : null;
  const centavos = r.multiplo * 100;
  return r.multiplo < 0.01 || Math.abs(centavos - Math.round(centavos)) > 1e-9 ? 'múltiplo no exacto en centavos' : null;
}

/** Reglas efectivas por moneda de venta, o el motivo por el que no se pueden determinar. */
function reglasDelTenant(tenant: Readonly<Record<string, unknown>>): { forma: InformeComercial['forma']; reglas: Map<string, unknown[]> } | string {
  const reglas = new Map<string, unknown[]>();
  const agregar = (moneda: unknown, regla: unknown): void => {
    if (typeof moneda !== 'string') return;
    reglas.set(moneda, [...(reglas.get(moneda) ?? []), regla]);
  };
  if (tenant['comercial'] !== undefined) {
    const c = tenant['comercial'];
    if (!esObjeto(c) || !Array.isArray(c['mercados']) || c['mercados'].length === 0) return 'el tenant tiene una forma comercial ilegible';
    for (const m of c['mercados'] as unknown[]) if (esObjeto(m)) agregar(m['monedaVenta'], m['redondeo']);
    return reglas.size === 0 ? 'el tenant no declara monedas de venta legibles' : { forma: 'v3 (comercial)', reglas };
  }
  const v = validarTenant(tenant);
  if (!v.ok) return 'el tenant no es una forma conocida';
  const c = comercialDe(v.valor);
  if (!c.ok) return 'el tenant no es una forma conocida';
  for (const [moneda, regla] of Object.entries(redondeoPorMoneda(c.valor))) agregar(moneda, regla);
  return { forma: 'anterior', reglas };
}

/**
 * Evalúa D7 sobre los datos leídos de `tenants/{t}` y de `tenants/{t}/config/redondeo` (`undefined` = el documento no existe).
 * Con documento, manda sobre la configuración: cada moneda de venta debe traer su regla (una moneda sin regla no cumple).
 */
export function verificarComercial(tenant: Readonly<Record<string, unknown>> | undefined, redondeo: Readonly<Record<string, unknown>> | undefined): ResultadoVerificacion {
  if (tenant === undefined) return { ok: false, error: 'el tenant no existe' };
  const base = reglasDelTenant(tenant);
  if (typeof base === 'string') return { ok: false, error: base };
  const plan = esPlanId(tenant['plan']) ? (tenant['plan'] as string) : 'desconocido';
  const monedas: LineaMoneda[] = [...base.reglas.entries()].map(([moneda, declaradas]) => {
    const evaluadas = redondeo === undefined ? declaradas : [redondeo[moneda]];
    for (const r of evaluadas) {
      const motivo = motivoIncumpleD7(r);
      if (motivo !== null) return { moneda, cumple: false, motivo };
    }
    return { moneda, cumple: true };
  });
  return {
    ok: true,
    informe: {
      forma: base.forma,
      plan,
      origen: redondeo === undefined ? 'valores por omisión del servidor' : 'documento config/redondeo',
      monedas,
      cumple: monedas.every((m) => m.cumple),
    },
  };
}

/** Líneas legibles: forma, plan, origen y UNA línea por moneda. Nunca vuelca documentos. */
export function lineasDelInforme(i: InformeComercial): string[] {
  return [
    `forma del tenant: ${i.forma}`,
    `plan: ${i.plan}`,
    `redondeo evaluado desde: ${i.origen}`,
    ...i.monedas.map((m) => (m.cumple ? `${m.moneda}: cumple D7` : `${m.moneda}: NO cumple (${m.motivo ?? 'regla inválida'})`)),
  ];
}
