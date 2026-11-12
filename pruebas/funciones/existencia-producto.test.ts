// Emulador: la ficha y la reserva de subida comprueban la existencia del producto con la transacción que escribe.
// Producto inexistente: se rechaza y no queda ficha ni subida; existente: funciona.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const M = 'existencia-a';
const EXISTE = 'camara-web';
const FICHA = { slug: 'camara-web', descripcion: 'Descripción', garantia: '12 meses', medios: [], seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado' };

describe.skipIf(!hayEmulador)('existencia del producto en la transacción (emulador)', () => {
  let h: Herramientas;
  let sup: Usuario;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, M, { productos: [{ id: EXISTE, nombre: 'Cámara web', marca: 'Marca de Prueba', precioUSD: { bo: 5000, ar: 5000 }, tienda: 0 }] });
    sup = await crearUsuario(h, { rol: 'sup', tenant: M });
  });

  it('guardarFicha de un producto inexistente se rechaza y no deja ningún documento de ficha', async () => {
    const r = await accion('consola', 'guardarFicha', { productoId: 'fantasma', ficha: FICHA }, sup.token, M);
    expect(r.status).toBe(404);
    expect((await h.firestore.doc(`tenants/${M}/fichasWeb/fantasma`).get()).exists).toBe(false);
  });

  it('guardarFicha de un producto existente funciona', async () => {
    const r = await accion('consola', 'guardarFicha', { productoId: EXISTE, ficha: FICHA }, sup.token, M);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect((await h.firestore.doc(`tenants/${M}/fichasWeb/${EXISTE}`).get()).exists).toBe(true);
  });

  it('reservarSubida de un producto inexistente se rechaza sin escribir; de uno existente funciona', async () => {
    const mala = unico('sub').slice(0, 38);
    const r = await accion('medios', 'reservarSubida', { subidaId: mala, productoId: 'fantasma', tipo: 'foto', bytes: 1000 }, sup.token, M);
    expect(r.status).toBe(404);
    expect((await h.firestore.doc(`tenants/${M}/subidas/${mala}`).get()).exists).toBe(false);
    const buena = unico('sub').slice(0, 38);
    const ok = await accion('medios', 'reservarSubida', { subidaId: buena, productoId: EXISTE, tipo: 'foto', bytes: 1000 }, sup.token, M);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
  });
});
