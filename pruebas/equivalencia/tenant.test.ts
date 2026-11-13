// Configuración declarativa de Casa Bermejo: lo que declara el tenant (monedas, plan, zona horaria, módulos), cómo
// lo valida el núcleo y la política de redondeo por defecto. Es el punto de partida del modelo de mercados y monedas.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MONEDA_DE, validarTenant } from '@novutienda/nucleo';
import { describe, it } from 'vitest';
import { interpretarRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';
import { TENANT } from './escenario.js';
import { compararConFotoJson } from './foto.js';

const configRepo = JSON.parse(readFileSync(fileURLToPath(new URL('../../tenants/casa-bermejo/config.json', import.meta.url)), 'utf8')) as unknown;

describe('configuración de Casa Bermejo', () => {
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
