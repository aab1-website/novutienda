// Mercados del tenant vistos desde Inventarios (plano §6.10). El módulo no conoce ningún mercado: recibe la
// `ConfiguracionComercial` del tenant (inyectada por el borde) o, si quien llama no la trae, la lee del documento del tenant
// dentro de la misma transacción. Falla cerrado: sin documento o con configuración inválida lanza `EstadoInvalido`; jamás se
// asume una configuración por defecto.
import { comercialDe, validarTenant, type ConfiguracionComercial, type MercadoTenant } from '@novutienda/nucleo';
import { EstadoInvalido } from './errores.js';

/**
 * Clave con la que se guarda el precio de un mercado en `precioUSD` del producto: el id en minúsculas (`BO` -> `bo`).
 * Es la forma ya guardada del tenant de tres monedas (`bo`, `ar`): un tenant nuevo guarda con la misma regla. Función única:
 * nadie más deriva la clave a mano.
 */
export const claveDePrecio = (idMercado: string): string => idMercado.toLowerCase();

/** Sufijo legible de la auditoría (`BO` -> `Bo`): conserva los nombres `precioBo`/`antesBo` del resumen. */
export const sufijoDeAuditoria = (idMercado: string): string => idMercado.charAt(0) + idMercado.slice(1).toLowerCase();

/**
 * Zona horaria del mercado principal del tenant (el primero que declara). Es la zona de las fechas de calendario que NO
 * pertenecen a un mercado concreto (hoy, solo `garantiaHasta` cuando quien llama no indica la del mercado de la venta).
 */
export const zonaPrincipalDe = (c: ConfiguracionComercial): string => (c.mercados[0] as MercadoTenant).zonaHoraria;

interface LectorRuta {
  leerRuta(r: string): Promise<Readonly<Record<string, unknown>> | undefined>;
}

/** La configuración inyectada o, en su defecto, la del documento del tenant (validada). Falla cerrado. */
export async function resolverComercial(lector: LectorRuta, tenantId: string, inyectada?: ConfiguracionComercial): Promise<ConfiguracionComercial> {
  if (inyectada !== undefined) return inyectada;
  const doc = await lector.leerRuta(`tenants/${tenantId}`);
  const tenant = validarTenant(doc);
  if (!tenant.ok) throw new EstadoInvalido('Tenant inexistente o inválido');
  const comercial = comercialDe(tenant.valor);
  if (!comercial.ok) throw new EstadoInvalido('La configuración comercial del negocio falta o es inválida');
  return comercial.valor;
}
