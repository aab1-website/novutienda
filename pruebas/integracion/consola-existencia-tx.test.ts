// El puerto `existeProductoEnTransaccion` del catálogo real: la ficha y la reserva de subida leen la existencia
// del producto con la MISMA transacción que escribe, y un producto inexistente se rechaza sin escribir nada.
import { guardarFicha, reservarSubida, type DepsMedios } from '@novutienda/consola';
import type { Actor } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { T, entornoListo, type Entorno } from './entorno.js';

const sup: Actor = { uid: 'u-sup', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: 'sup' }, v: 1 } } };
const ficha = { slug: 'lapiz-hb', descripcion: 'Descripción', garantia: '12 meses', medios: [], seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado' } as const;
const SUBIDA = 'a'.repeat(32);
let e: Entorno;

const deps = (): DepsMedios => ({
  db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora },
  almacen: {} as DepsMedios['almacen'], procesador: {} as DepsMedios['procesador'],
});
const escrituras = (): number => e.db.coleccion(`tenants/${T}/fichasWeb`).length + e.db.coleccion(`tenants/${T}/subidas`).length;

beforeEach(async () => {
  e = await entornoListo();
});

describe('existeProductoEnTransaccion con el catálogo real', () => {
  it('lee el producto de Inventarios con la transacción recibida', async () => {
    expect(await e.db.runTransaction((tx) => e.catalogoConsola.existeProductoEnTransaccion(tx, T, 'lapiz'))).toBe(true);
    expect(await e.db.runTransaction((tx) => e.catalogoConsola.existeProductoEnTransaccion(tx, T, 'no-existe'))).toBe(false);
  });

  it('guardar la ficha de un producto inexistente se rechaza y no queda ningún documento', async () => {
    const antes = escrituras();
    await expect(guardarFicha(deps(), { tenantId: T, actor: sup, productoId: 'fantasma', ficha })).rejects.toMatchObject({ codigo: 'no-encontrado' });
    expect(escrituras()).toBe(antes);
    expect(e.db.dato(`tenants/${T}/fichasWeb/fantasma`)).toBeUndefined();
  });

  it('guardar la ficha de un producto existente funciona', async () => {
    await guardarFicha(deps(), { tenantId: T, actor: sup, productoId: 'lapiz', ficha });
    expect(e.db.dato(`tenants/${T}/fichasWeb/lapiz`)).toMatchObject({ slug: 'lapiz-hb' });
  });

  it('reservar una subida para un producto inexistente se rechaza sin escribir; para uno existente funciona', async () => {
    const antes = escrituras();
    await expect(reservarSubida(deps(), { tenantId: T, actor: sup, subidaId: SUBIDA, productoId: 'fantasma', tipo: 'foto', bytes: 1000 })).rejects.toMatchObject({ codigo: 'no-encontrado' });
    expect(escrituras()).toBe(antes);
    const r = await reservarSubida(deps(), { tenantId: T, actor: sup, subidaId: SUBIDA, productoId: 'lapiz', tipo: 'foto', bytes: 1000 });
    expect(r.subidaId).toBe(SUBIDA);
    expect(escrituras()).toBe(antes + 1);
  });
});
