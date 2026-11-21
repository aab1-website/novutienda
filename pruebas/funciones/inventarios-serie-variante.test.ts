// Paso 25: el callable `ingresar` rechaza una serie que ya existe en el mismo producto con otras mayúsculas
// (`already-exists`, «Ya existe como X»), por el callable real y el emulador. Otro producto sí la admite.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = unico('variante').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 30);

describe.skipIf(!hayEmulador)('inventarios: ingreso de una variante de mayúsculas (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  const ingresar = (productoId: string, series: string[]) =>
    accion('inventarios', 'ingresar', { operacionId: unico('op'), ubicacionId: 'tienda', lineas: [{ productoId, cantidad: series.length, series }] }, adm.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'cam', nombre: 'Cámara', precioUSD: { bo: 90000, ar: 90000 }, tienda: 1, conSerie: true, series: ['HUMO2-S001'] },
        { id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90000, ar: 90000 }, tienda: 0, conSerie: true },
      ],
    });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
  });

  it('rechaza la variante con already-exists y «Ya existe como X», sin guardar nada', async () => {
    const r = await ingresar('cam', ['humo2-s001', 'NUEVA-777']);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r)).toContain('Ya existe como HUMO2-S001');
    expect((await h.firestore.doc(`tenants/${A}/unidades/cam__NUEVA-777`).get()).exists).toBe(false);
  });

  it('otro producto admite la misma serie, y una serie distinta entra', async () => {
    expect((await ingresar('tv', ['humo2-s001'])).status).toBe(200);
    expect((await ingresar('cam', ['OTRA-0002'])).status).toBe(200);
  });
});
