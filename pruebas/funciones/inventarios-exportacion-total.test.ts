// Descarga total del inventario por el callable real (emulador): solo el administrador, las cinco hojas, el margen con conversión y fecha,
// y la ida y vuelta (la hoja Productos, escrita como .xlsx, se reimporta sin cambios).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, hoyLaPaz, sembrarTenant, type Herramientas, type Usuario } from './ayudas.js';

// La pieza vive en el panel (carpeta `src/`): la prueba la carga por ruta, sin importación profunda estática.
const RUTA_ESCRITOR = '../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.ts';
type Escritor = typeof import('../../paquetes/panel/src/pantallas/inventarios/escritor-xlsx.js');
const { escribirXlsx } = (await import(/* @vite-ignore */ RUTA_ESCRITOR)) as Escritor;

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'exptot-a';
type Obj = Record<string, unknown>;
interface Hoja { nombre: string; filas: (string | number)[][] }
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;

describe.skipIf(!hayEmulador)('inventarios: descarga total (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  const llamar = (u: Usuario, nombre: string, datos: unknown = {}) => accion('inventarios', nombre, datos, u.token, A);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 10_000, ar: 11_000 }, tienda: 13 },
        { id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90_000, ar: 90_000 }, tienda: 2, conSerie: true, series: ['TV-001', 'TV-002'] },
      ],
    });
    await h.firestore.doc(`tenants/${A}/costos/lapiz`).set({ costoUSD: 5_000 });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
  });

  it('un supervisor no descarga todo', async () => {
    const r = await llamar(sup, 'exportarTotal');
    expect(r.status).toBe(403);
    expect(r.error?.status).toBe('PERMISSION_DENIED');
  });

  it('el administrador recibe las cinco hojas, con series, movimientos y margen con conversión y fecha', async () => {
    const r = await llamar(adm, 'exportarTotal');
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const hojas = cuerpo(r)['hojas'] as Hoja[];
    expect(hojas.map((x) => x.nombre)).toEqual(['Productos', 'Existencias por almacén', 'Series', 'Movimientos', 'Costos y márgenes']);
    expect(cuerpo(r)['recortado']).toBe(false);
    const por = (n: string): Hoja => hojas.find((x) => x.nombre === n) as Hoja;
    expect(por('Existencias por almacén').filas.slice(1).map((f) => f.slice(0, 2).concat(f[3] as never))).toEqual(
      expect.arrayContaining([['Lápiz HB', 'SKU-lapiz', 13], ['Televisor', 'SKU-tv', 2]]),
    );
    expect(por('Series').filas.slice(1).map((f) => f[1]).sort()).toEqual(['TV-001', 'TV-002']);
    expect(por('Movimientos').filas.length).toBeGreaterThanOrEqual(3);
    // Lápiz: precio 100 USD * 7 = 700,00 BOB; costo 50 USD * 7 = 350,00 BOB; margen 50 %, con el tipo de cambio y su fecha.
    const fila = por('Costos y márgenes').filas.find((f) => f[0] === 'Lápiz HB' && f[3] === 'BOB') as (string | number)[];
    expect(fila.slice(4, 12)).toEqual(['700.00', 'USD', '50.00', '350.00', 50, '7', hoyLaPaz(), '']);
  });

  it('ida y vuelta: la hoja Productos se reimporta con 0 cambios', async () => {
    const hojas = cuerpo(await llamar(adm, 'exportarTotal'))['hojas'] as Hoja[];
    const productos = hojas[0] as Hoja;
    const archivo = Buffer.from(escribirXlsx([{ nombre: productos.nombre, filas: productos.filas }])).toString('base64');
    const sim = await llamar(adm, 'importarProductosCsv', { simular: true, archivo });
    expect(sim.status, JSON.stringify(sim.error)).toBe(200);
    const filas = (cuerpo(sim)['simulacion'] as { filas: { accion: string }[] }).filas;
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.accion === 'sin-cambios')).toBe(true);
  });
});
