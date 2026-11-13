// `leerProductoEnTransaccion` del catálogo real: la publicación relee cada producto con la MISMA transacción que escribe la copia
// `publicado/`. Un cambio de precio de Inventarios posterior a la lectura previa (`listarProductos`) o hecho durante la transacción
// (conflicto: el doble reintenta, como Firestore) llega a la copia publicada; nunca se publica el precio viejo.
import { publicarSitio, type CatalogoPuerto } from '@novutienda/consola';
import { actualizarProducto } from '@novutienda/inventarios';
import type { Actor } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADM, T, altaProducto, entornoListo, op, producto, type Entorno } from './entorno.js';

type DepsPublicar = Parameters<typeof publicarSitio>[0];
const adm: Actor = { uid: 'u-adm', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: 'adm' }, v: 1 } } };
let e: Entorno;

const cambiarPrecio = (productoId: string, bo: number): Promise<unknown> =>
  e.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('precio'), por: ADM, productoId, cambios: { precioUSD: { bo, ar: bo } } }));

const sembrarSitio = async (): Promise<void> => {
  await altaProducto(e, T, producto('tele', { nombre: 'Tele', marca: 'Aurora', precioUSD: { bo: 10000, ar: 10000 } }));
  e.db.poner(`tenants/${T}/sitio/config`, { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {} });
  e.db.poner(`tenants/${T}/sitio/indice`, { secciones: [] });
  const ruta = `tenants/${T}/publico/medios/tele/m1-imagen960.webp`;
  e.db.poner(`tenants/${T}/medios/medio-tele-1`, {
    id: 'medio-tele-1', productoId: 'tele', tipo: 'foto', formatoOriginal: 'jpeg', bytesOriginal: 1000, rutaOriginal: 'x', ancho: 1600, alto: 900, creadoEn: 1, por: 'u',
    versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta, bytes: 100 }],
  });
  e.db.poner(`tenants/${T}/fichasWeb/tele`, {
    productoId: 'tele', slug: 'tele', descripcion: 'Descripción.', garantia: '12 meses', medios: [{ medioId: 'medio-tele-1', alt: 'Foto' }],
    seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado',
  });
};

const deps = (catalogo: CatalogoPuerto): DepsPublicar => ({
  db: e.db, catalogo, reloj: { ahora: () => e.reloj.ahora },
  disparador: { programar: async () => undefined, reconstruir: async () => undefined } as unknown as DepsPublicar['disparador'],
});
const precioPublicado = (): unknown => (e.db.dato(`tenants/${T}/publicado/producto__tele`) as { precioUSD: unknown } | undefined)?.precioUSD;

beforeEach(async () => {
  e = await entornoListo();
  await sembrarSitio();
});

describe('leerProductoEnTransaccion con el catálogo real', () => {
  it('devuelve los datos mínimos (precio en USD decimales, marca solo si existe) y undefined si no existe, sin leer existencias', async () => {
    const t = await e.db.runTransaction((tx) => e.catalogoConsola.leerProductoEnTransaccion(tx, T, 'tele'));
    expect(t).toEqual({ id: 'tele', nombre: 'Tele', categoria: 'general', marca: 'Aurora', activo: true, precioUSD: { bo: 100, ar: 100 } });
    const sinMarca = await e.db.runTransaction((tx) => e.catalogoConsola.leerProductoEnTransaccion(tx, T, 'lapiz'));
    expect(sinMarca).toBeDefined();
    expect(sinMarca).not.toHaveProperty('marca');
    expect(await e.db.runTransaction((tx) => e.catalogoConsola.leerProductoEnTransaccion(tx, T, 'no-existe'))).toBeUndefined();
  });

  it('un cambio de precio entre la lectura previa y la transacción de publicación queda reflejado en la copia publicada', async () => {
    const real = e.catalogoConsola;
    const catalogo: CatalogoPuerto = {
      ...real,
      listarProductos: async (t) => {
        const lista = await real.listarProductos(t);
        await cambiarPrecio('tele', 20000); // Inventarios cambia el precio justo después de la lectura previa
        return lista;
      },
    };
    await publicarSitio(deps(catalogo), { tenantId: T, actor: adm });
    expect(precioPublicado()).toEqual({ bo: 200, ar: 200 });
  });

  it('un cambio de precio DURANTE la transacción provoca el reintento y se publica el precio nuevo', async () => {
    const real = e.catalogoConsola;
    let cambiado = false;
    const catalogo: CatalogoPuerto = {
      ...real,
      leerProductoEnTransaccion: async (tx, t, id) => {
        const leido = await real.leerProductoEnTransaccion(tx, t, id);
        if (!cambiado && id === 'tele') { cambiado = true; await cambiarPrecio('tele', 30000); }
        return leido;
      },
    };
    const antes = e.db.reintentos;
    await publicarSitio(deps(catalogo), { tenantId: T, actor: adm });
    // La lectura transaccional entró al control de conflictos: el commit detectó el cambio, reintentó y la segunda pasada leyó 300.
    expect(e.db.reintentos).toBe(antes + 1);
    expect(precioPublicado()).toEqual({ bo: 300, ar: 300 });
  });
});
