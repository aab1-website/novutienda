// Existencias ocultas a `caj` y `sup` mientras hay un conteo abierto, por el callable real y por rol (emulador).
// `adm` siempre las ve; al cerrar el conteo vuelven a verse. Ninguna respuesta oculta lleva cantidades.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'vis-a';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const productosDe = (r: { resultado?: unknown }): Obj[] => cuerpo(r)['productos'] as Obj[];
const lapiz = (r: { resultado?: unknown }): Obj => productosDe(r).find((p) => p['id'] === 'lapiz') as Obj;

describe.skipIf(!hayEmulador)('inventarios: existencias ocultas durante un conteo (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const llamar = (u: Usuario, nombre: string, datos: unknown = {}) => accion('inventarios', nombre, datos, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 13 },
        { id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90000, ar: 90000 }, tienda: 3, conSerie: true, series: ['TV-001', 'TV-002', 'TV-003'] },
      ],
    });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('sin conteo abierto, todos los roles ven las cantidades y no hay marca', async () => {
    for (const u of [caj, sup, adm]) {
      const r = await llamar(u, 'listarProductos');
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(lapiz(r)['stockTotal']).toBe(13);
      expect((lapiz(r)['existencias'] as Obj)['tienda']).toBe(13);
      expect(cuerpo(r)['existenciasOcultas']).toBeUndefined();
    }
  });

  it('con un conteo abierto en la tienda: caj y sup no reciben cantidades; adm sí; el cierre restituye la vista', async () => {
    const id = unico('ct').slice(0, 30);
    const abrir = await llamar(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: id, ubicacionId: 'tienda' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);

    for (const u of [caj, sup]) {
      const r = await llamar(u, 'listarProductos');
      expect(r.status).toBe(200);
      const c = cuerpo(r);
      expect(c['existenciasOcultas']).toBe(true);
      const abiertos = c['conteosAbiertos'] as Obj[];
      expect(abiertos).toHaveLength(1);
      expect(abiertos[0]).toMatchObject({ ubicacionId: 'tienda', conteoId: id });
      expect(typeof abiertos[0]?.['abiertoEn']).toBe('string');
      const p = lapiz(r);
      expect(p['stockTotal']).toBeNull();
      expect(p['bajoMinimo']).toBeNull();
      expect(p['disponible']).toBeNull();
      expect((p['existencias'] as Obj)['tienda']).toBeNull();
      const texto = JSON.stringify(c);
      expect(texto).not.toMatch(/"(stockTotal|tienda)":(13|3)\b/);
      // soloBajoMinimo no filtra ni revela: se rechaza con motivo.
      const f = await llamar(u, 'listarProductos', { soloBajoMinimo: true });
      expect(f.status).toBe(400);
    }

    const a = await llamar(adm, 'listarProductos');
    expect(cuerpo(a)['existenciasOcultas']).toBeUndefined();
    expect(lapiz(a)['stockTotal']).toBe(13);
    expect(((await llamar(adm, 'listarProductos', { soloBajoMinimo: true })).status)).toBe(200);

    // Series: sin lista ni número de disponibles para caj/sup; adm la ve; buscarSerie sigue funcionando una a una.
    for (const u of [caj, sup]) {
      const s = await llamar(u, 'series', { productoId: 'tv', ubicacionId: 'tienda', soloDisponibles: true });
      expect(s.status).toBe(200);
      expect(cuerpo(s)['unidades']).toEqual([]);
      expect(cuerpo(s)['existenciasOcultas']).toBe(true);
      const b = await llamar(u, 'buscarSerie', { serie: 'TV-002' });
      expect((cuerpo(b)['unidades'] as Obj[])).toHaveLength(1);
      expect((cuerpo(b)['unidades'] as Obj[])[0]).toMatchObject({ serie: 'TV-002', estado: 'disponible', ubicacionId: 'tienda' });
    }
    expect((cuerpo(await llamar(adm, 'series', { productoId: 'tv', ubicacionId: 'tienda', soloDisponibles: true }))['unidades'] as Obj[])).toHaveLength(3);

    // Movimientos: el supervisor los recibe sin saldos; el administrador, completos.
    const ms = await llamar(sup, 'movimientos', { productoId: 'lapiz' });
    const filas = cuerpo(ms)['movimientos'] as Obj[];
    expect(filas.length).toBeGreaterThan(0);
    for (const m of filas) {
      expect(m['saldoUbicacion']).toBeUndefined();
      expect(m['saldoTotal']).toBeUndefined();
      expect(m['delta']).toBe(13);
    }
    expect(cuerpo(ms)['existenciasOcultas']).toBe(true);
    const ma = (cuerpo(await llamar(adm, 'movimientos', { productoId: 'lapiz' }))['movimientos'] as Obj[])[0];
    expect(ma?.['saldoUbicacion']).toBe(13);

    // Cierre: vuelven a verse. Quien cuenta registra su línea (sin recibir el teórico) y el supervisor cierra.
    const linea = await llamar(caj, 'registrarLineaConteo', { operacionId: unico('op'), conteoId: id, productoId: 'lapiz', contado: 13 });
    expect(linea.status, JSON.stringify(linea.error)).toBe(200);
    const cerrar = await llamar(sup, 'cerrarConteo', { operacionId: unico('op'), conteoId: id });
    expect(cerrar.status, JSON.stringify(cerrar.error)).toBe(200);
    const despues = await llamar(caj, 'listarProductos');
    expect(cuerpo(despues)['existenciasOcultas']).toBeUndefined();
    expect(lapiz(despues)['stockTotal']).toBeDefined();
    expect(lapiz(despues)['stockTotal']).not.toBeNull();
  });
});
