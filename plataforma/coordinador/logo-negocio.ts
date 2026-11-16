// Puerto «logo del negocio» para Recibos: entrega la URL pública del logo que el comercio subió como archivo (módulo consola,
// documento `sitio/logo`). Recibos lo recibe como dependencia opcional (`OpcionesEmision.logoDelNegocio`) y, si devuelve `null`,
// usa la dirección escrita en su plantilla. El coordinador es quien conecta los dos módulos: ninguno importa al otro.
// Lee por la API exportada de consola (`leerLogo`), con un actor de servicio interno (nunca llega de la red), y solo si consola
// está encendido para el tenant (falla cerrado: sin lector de módulos o con módulo apagado, `null`).
import { construirClaim, esTenantIdValido, type BaseDatosIdentidad } from '@novutienda/nucleo';
import { leerLogo } from '@novutienda/consola';
import type { LectorModulos } from './modulos-activos.js';

/** URL pública del logo subido del tenant, o `null` (sin logo, consola apagada, ruta fuera del prefijo o base de medios no configurada). */
export type LogoDelNegocio = (tenantId: string) => Promise<string | null>;

export interface DepsLogoNegocio {
  readonly db: BaseDatosIdentidad;
  readonly modulosDelTenant: LectorModulos;
  /** Origen público de los medios (`MEDIOS_BASE_URL`); con o sin barra final. Vacío: no hay URL que entregar. */
  readonly baseMedios: string;
  /** Registro estructurado de avisos, sin datos personales (el servidor entrega `logger.warn`). */
  readonly avisar?: (mensaje: string, datos: Readonly<Record<string, string>>) => void;
}

const ACTOR_SERVICIO = 'servicio:recibos';

const escapar = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * El logo es decorativo: ante cualquier fallo de lectura devuelve `null` (el recibo usa la dirección de su plantilla) y avisa;
 * nunca frena la emisión.
 */
export function crearLogoDelNegocio(deps: DepsLogoNegocio): LogoDelNegocio {
  const base = deps.baseMedios.trim().replace(/\/+$/, '');
  return async (tenantId) => {
    try {
      if (base === '' || !esTenantIdValido(tenantId)) return null;
      if (!((await deps.modulosDelTenant(tenantId)) ?? []).includes('consola')) return null;
      const claim = construirClaim({ [tenantId]: 'sup' }, 1);
      if (!claim.ok) return null;
      const logo = await leerLogo({ db: deps.db }, { tenantId, actor: { uid: ACTOR_SERVICIO, claims: claim.valor } });
      if (logo === null) return null;
      const lista = new RegExp(`^tenants/${escapar(tenantId)}/publico/medios/_negocio/[A-Za-z0-9._-]+$`);
      const version = logo.versiones.find((v) => v.formato === 'png') ?? logo.versiones.find((v) => v.formato === 'webp');
      const ruta = version?.ruta;
      if (ruta === undefined || !lista.test(ruta) || ruta.includes('..')) return null;
      return `${base}/${ruta}`;
    } catch (err) {
      deps.avisar?.('logo del negocio: no se pudo leer; el recibo usa la dirección de la plantilla', { tenantId, error: err instanceof Error ? err.name : 'desconocido' });
      return null;
    }
  };
}
