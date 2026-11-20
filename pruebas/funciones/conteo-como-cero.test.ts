// Cierre «como 0» (humo2, D9): deja las líneas y los teóricos de lo no contado; sup y adm las ven con su resultado y caj no, ni en
// las líneas ni en la lista de productos del conteo. Callables reales (emulador).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'cco-a';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;

describe.skipIf(!hayEmulador)('conteo cerrado «como 0»: qué ve cada rol (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let conteoId = '';
  const inv = (u: Usuario, nombre: string, datos: unknown) => accion('inventarios', nombre, datos, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 10 }, { id: 'goma', nombre: 'Goma', precioUSD: { bo: 500, ar: 500 }, tienda: 4 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    conteoId = unico('cco');
    expect((await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId, ubicacionId: 'tienda' })).status).toBe(200);
    expect((await inv(caj, 'registrarLineaConteo', { operacionId: unico('op'), conteoId, productoId: 'lapiz', contado: 10 })).status).toBe(200);
    const cierre = await inv(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId, sinContar: 'cero' });
    expect(cierre.status, JSON.stringify(cierre.error)).toBe(200);
    const res = cuerpo(cierre)['resultado'] as Obj;
    expect(res['sinContar']).toEqual(['goma']);
    expect((res['avisos'] as string[]).join(' ')).toContain('Goma (SKU SKU-goma)');
  });

  it('el cierre deja la línea en 0 y el teórico de lo no contado', async () => {
    expect((await h.firestore.doc(`tenants/${A}/conteoLineas/${conteoId}__goma`).get()).data()).toMatchObject({ contado: 0, series: [], origen: 'cierre-como-cero' });
    expect((await h.firestore.doc(`tenants/${A}/conteoTeoricos/${conteoId}__goma`).get()).data()).toMatchObject({ cantidad: 4 });
  });

  it('sup y adm ven la fila en 0 y su diferencia', async () => {
    for (const u of [sup, adm]) {
      const v = cuerpo(await inv(u, 'conteo', { conteoId }));
      expect((v['lineas'] as Obj[]).map((l) => l['productoId']).sort()).toEqual(['goma', 'lapiz']);
      expect(v['resultado']).toContainEqual({ productoId: 'goma', teorico: 4, contado: 0, diferencia: -4 });
      expect((v['conteo'] as Obj)['productos']).toContain('goma');
    }
  });

  it('caj no ve la fila generada por el cierre, ni el producto en la lista; sí lo que contó', async () => {
    const v = cuerpo(await inv(caj, 'conteo', { conteoId }));
    expect((v['lineas'] as Obj[]).map((l) => l['productoId'])).toEqual(['lapiz']);
    expect((v['conteo'] as Obj)['productos']).toEqual(['lapiz']);
    expect(v).not.toHaveProperty('resultado');
    expect(JSON.stringify(v)).not.toContain('cierre-como-cero');
    expect(v['conteo']).not.toHaveProperty('mermas');
  });

  it('la lista `conteos` aplica lo mismo: caj no recibe los productos como 0 ni `mermas`; sup y adm, el documento completo', async () => {
    const de = (r: { resultado?: unknown }): Obj => ((cuerpo(r)['conteos'] as Obj[]).find((x) => x['id'] === conteoId)) as Obj;
    const vistaCaj = de(await inv(caj, 'conteos', { estado: 'cerrado' }));
    expect(vistaCaj['productos']).toEqual(['lapiz']);
    expect(vistaCaj).not.toHaveProperty('mermas');
    expect(JSON.stringify(vistaCaj)).not.toContain('goma');
    for (const u of [sup, adm]) {
      const completa = de(await inv(u, 'conteos', { estado: 'cerrado' }));
      expect(completa['productos']).toContain('goma');
      expect(completa['mermas']).toContain(`${conteoId}-goma`);
    }
  });
});
