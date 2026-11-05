// Política de redondeo del precio final, leída de `tenants/{t}/config/redondeo`. Decisión vigente (Andres,
// 04/11/2026): BOB con dos decimales; ARS al múltiplo de 100 más cercano. Sin documento rige esa política;
// con un documento inválido NO se adivina: se falla (un precio mal redondeado se cobra).
import { z } from 'zod';
import type { BaseDatosIdentidad, Redondeo } from '@novutienda/nucleo';

export const REDONDEO_POR_DEFECTO: Redondeo = {
  BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' },
  ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
};

const modo = z.enum(['cercano', 'arriba', 'abajo']);
const regla = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('ninguno') }).strict(),
  z.object({ tipo: z.literal('decimales'), decimales: z.number().int().min(0).max(6), modo }).strict(),
  z.object({ tipo: z.literal('multiplo'), multiplo: z.number().positive().max(1_000_000), modo }).strict(),
]);
const esquemaRedondeo = z.object({ BOB: regla, ARS: regla }).strict();

export class RedondeoInvalido extends Error {
  constructor() {
    super('La configuración de redondeo del tenant es inválida');
    this.name = 'RedondeoInvalido';
  }
}

export const rutaRedondeo = (tenantId: string): string => `tenants/${tenantId}/config/redondeo`;

/** Interpreta el documento; `undefined` = no existe (rige la política por defecto). */
export function interpretarRedondeo(datos: Readonly<Record<string, unknown>> | undefined): Redondeo {
  if (datos === undefined) return REDONDEO_POR_DEFECTO;
  const r = esquemaRedondeo.safeParse(datos);
  if (!r.success) throw new RedondeoInvalido();
  return r.data;
}

/** Lector con caché corta por tenant (la política cambia casi nunca). */
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
