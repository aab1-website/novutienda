// `consola.catalogo` por rol con un conteo abierto, por el callable real (emulador): `sup` recibe la marca y `null`; `adm`, todo.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'vis-cat';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const lapiz = (r: { resultado?: unknown }): Obj => (cuerpo(r)['productos'] as Obj[]).find((p) => p['id'] === 'lapiz') as Obj;

describe.skipIf(!hayEmulador)('consola.catalogo: existencias ocultas durante un conteo (emulador)', () => {
  let adm: Usuario;
  let sup: Usuario;
  let h: Herramientas;
  const catalogo = (u: Usuario) => accion('consola', 'catalogo', {}, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 13 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
  });

  it('sin conteo todos ven todo; con conteo en la tienda sup recibe null y marca, adm todo; en otro almacén stockTotal null y disponible visible', async () => {
    for (const u of [sup, adm]) {
      const r = await catalogo(u);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(lapiz(r)).toMatchObject({ stockTotal: 13, disponible: true });
      expect(cuerpo(r)['existenciasOcultas']).toBeUndefined();
    }
    const id = unico('ct').slice(0, 30);
    const abrir = await accion('inventarios', 'abrirConteo', { operacionId: unico('op'), conteoId: id, ubicacionId: 'tienda' }, sup.token, A);
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);

    const rs = await catalogo(sup);
    expect(cuerpo(rs)['existenciasOcultas']).toBe(true);
    expect((cuerpo(rs)['conteosAbiertos'] as Obj[])[0]).toMatchObject({ ubicacionId: 'tienda', conteoId: id });
    expect(lapiz(rs)).toMatchObject({ stockTotal: null, disponible: null });
    expect(JSON.stringify(cuerpo(rs))).not.toMatch(/"stockTotal":13\b/);

    const ra = await catalogo(adm);
    expect(cuerpo(ra)['existenciasOcultas']).toBeUndefined();
    expect(lapiz(ra)).toMatchObject({ stockTotal: 13, disponible: true });

    // Cierre: vuelve a verse.
    await accion('inventarios', 'registrarLineaConteo', { operacionId: unico('op'), conteoId: id, productoId: 'lapiz', contado: 13 }, sup.token, A);
    const c = await accion('inventarios', 'cerrarConteo', { operacionId: unico('op'), conteoId: id }, sup.token, A);
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    expect(lapiz(await catalogo(sup))).toMatchObject({ stockTotal: 13, disponible: true });
  });
});
