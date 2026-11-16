// Punto de extensión para los tenants (`@novutienda/nucleo/extension`).
// Solo tipos de contrato; los tenants no importan nada más de la plataforma.
export type { ManifiestoModulo, Rol } from '../registro/tipos.js';
export type { ConfiguracionComercial, MercadoTenant, TipoCambioMercado, FuenteTipoCambio } from '../tenant/mercados.js';
export type { ReglaRedondeo, ModoRedondeo } from '../tipo-cambio/regla-redondeo.js';
export type { SobreEvento } from '../contratos/sobre-evento.js';
