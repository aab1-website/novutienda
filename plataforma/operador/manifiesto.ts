import type { ManifiestoModulo } from '@novutienda/nucleo';

/**
 * Manifiesto del operador: los datos de plataforma que no son de ningún tenant y que ve solo el operador de NovuTienda.
 *  - `novuchatTokens/{hashDelToken}`: tokens de integración de NovuChat. El id del documento es el hash del token (nunca el
 *    token en claro). Lo escribe el script `plataforma/funciones/scripts/token-novuchat.mjs` y lo lee el conector
 *    `plataforma/funciones/servidor/http/novuchat.ts` para autenticar las llamadas; el navegador no lee ni escribe
 *    (`lectura: []`) y solo el servidor escribe.
 * - `dominios/{host}`: mapeo host -> tenant (`{ tenantId, creado, actualizado }`). Lo escribe `scripts/dominio-tenant.mjs`
 *   (lógica en `plataforma/operador/dominio.ts`); el navegador no lee ni escribe.
 * Colección de raíz (`ambito: 'raiz'`): no cuelga de `tenants/{t}`.
 * - `tenants/{t}`: documento raíz del tenant (plan, módulos encendidos, zona horaria, monedas). Dueño: este manifiesto (excepción
 *   explícita del registro). Solo el servidor lo escribe: el alta la hace `scripts/alta-tenant.mjs` con Admin SDK desde
 *   `tenants/<t>/config.json`; las subcolecciones `tenants/{t}/…` son de los módulos y no se tocan aquí.
 * No emite ni consume eventos.
 */
export const manifiestoPlataforma: ManifiestoModulo = {
  id: 'plataforma',
  zona: 'plataforma',
  version: '0.1.0',
  dependeDe: ['nucleo'],
  submodulos: [],
  colecciones: [
    { ruta: 'novuchatTokens', lectura: [], escritura: 'servidor', ambito: 'raiz' },
    { ruta: 'dominios', lectura: [], escritura: 'servidor', ambito: 'raiz' },
    { ruta: 'tenants', lectura: [], escritura: 'servidor', ambito: 'raiz' },
  ],
  emite: [],
  consume: [],
};
