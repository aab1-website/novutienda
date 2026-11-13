// Con un conteo abierto, `caj` y `sup` no deben poder deducir las existencias SIN efectos: ni con una venta de N series
// inventadas, ni con un traspaso cuya segunda línea es inválida, ni contando las unidades de `series` variando `limite`.
// Callables reales (emulador): la respuesta de cada pedido es idéntica con stock que alcanza y con stock que no.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, uuid, type RespuestaLlamada, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'orc-a';
const pu = { bo: 1000, ar: 1000 };

/** La respuesta sin el nombre del producto (cada mundo usa el suyo): status, código, mensaje y detalles. */
const huella = (r: RespuestaLlamada, ...ids: string[]): string => {
  let s = JSON.stringify({ status: r.status, error: r.error });
  for (const id of ids) s = s.split(id).join('<p>');
  return s;
};

describe.skipIf(!hayEmulador)('oráculos de existencias sin efectos durante un conteo (emulador)', () => {
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const inv = (u: Usuario, nombre: string, datos: unknown) => accion('inventarios', nombre, datos, u.token, A);

  async function conTurno<R>(u: Usuario, f: () => Promise<R>): Promise<R> {
    const turnoId = uuid();
    expect((await accion('pos', 'abrirTurno', { turnoId, apertura: { BOB: 1000 } }, u.token, A)).status).toBe(200);
    const r = await f();
    expect((await accion('pos', 'cerrarTurno', { turnoId, contado: { BOB: 1000 } }, u.token, A)).status).toBe(200);
    return r;
  }
  const venta = (u: Usuario, lineas: unknown[]) =>
    conTurno(u, () =>
      accion('pos', 'confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 * lineas.reduce((a: number, l) => a + (l as { cantidad: number }).cantidad, 0) }] }, u.token, A),
    );
  const traspaso = (u: Usuario, lineas: unknown[]) => inv(u, 'traspasar', { operacionId: unico('t'), origenId: 'tienda', destinoId: 'deposito-1', lineas });

  beforeAll(async () => {
    const h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'cel-rico', nombre: 'Celular rico', precioUSD: pu, tienda: 6, conSerie: true, series: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] },
        { id: 'cel-pobre', nombre: 'Celular pobre', precioUSD: pu, tienda: 1, conSerie: true, series: ['P1'] },
        { id: 'lap-rico', nombre: 'Lápiz rico', precioUSD: pu, tienda: 10 },
        { id: 'lap-pobre', nombre: 'Lápiz pobre', precioUSD: pu, tienda: 1 },
      ],
    });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    // Una unidad vendida (visible para todos) y un conteo abierto en la tienda.
    const v = await venta(caj, [{ productoId: 'cel-rico', cantidad: 1, series: ['R6'] }]);
    expect(v.status, JSON.stringify(v.error)).toBe(200);
    const abrir = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'tienda' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
  });

  it('venta con 3 series inventadas: la respuesta es idéntica con stock 5 y con stock 1', async () => {
    for (const u of [caj, sup]) {
      const lin = (id: string) => [{ productoId: id, cantidad: 3, series: ['X1', 'X2', 'X3'] }];
      const rico = await venta(u, lin('cel-rico'));
      const pobre = await venta(u, lin('cel-pobre'));
      expect(rico.status).toBe(400);
      expect(huella(pobre, 'cel-pobre')).toBe(huella(rico, 'cel-rico'));
      expect(JSON.stringify(rico.error)).not.toMatch(/stock-insuficiente/);
    }
  });

  it('venta con una línea sin stock y otra con serie inventada: mismo error con y sin stock en la primera', async () => {
    const r1 = await venta(sup, [{ productoId: 'lap-rico', cantidad: 5 }, { productoId: 'cel-pobre', cantidad: 1, series: ['X'] }]);
    const r2 = await venta(sup, [{ productoId: 'lap-pobre', cantidad: 5 }, { productoId: 'cel-pobre', cantidad: 1, series: ['X'] }]);
    expect(r1.status).toBe(400);
    expect(huella(r2, 'lap-pobre')).toBe(huella(r1, 'lap-rico'));
  });

  it('traspaso con la línea 2 inválida: la respuesta es idéntica con stock 10 y con stock 1 en la línea 1', async () => {
    for (const inval of [{ productoId: 'cel-pobre', cantidad: 1 }, { productoId: 'cel-pobre', cantidad: 1, series: ['X'] }, { productoId: 'nada', cantidad: 1 }]) {
      const rico = await traspaso(sup, [{ productoId: 'lap-rico', cantidad: 5 }, inval]);
      const pobre = await traspaso(sup, [{ productoId: 'lap-pobre', cantidad: 5 }, inval]);
      expect(rico.status, JSON.stringify(rico.error)).toBe(400);
      expect(huella(pobre, 'lap-pobre')).toBe(huella(rico, 'lap-rico'));
    }
  });

  it('series: variar `limite` no cuenta las unidades ocultas para caj y sup; adm las ve', async () => {
    for (const u of [caj, sup]) {
      const filas = async (limite?: number) => {
        const r = await inv(u, 'series', { productoId: 'cel-rico', ...(limite !== undefined ? { limite } : {}) });
        expect(r.status, JSON.stringify(r.error)).toBe(200);
        const res = r.resultado as { unidades: { serie: string; estado: string }[]; existenciasOcultas?: boolean };
        expect(res.existenciasOcultas).toBe(true);
        return res.unidades.map((x) => `${x.serie}:${x.estado}`);
      };
      // Solo la vendida es visible: con cualquier límite sale ella (antes, `limite: 1` devolvía una oculta y salía vacío).
      for (const l of [1, 2, 5, 200, undefined]) expect(await filas(l), `${u.correo} limite=${String(l)}`).toEqual(['R6:vendida']);
    }
    const r = await inv(adm, 'series', { productoId: 'cel-rico', limite: 2 });
    expect((r.resultado as { unidades: unknown[] }).unidades).toHaveLength(2);
  });
});
