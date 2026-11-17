// Cancelar un conteo (solo adm, con motivo) y cerrar eligiendo qué hacer con lo no contado, por los callables reales (emulador).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'cnc-a';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;

describe.skipIf(!hayEmulador)('conteo: cancelar y cierre con elección de no contados (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const inv = (u: Usuario, nombre: string, datos: unknown) => accion('inventarios', nombre, datos, u.token, A);
  const abrir = async (ubicacionId: string): Promise<string> => {
    const conteoId = unico('cnt');
    const r = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId, ubicacionId });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    return conteoId;
  };
  const contar = (conteoId: string, productoId: string, contado: number) =>
    inv(caj, 'registrarLineaConteo', { operacionId: unico('op'), conteoId, productoId, contado });

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 10 }, { id: 'goma', nombre: 'Goma', precioUSD: { bo: 500, ar: 500 }, tienda: 4 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('solo adm cancela: sup y caj reciben permission-denied', async () => {
    const conteoId = await abrir('tienda');
    for (const u of [sup, caj]) {
      const r = await inv(u, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Prueba' });
      expect(r.status).toBe(403);
    }
    const ok = await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Prueba' });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });

  it('rechaza motivo vacío o largo y sinContar fuera del enum', async () => {
    const conteoId = await abrir('deposito-1');
    for (const motivo of ['', '   ', 'x'.repeat(501)]) {
      expect((await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo })).status).toBe(400);
    }
    expect((await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId })).status).toBe(400);
    expect((await inv(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId, sinContar: 'x' })).status).toBe(400);
    expect((await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Limpieza' })).status).toBe(200);
  });

  it('sin sinContar el cierre usa «igual»: lo no contado no cambia y no hay mermas', async () => {
    const conteoId = await abrir('tienda');
    expect((await contar(conteoId, 'lapiz', 9)).status).toBe(200);
    const cierre = await inv(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId });
    expect(cierre.status, JSON.stringify(cierre.error)).toBe(200);
    expect((await h.firestore.doc(`tenants/${A}/mermas/${conteoId}-goma`).get()).exists).toBe(false);
  });

  it('cierre sin líneas y sin elegir: rechazado; el conteo sigue abierto y adm lo cancela', async () => {
    const conteoId = await abrir('tienda');
    const cierre = await inv(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId });
    expect(cierre.status).toBe(400);
    expect(JSON.stringify(cierre.error)).toMatch(/No hay productos contados/);
    const c = await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Nadie contó' });
    expect(c.status, JSON.stringify(c.error)).toBe(200);
  });

  it('el conteo cancelado se lee sin resultado ni productos para ningún rol, y ya no se puede cerrar ni cancelar', async () => {
    const conteoId = await abrir('tienda');
    expect((await contar(conteoId, 'lapiz', 3)).status).toBe(200);
    const c = await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Se contó mal' });
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    for (const u of [caj, sup, adm]) {
      const vista = cuerpo(await inv(u, 'conteo', { conteoId }));
      expect(vista['productos']).toBeUndefined();
      expect(vista['resultado']).toBeUndefined();
      expect(vista['faltan']).toBeUndefined();
      expect(vista['conteo']).toMatchObject({ estado: 'cancelado' });
    }
    expect((await inv(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId, sinContar: 'cero' })).status).toBeGreaterThanOrEqual(400);
    expect((await inv(adm, 'cancelarConteo', { operacionId: unico('op'), conteoId, motivo: 'Otra vez' })).status).toBeGreaterThanOrEqual(400);
    const lista = cuerpo(await inv(adm, 'conteos', { estado: 'cancelado' }));
    expect(JSON.stringify(lista)).toContain(conteoId);
  });
});
