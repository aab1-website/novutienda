// Configuración comercial del tenant (mercados y monedas) con el Entorno real sobre el emulador: el lector, la cotización
// programada, el redondeo y la proyección para el panel. Los tenants son sembrados aquí; nada de `tenants/`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { rutaCotizacion, type FetchLike } from '@novutienda/nucleo';
import { ComercialInvalida, vistaComercial } from '../../plataforma/coordinador/index.js';
import { crearEntorno, type Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { RedondeoInvalido } from '../../plataforma/funciones/servidor/redondeo.js';
import { ejecutarCotizaciones } from '../../plataforma/funciones/servidor/programadas/cotizacion.js';
import { hayEmulador, herramientas, unico, TENANT_TODO_ENCENDIDO, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const AHORA = Date.parse('2026-11-04T15:30:00Z');

/** Tenant de un solo mercado, sin tipo de cambio (documento v3, plan base). */
const UN_MERCADO = {
  estado: 'activo',
  plan: 'base',
  modulos: {},
  comercial: {
    mercados: [{ id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', zonaHoraria: 'America/Bogota', tipoCambio: null, redondeo: { tipo: 'multiplo', multiplo: 50, modo: 'cercano' } }],
    monedas: ['COP'],
  },
};

const sinRed = (llamadas: string[]): FetchLike => (url) => {
  llamadas.push(url);
  return Promise.reject(new Error('sin red'));
};

describe.skipIf(!hayEmulador)('configuración comercial del tenant (emulador)', () => {
  let h: Herramientas;
  let e: Entorno;
  beforeAll(() => {
    h = herramientas();
    e = crearEntorno({ firestore: h.firestore, auth: h.auth, bucket: h.bucket, ahora: () => AHORA, env: { PLATAFORMA_PRUEBAS: '1' } });
  });
  const sembrar = async (prefijo: string, doc: object): Promise<string> => {
    const t = unico(prefijo).toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set(doc);
    return t;
  };

  it('el tenant de tres monedas (documento anterior) recibe la derivación explícita: BO y AR, BOB, USD y ARS', async () => {
    const t = await sembrar('c3', TENANT_TODO_ENCENDIDO);
    const c = await e.comercialDelTenant(t);
    expect(c.mercados.map((m) => [m.id, m.monedaVenta, m.monedaBase, m.tipoCambio?.par])).toEqual([['BO', 'BOB', 'USD', 'BOB/USD'], ['AR', 'ARS', 'USD', 'ARS/USD']]);
    expect(c.monedas).toEqual(['BOB', 'USD', 'ARS']);
    expect(await e.redondeoDelTenant(t)).toEqual({ BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } });
    expect(await e.redondeo(t)).toEqual({ BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } });
  });

  it('un tenant de un mercado sin tipo de cambio recibe SU configuración, no la de tres monedas', async () => {
    const t = await sembrar('c1', UN_MERCADO);
    const c = await e.comercialDelTenant(t);
    expect(c.mercados.map((m) => m.id)).toEqual(['CO']);
    expect(c.monedas).toEqual(['COP']);
    expect(await e.redondeoDelTenant(t)).toEqual({ COP: { tipo: 'multiplo', multiplo: 50, modo: 'cercano' } });
    // La forma BOB/ARS de los callers de B2 a B4 no existe para este tenant: falla cerrado.
    await expect(e.redondeo(t)).rejects.toThrow(RedondeoInvalido);
  });

  it('la proyección para el panel trae mercados y monedas de caja, nunca fuentes ni par', async () => {
    const v3 = vistaComercial(await e.comercialDelTenant(await sembrar('v1', UN_MERCADO)));
    expect(v3).toEqual({ mercados: [{ id: 'CO', nombre: 'Colombia', monedaVenta: 'COP', monedaBase: 'COP', tieneTipoCambio: false }], monedasCaja: ['COP'] });
    const v = vistaComercial(await e.comercialDelTenant(await sembrar('v3', TENANT_TODO_ENCENDIDO)));
    expect(v.mercados.map((m) => m.tieneTipoCambio)).toEqual([true, true]);
    expect(JSON.stringify(v)).not.toMatch(/fuentes|par|BCB|BNA|BCRA/);
  });

  it('falla cerrado: tenant ausente, id inválido, documento inválido o mezcla de formas lanzan; nunca hay configuración por defecto', async () => {
    await expect(e.comercialDelTenant(unico('no-existe').toLowerCase())).rejects.toThrow(ComercialInvalida);
    await expect(e.comercialDelTenant('../otro')).rejects.toThrow(ComercialInvalida);
    const sin = await sembrar('inv-sin', { estado: 'activo', plan: 'base', modulos: {} });
    await expect(e.comercialDelTenant(sin)).rejects.toThrow(ComercialInvalida);
    const mezcla = await sembrar('inv-mezcla', { ...UN_MERCADO, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    await expect(e.comercialDelTenant(mezcla)).rejects.toThrow(ComercialInvalida);
    const raro = await sembrar('inv-raro', { ...TENANT_TODO_ENCENDIDO, monedas: ['COP'] });
    await expect(e.comercialDelTenant(raro)).rejects.toThrow(ComercialInvalida);
    const dos = await sembrar('inv-plan', { ...UN_MERCADO, comercial: { ...UN_MERCADO.comercial, mercados: [...UN_MERCADO.comercial.mercados, { ...UN_MERCADO.comercial.mercados[0], id: 'PE', nombre: 'Perú' }] } });
    await expect(e.comercialDelTenant(dos)).rejects.toThrow(ComercialInvalida);
  });

  it('la caché dura el TTL y se invalida a pedido', async () => {
    const t = await sembrar('cache', UN_MERCADO);
    expect((await e.comercialDelTenant(t)).mercados[0]?.nombre).toBe('Colombia');
    const otro = { ...UN_MERCADO, comercial: { ...UN_MERCADO.comercial, mercados: [{ ...UN_MERCADO.comercial.mercados[0], nombre: 'Colombia 2' }] } };
    await h.firestore.doc(`tenants/${t}`).set(otro);
    expect((await e.comercialDelTenant(t)).mercados[0]?.nombre).toBe('Colombia');
    e.comercialDelTenant.invalidar(t);
    expect((await e.comercialDelTenant(t)).mercados[0]?.nombre).toBe('Colombia 2');
  });

  it('el documento config/redondeo solo se acepta con exactamente las monedas de venta del tenant', async () => {
    const t = await sembrar('rd', UN_MERCADO);
    await h.firestore.doc(`tenants/${t}/config/redondeo`).set({ COP: { tipo: 'ninguno' } });
    expect(await e.redondeoDelTenant(t)).toEqual({ COP: { tipo: 'ninguno' } });
    const u = await sembrar('rd2', UN_MERCADO);
    await h.firestore.doc(`tenants/${u}/config/redondeo`).set({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'ninguno' } });
    await expect(e.redondeoDelTenant(u)).rejects.toThrow(RedondeoInvalido);
  });

  it('cotización programada: el tenant sin tipo de cambio no consulta fuentes ni escribe; el de tres monedas sigue igual; uno inválido no detiene a los demás', async () => {
    const uno = await sembrar('p1', UN_MERCADO);
    const tres = await sembrar('p3', TENANT_TODO_ENCENDIDO);
    const malo = await sembrar('pm', { estado: 'activo', plan: 'base', modulos: {} });
    const llamadas: string[] = [];
    const resumen = await ejecutarCotizaciones(e, { fetchFn: sinRed(llamadas) });
    expect(resumen.filter((r) => r.tenantId === uno)).toEqual([]);
    expect(resumen.filter((r) => r.tenantId === malo)).toEqual([]);
    expect(resumen.filter((r) => r.tenantId === tres).map((r) => r.mercado).sort()).toEqual(['AR', 'BO']);
    expect(llamadas.length).toBeGreaterThan(0); // las fuentes se consultaron, pero por el tenant de tres monedas
    for (const t of [uno, malo]) {
      expect((await h.firestore.doc(rutaCotizacion(t, 'BO')).get()).exists).toBe(false);
      expect((await h.firestore.collection(`tenants/${t}/alertas`).get()).size).toBe(0);
    }
  });

  it('cotización programada: si ningún tenant de la corrida tiene tipo de cambio, no se consulta ninguna fuente', async () => {
    const uno = await sembrar('s1', UN_MERCADO);
    const solo = new Proxy(h.firestore, {
      get: (obj, prop) => {
        if (prop === 'collection') {
          return (ruta: string) => {
            const col = obj.collection(ruta);
            return ruta === 'tenants' ? { listDocuments: async () => (await col.listDocuments()).filter((r) => r.id === uno) } : col;
          };
        }
        const v = Reflect.get(obj, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(obj) : v;
      },
    });
    const llamadas: string[] = [];
    const resumen = await ejecutarCotizaciones({ ...e, firestore: solo as unknown as Entorno['firestore'] }, { fetchFn: sinRed(llamadas) });
    expect(resumen).toEqual([]);
    expect(llamadas).toEqual([]);
  });
});
