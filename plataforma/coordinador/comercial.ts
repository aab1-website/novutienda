// Lector de la configuración comercial del tenant (mercados y monedas): lee `tenants/{t}` con Admin SDK, valida el
// documento con el núcleo y entrega la `ConfiguracionComercial` con `comercialDe`. Es el ÚNICO lugar del servidor donde se
// admite el documento de la forma anterior (sin `comercial`): `comercialDe` lo deriva, de forma explícita, del tenant de tres
// monedas. Falla cerrado: tenant inexistente, id inválido o documento inválido lanzan `ComercialInvalida`; jamás se entrega una
// configuración por defecto. Caché por instancia, del mismo estilo que el lector de redondeo y el de módulos: los resultados
// buenos duran 60 s (un cambio del operador tarda como máximo 60 s en una instancia caliente) y los errores 10 s (un id inventado no debe costar una lectura por petición).
import { comercialDe, esTenantIdValido, validarTenant, type ConfiguracionComercial } from '@novutienda/nucleo';
import type { LectorDocumento } from './modulos-activos.js';

export const TTL_COMERCIAL_MS = 60_000;
export const TTL_COMERCIAL_NEGATIVO_MS = 10_000;
/** Tope de entradas de la caché (la más antigua se descarta): un token o un id inventado no puede hacerla crecer sin límite. */
export const MAX_ENTRADAS_COMERCIAL = 500;

export type MotivoComercialInvalida = 'inexistente' | 'invalido';

/** El tenant no existe o su configuración comercial no es válida. El mensaje no revela datos del documento. */
export class ComercialInvalida extends Error {
  constructor(readonly motivo: MotivoComercialInvalida) {
    super(motivo === 'inexistente' ? 'No existe la configuración comercial del negocio' : 'La configuración comercial del negocio es inválida');
    this.name = 'ComercialInvalida';
  }
}

/** Lector con caché. `invalidar()` vacía todo (o un tenant): lo usan las pruebas y quien acaba de reescribir el documento. */
export interface LectorComercial {
  (tenantId: string): Promise<ConfiguracionComercial>;
  invalidar(tenantId?: string): void;
}

type Entrada = { readonly hasta: number; readonly valor: ConfiguracionComercial } | { readonly hasta: number; readonly motivo: MotivoComercialInvalida };

export function crearLectorComercial(firestore: LectorDocumento, ahora: () => number): LectorComercial {
  const cache = new Map<string, Entrada>();
  const guardar = (tenantId: string, e: Entrada, ahoraMs: number): void => {
    for (const [k, v] of cache) if (v.hasta <= ahoraMs) cache.delete(k); // expulsa las vencidas
    while (cache.size >= MAX_ENTRADAS_COMERCIAL) {
      const antigua = cache.keys().next().value; // el Map conserva el orden de inserción: la primera es la más antigua
      if (antigua === undefined) break;
      cache.delete(antigua);
    }
    cache.set(tenantId, e);
  };
  const leer = async (tenantId: string): Promise<ConfiguracionComercial> => {
    if (!esTenantIdValido(tenantId)) throw new ComercialInvalida('invalido');
    const t = ahora();
    const previo = cache.get(tenantId);
    if (previo !== undefined && previo.hasta <= t) cache.delete(tenantId);
    if (previo !== undefined && previo.hasta > t) {
      if ('valor' in previo) return previo.valor;
      throw new ComercialInvalida(previo.motivo);
    }
    const snap = await firestore.doc(`tenants/${tenantId}`).get();
    const fallar = (motivo: MotivoComercialInvalida): never => {
      guardar(tenantId, { hasta: t + TTL_COMERCIAL_NEGATIVO_MS, motivo }, t);
      throw new ComercialInvalida(motivo);
    };
    if (!snap.exists) return fallar('inexistente');
    const v = validarTenant(snap.data());
    if (!v.ok) return fallar('invalido');
    const c = comercialDe(v.valor);
    if (!c.ok) return fallar('invalido');
    guardar(tenantId, { hasta: t + TTL_COMERCIAL_MS, valor: c.valor }, t);
    return c.valor;
  };
  return Object.assign(leer, {
    invalidar: (tenantId?: string): void => {
      if (tenantId === undefined) cache.clear();
      else cache.delete(tenantId);
    },
  });
}

/** Lo que ve el panel de la configuración comercial: nunca las fuentes del tipo de cambio ni su par. */
export interface VistaComercial {
  readonly mercados: readonly {
    readonly id: string;
    readonly nombre: string;
    readonly monedaVenta: string;
    readonly monedaBase: string;
    readonly tieneTipoCambio: boolean;
  }[];
  readonly monedasCaja: readonly string[];
}

/** Proyección de solo lectura para el panel (callable `configuracionComercial`, de Central). */
export function vistaComercial(c: ConfiguracionComercial): VistaComercial {
  return {
    mercados: c.mercados.map((m) => ({
      id: m.id, nombre: m.nombre, monedaVenta: m.monedaVenta, monedaBase: m.monedaBase, tieneTipoCambio: m.tipoCambio !== null,
    })),
    monedasCaja: [...c.monedas],
  };
}
