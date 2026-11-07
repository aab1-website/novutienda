import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Tenant } from '@novutienda/nucleo';
import { aplicarAlta, construirTenant, diferenciasTenant, type AlmacenTenant } from '../../plataforma/operador/alta.js';
import { manifiestosEnOrden } from '../../plataforma/registro.js';

const manifiestos = manifiestosEnOrden();
const cfg = (extra: Record<string, unknown> = {}) => ({
  version: 2,
  plan: 'base',
  zonaHoraria: 'America/La_Paz',
  monedas: ['BOB', 'USD', 'ARS'],
  modulos: ['inventarios', 'pos', 'recibos', 'consola', 'website'],
  ...extra,
});
const tenantDe = (c: unknown): Tenant => {
  const r = construirTenant(c, manifiestos);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

describe('alta de tenant: config.json v2 -> Tenant', () => {
  it('el config.json de Casa Bermejo es v2 y construye un Tenant válido con las versiones del manifiesto', () => {
    const c = JSON.parse(readFileSync('tenants/casa-bermejo/config.json', 'utf8')) as unknown;
    const t = tenantDe(c);
    expect(Object.keys(t.modulos).sort()).toEqual(['consola', 'inventarios', 'pos', 'recibos', 'website']);
    for (const m of manifiestos) {
      if (t.modulos[m.id] !== undefined) expect(t.modulos[m.id]).toEqual({ version: m.version, submodulos: [...m.submodulos] });
    }
  });

  it.each([
    ['pos sin recibos', cfg({ modulos: ['inventarios', 'pos'] }), /recibos/],
    ['pos sin inventarios', cfg({ modulos: ['pos', 'recibos'] }), /inventarios/],
    ['módulo desconocido', cfg({ modulos: ['inexistente'] }), /desconocido/],
    ['módulo no encendible', cfg({ modulos: ['nucleo'] }), /no es encendible/],
    ['módulos repetidos', cfg({ modulos: ['inventarios', 'inventarios'] }), /repetidos/],
    ['modulos no es lista', cfg({ modulos: { pos: {} } }), /lista/],
    ['versión 1', { version: 1, modulosActivos: ['nucleo'], zonaHoraria: 'America/La_Paz' }, /versión 2/],
    ['clave ajena', cfg({ modulosActivos: [] }), /no admitidas/],
    ['plan desconocido', cfg({ plan: 'oro' }), /Plan/],
    ['zona distinta', cfg({ zonaHoraria: 'UTC' }), /zonaHoraria/],
    ['monedas incompletas', cfg({ monedas: ['BOB'] }), /monedas/],
    ['no objeto', 5, /objeto/],
  ])('rechaza: %s', (_n, c, patron) => {
    const r = construirTenant(c, manifiestos);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(patron);
  });

  it('acepta un encendido parcial coherente', () => {
    expect(construirTenant(cfg({ modulos: ['inventarios'] }), manifiestos).ok).toBe(true);
  });
});

describe('diferencias contra el documento actual', () => {
  const t = tenantDe(cfg());
  it('iguales: sin diferencias', () => {
    expect(diferenciasTenant(JSON.parse(JSON.stringify(t)), t)).toEqual([]);
  });
  it('ausente, plan, módulo faltante, sobrante y campo ajeno', () => {
    expect(diferenciasTenant(null, t)).toEqual(['documento ausente: se creará']);
    const otro = JSON.parse(JSON.stringify(t)) as Record<string, unknown> & { modulos: Record<string, unknown> };
    otro['plan'] = 'x';
    delete otro['modulos']['pos'];
    otro['modulos']['viejo'] = { version: '1.0.0', submodulos: [] };
    otro['extra'] = 1;
    const d = diferenciasTenant(otro, t);
    expect(d).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^plan:/),
        expect.stringMatching(/^modulos\.pos: falta/),
        expect.stringMatching(/^modulos\.viejo: sobra/),
        expect.stringMatching(/^extra: campo ajeno/),
      ]),
    );
  });
});

describe('aplicarAlta con almacén simulado (sin red)', () => {
  const memoria = (inicial: unknown = null) => {
    const escrituras: Tenant[] = [];
    const almacen: AlmacenTenant = {
      leer: async () => inicial,
      escribir: async (_id, doc) => {
        escrituras.push(doc);
      },
    };
    return { almacen, escrituras };
  };

  it('verificar no escribe', async () => {
    const { almacen, escrituras } = memoria();
    const r = await aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: false });
    expect(r.aplicado).toBe(false);
    expect(r.diferencias.length).toBeGreaterThan(0);
    expect(escrituras).toEqual([]);
  });
  it('aplicar escribe el Tenant construido', async () => {
    const { almacen, escrituras } = memoria();
    const r = await aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true });
    expect(r.aplicado).toBe(true);
    expect(escrituras).toEqual([tenantDe(cfg())]);
  });
  it('aplicar sin diferencias no escribe', async () => {
    const { almacen, escrituras } = memoria(JSON.parse(JSON.stringify(tenantDe(cfg()))));
    const r = await aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true });
    expect(r).toEqual({ diferencias: [], aplicado: false });
    expect(escrituras).toEqual([]);
  });
  it('config inválida lanza y no escribe', async () => {
    const { almacen, escrituras } = memoria();
    await expect(
      aplicarAlta({ tenantId: 't', config: cfg({ modulos: ['pos'] }), manifiestos, almacen, aplicar: true }),
    ).rejects.toThrow(/Encendido/);
    expect(escrituras).toEqual([]);
  });
});
