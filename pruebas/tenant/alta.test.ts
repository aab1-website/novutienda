import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Tenant } from '@novutienda/nucleo';
import { aplicarAlta, construirTenant, diferenciasTenant, type AlmacenTenant } from '../../plataforma/operador/alta.js';
import { otroConInventariosYHost, type LectorCompuerta } from '../../plataforma/operador/inventarios-compartido.js';
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
  it('el config.json del tenant de referencia es v2 y construye un Tenant válido con las versiones del manifiesto', () => {
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
  const memoria = (inicial: unknown = null, subcolecciones: () => Promise<boolean> = async () => false) => {
    const escrituras: Tenant[] = [];
    const almacen: AlmacenTenant = {
      leer: async () => inicial,
      escribir: async (_id, doc) => {
        escrituras.push(doc);
      },
      tieneSubcolecciones: subcolecciones,
      inventariosCompartido: async () => false,
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
    expect(escrituras[0]?.estado).toBe('activo');
  });
  it('documento existente conserva su estado (suspendido) y no lo cambia', async () => {
    const previo = { ...JSON.parse(JSON.stringify(tenantDe(cfg()))), estado: 'suspendido', plan: 'base' } as Record<string, unknown>;
    const { almacen, escrituras } = memoria(previo);
    const r = await aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true });
    expect(r).toEqual({ diferencias: [], aplicado: false });
    expect(escrituras).toEqual([]);
    const { almacen: a2, escrituras: e2 } = memoria(previo);
    await aplicarAlta({ tenantId: 't', config: cfg({ modulos: ['inventarios'] }), manifiestos, almacen: a2, aplicar: true });
    expect(e2).toHaveLength(1);
    expect(e2[0]?.estado).toBe('suspendido');
  });
  it('estado baja se rechaza y no escribe', async () => {
    const { almacen, escrituras } = memoria({ ...JSON.parse(JSON.stringify(tenantDe(cfg()))), estado: 'baja' });
    await expect(aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true })).rejects.toThrow(/dado de baja, no se reutiliza/);
    expect(escrituras).toEqual([]);
  });
  it('id fantasma (subcolecciones sin documento) se rechaza y no escribe', async () => {
    const { almacen, escrituras } = memoria(null, async () => true);
    await expect(aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true })).rejects.toThrow(/id con datos previos/);
    expect(escrituras).toEqual([]);
  });
  it('si tieneSubcolecciones falla, falla cerrado y no escribe', async () => {
    const { almacen, escrituras } = memoria(null, async () => {
      throw new Error('sin red');
    });
    await expect(aplicarAlta({ tenantId: 't', config: cfg(), manifiestos, almacen, aplicar: true })).rejects.toThrow(/sin red/);
    expect(escrituras).toEqual([]);
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

describe('compuerta D-B1 en el alta', () => {
  const inv = { modulos: { inventarios: { version: '1', submodulos: [] } } };
  // Datos: tenants/{t} y dominios/{h}; `b` no tiene inventarios al inicio.
  const montar = (docs: Record<string, Record<string, unknown>>, previo: unknown) => {
    const lector: LectorCompuerta = {
      get: async (ruta) => ({ existe: docs[ruta] !== undefined, data: () => docs[ruta] }),
      listar: async (col) => Object.entries(docs).filter(([r]) => r.startsWith(`${col}/`)).map(([ruta, d]) => ({ ruta, data: () => d })),
    };
    const escrituras: Tenant[] = [];
    const almacen: AlmacenTenant = {
      leer: async () => previo,
      escribir: async (_id, doc) => void escrituras.push(doc),
      tieneSubcolecciones: async () => false,
      inventariosCompartido: (id) => otroConInventariosYHost(lector, id, { exigirHostPropio: true }),
    };
    return { almacen, escrituras };
  };
  const previoB = { ...JSON.parse(JSON.stringify(tenantDe(cfg({ modulos: [] })))) } as Record<string, unknown>;
  previoB['extra'] = 1; // campo ajeno: el alta tiene qué escribir aunque no encienda inventarios
  const dominios = { 'dominios/uno.ejemplo.test': { tenantId: 'tenant-a' }, 'dominios/dos.ejemplo.test': { tenantId: 'tenant-b' } };

  it('encender inventarios en un tenant con host cuando otro con inventarios ya tiene host se rechaza (con y sin aplicar)', async () => {
    for (const aplicar of [false, true]) {
      const m = montar({ 'tenants/tenant-a': inv, ...dominios }, previoB);
      const e = await aplicarAlta({ tenantId: 'tenant-b', config: cfg(), manifiestos, almacen: m.almacen, aplicar }).catch((x: unknown) => x);
      expect((e as Error).message).toMatch(/inventarios/);
      expect((e as Error).message).not.toMatch(/tenant-[ab]/);
      expect(m.escrituras).toEqual([]);
    }
  });
  it('un alta que no enciende inventarios, o un tenant sin host, sigue funcionando', async () => {
    const m = montar({ 'tenants/tenant-a': inv, ...dominios }, previoB);
    await expect(aplicarAlta({ tenantId: 'tenant-b', config: cfg({ modulos: [] }), manifiestos, almacen: m.almacen, aplicar: true })).resolves.toMatchObject({ aplicado: true });
    const sinHost = montar({ 'tenants/tenant-a': inv, 'dominios/uno.ejemplo.test': { tenantId: 'tenant-a' } }, previoB);
    await expect(aplicarAlta({ tenantId: 'tenant-b', config: cfg(), manifiestos, almacen: sinHost.almacen, aplicar: true })).resolves.toMatchObject({ aplicado: true });
  });
});
