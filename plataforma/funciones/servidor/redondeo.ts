// Política de redondeo del precio final, leída de `tenants/{t}/config/redondeo`. Decisión vigente (Andres,
// 04/11/2026): BOB con dos decimales; ARS al múltiplo de 100 más cercano. Sin documento rige esa política;
// con un documento inválido NO se adivina: se falla (un precio mal redondeado se cobra).
import { z } from 'zod';
import { esReglaRedondeoValida, redondeoPorMoneda, type BaseDatosIdentidad, type ConfiguracionComercial, type Redondeo, type RedondeoPorMoneda } from '@novutienda/nucleo';

/** @deprecated LEGADO del tenant de tres monedas: la política por defecto sale de `redondeoPorMoneda(comercial)`. */
export const REDONDEO_POR_DEFECTO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
};

const modo = z.enum(['cercano', 'arriba', 'abajo']);
const regla = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('decimales'), decimales: z.number().int().min(0).max(2), modo }).strict(),
  z.object({ tipo: z.literal('multiplo'), multiplo: z.number().min(0.01).max(1_000_000), modo }).strict(),
]).refine((r) => esReglaRedondeoValida(r)); // D7: múltiplo exacto en centavos; sin «ninguno» ni más de 2 decimales
const esquemaRedondeo = z.object({ BOB: regla, ARS: regla }).strict();

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
    const r = regla.safeParse(datos[m]);
    if (!r.success) throw new RedondeoInvalido();
    salida[m] = r.data;
  }
  return salida;
}

/**
 * LEGADO, idéntico a main: lector con caché corta por tenant de la política BOB/ARS (misma fuente, `config/redondeo`, y mismos
 * fallos: no lee `tenants/{t}`). Lo usan los callers de caja, consola y sitio hasta B2 a B4.
 * @deprecated Usar `lectorRedondeoDe`.
 */
export function lectorRedondeo(db: BaseDatosIdentidad, ahora: () => number, ttlMs = 60_000): (tenantId: string) => Promise<Redondeo> {
  const cache = new Map<string, { readonly hasta: number; readonly valor: Redondeo }>();
  return async (tenantId) => {
    const t = ahora();
    const previo = cache.get(tenantId);
    if (previo !== undefined && previo.hasta > t) return previo.valor;
    const valor = interpretarRedondeo(await db.runTransaction(async (tx) => (await tx.get(rutaRedondeo(tenantId))).data()));
    cache.set(tenantId, { hasta: t + ttlMs, valor });
    return valor;
  };
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
