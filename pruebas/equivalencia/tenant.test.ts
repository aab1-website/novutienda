// Configuración declarativa del tenant de referencia: lo que declara el tenant (monedas, plan, zona horaria, módulos), cómo
// lo valida el núcleo y la política de redondeo por defecto. Es el punto de partida del modelo de mercados y monedas.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MONEDA_DE, validarTenant } from '@novutienda/nucleo';
import { describe, it } from 'vitest';
import { interpretarRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';
import { TENANT } from './escenario.js';
import { compararConFotoJson } from './foto.js';

// El tenant del repositorio con tres monedas (BOB, USD y ARS): se busca por su configuración, no por su nombre.
const RAIZ = fileURLToPath(new URL('../../tenants/', import.meta.url));
const configs = readdirSync(RAIZ)
  .map((n) => `${RAIZ}${n}/config.json`)
  .filter((r) => existsSync(r))
  .map((r) => JSON.parse(readFileSync(r, 'utf8')) as { monedas?: string[] })
  .filter((c) => c.monedas?.join() === 'BOB,USD,ARS');
const configRepo: unknown = configs[0];

describe('configuración del tenant de referencia', () => {
  it('tenant validado, configuración del repositorio y redondeo por defecto', () => {
    compararConFotoJson('tenant-configuracion.json', {
      configRepositorio: configRepo,
      monedaPorMercado: MONEDA_DE,
      documentoDelTenant: validarTenant(TENANT),
      monedaFueraDeLista: validarTenant({ ...TENANT, monedas: ['BOB', 'USD', 'EUR'] }),
      zonaHorariaOtra: validarTenant({ ...TENANT, zonaHoraria: 'America/Buenos_Aires' }),
      redondeoPorDefecto: interpretarRedondeo(undefined),
    });
  });
});
