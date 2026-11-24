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
    // Textos en español y hora de La Paz: ningún código interno de tipo o de estado, y la fecha con el formato AAAA-MM-DD HH:MM.
    expect(por('Movimientos').filas.slice(1).every((f) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(f[0])) && f[1] === 'Ingreso' && f[5] === 'Ingreso')).toBe(true);
    expect(por('Series').filas.slice(1).every((f) => f[2] === 'Disponible')).toBe(true);
    // Lápiz: precio 100 USD * 7 = 700,00 BOB; costo 50 USD * 7 = 350,00 BOB; margen 50 %, con el tipo de cambio y su fecha.
    const fila = por('Costos y márgenes').filas.find((f) => f[0] === 'Lápiz HB' && f[3] === 'BOB') as (string | number)[];
    expect(fila.slice(4, 12)).toEqual([700, 'USD', 50, 350, 50, 7, hoyLaPaz(), '']);
  });

  it('limita las descargas: la sexta en una hora se rechaza con un mensaje claro y no afecta a otro usuario', async () => {
    const otro = await crearUsuario(h, { rol: 'adm', tenant: A });
    for (let i = 0; i < 5; i++) expect((await llamar(otro, 'exportarTotal')).status).toBe(200);
    const sexta = await llamar(otro, 'exportarTotal');
    expect(sexta.status).toBe(429);
    expect(sexta.error?.status).toBe('RESOURCE_EXHAUSTED');
    expect(sexta.error?.message).toMatch(/descargó el inventario completo/);
    expect((await llamar(adm, 'exportarTotal')).status).toBe(200);
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

  it('con más de 20.000 series, escribe 20.000 y lo avisa', async () => {
    const B = 'exptot-b';
    await sembrarTenant(h, B, { productos: [{ id: 'tv', nombre: 'Televisor', precioUSD: { bo: 90_000, ar: 90_000 }, tienda: 0, conSerie: true }] });
    const escritor = h.firestore.bulkWriter();
    for (let i = 0; i < 20_001; i++) {
      const serie = `S-${String(i).padStart(6, '0')}`;
      void escritor.set(h.firestore.doc(`tenants/${B}/unidades/tv__${serie}`), { productoId: 'tv', serie, estado: 'disponible', ubicacionId: 'tienda' });
    }
    await escritor.close();
    const admB = await crearUsuario(h, { rol: 'adm', tenant: B });
    const r = await accion('inventarios', 'exportarTotal', {}, admB.token, B);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cuerpo(r)['seriesRecortadas']).toBe(true);
    expect(((cuerpo(r)['hojas'] as Hoja[])[2] as Hoja).filas).toHaveLength(20_001);
  });
});
