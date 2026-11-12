// «Cambios sin publicar» contra el emulador: crear, editar y cambiar precio por `inventarios.*` y por `consola.*` suman uno
// cada uno (evento `producto.cambiado` entregado por el disparador `eventos`); con la consola apagada no cuenta ni falla.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, esperar, hayEmulador, herramientas, sembrarTenant, uuid, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const A = 'cambios-a';
const APAGADA = 'cambios-sin-consola';

describe.skipIf(!hayEmulador)('cambios de producto -> sitio/estado (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let admSin: Usuario;

  const cambios = async (t: string): Promise<number> => ((await h.firestore.doc(`tenants/${t}/sitio/estado`).get()).data()?.['cambios'] as number | undefined) ?? 0;
  /** Espera a que el contador llegue a `esperado` y confirma que no pasa de ahí. */
  const llegaA = async (t: string, esperado: number): Promise<void> => {
    await esperar(async () => (await cambios(t)) >= esperado, 30_000, `cambios >= ${String(esperado)}`);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await cambios(t)).toBe(esperado);
  };
  const ok = (r: { status: number; error?: unknown }): void => expect(r.status, JSON.stringify(r.error)).toBe(200);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A);
    await sembrarTenant(h, APAGADA);
    await h.firestore.doc(`tenants/${APAGADA}`).update({ modulos: { inventarios: { version: '0.1.0', submodulos: [] } } });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    admSin = await crearUsuario(h, { rol: 'adm', tenant: APAGADA });
  });

  it('inventarios.crearProducto, editarProducto y cambiarPrecioUSD suman 1 cada uno', async () => {
    const antes = await cambios(A);
    ok(await accion('inventarios', 'crearProducto', { operacionId: uuid(), producto: { id: 'inv-1', nombre: 'Inv uno', categoria: 'general', sku: 'SKU-INV-1', precioUSD: { bo: 1000, ar: 1000 } } }, adm.token, A));
    await llegaA(A, antes + 1);
    ok(await accion('inventarios', 'editarProducto', { operacionId: uuid(), productoId: 'inv-1', cambios: { nombre: 'Inv uno b' } }, adm.token, A));
    await llegaA(A, antes + 2);
    ok(await accion('inventarios', 'cambiarPrecioUSD', { operacionId: uuid(), productoId: 'inv-1', precioUSD: { bo: 2000, ar: 2000 } }, adm.token, A));
    await llegaA(A, antes + 3);
  });

  it('consola.crearProducto, editarProducto y cambiarPrecioUSD suman 1 cada uno', async () => {
    const antes = await cambios(A);
    ok(await accion('consola', 'crearProducto', { productoId: 'con-1', datos: { nombre: 'Con uno', categoria: 'general', activo: true }, precioUSD: { bo: 5, ar: 5 } }, adm.token, A));
    await llegaA(A, antes + 1);
    ok(await accion('consola', 'editarProducto', { productoId: 'con-1', cambios: { nombre: 'Con uno b' } }, adm.token, A));
    await llegaA(A, antes + 2);
    ok(await accion('consola', 'cambiarPrecioUSD', { productoId: 'con-1', precioUSD: { bo: 6, ar: 6 } }, adm.token, A));
    await llegaA(A, antes + 3);
  });

  it('inventarios.importarProductosCsv de 3 productos suma 3', async () => {
    const antes = await cambios(A);
    const csv = ['id,nombre,categoria,sku,precioUSDbo,precioUSDar', ...[1, 2, 3].map((n) => `imp-${String(n)},Imp ${String(n)},general,SKU-IMP-${String(n)},10,10`)].join('\n');
    ok(await accion('inventarios', 'importarProductosCsv', { operacionId: uuid(), csv }, adm.token, A));
    await llegaA(A, antes + 3);
  });

  it('con la consola apagada el alta de Inventarios no falla y no cuenta', async () => {
    ok(await accion('inventarios', 'crearProducto', { operacionId: uuid(), producto: { id: 'sin-1', nombre: 'Sin uno', categoria: 'general', sku: 'SKU-SIN-1', precioUSD: { bo: 1000, ar: 1000 } } }, admSin.token, APAGADA));
    await esperar(async () => (await h.firestore.collection(`tenants/${APAGADA}/eventos`).where('tipo', '==', 'producto.cambiado').get()).size >= 1, 30_000, 'evento publicado');
    await new Promise((r) => setTimeout(r, 2500));
    expect(await cambios(APAGADA)).toBe(0);
  });
});
