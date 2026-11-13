// Durante un conteo abierto que alcanza al almacén del faltante, el rechazo por stock insuficiente no entrega a `caj` ni `sup`
// la lista de faltantes (solo `{ codigo, faltantesOcultos }` y un mensaje sin productos) y un traspaso desde o hacia ese almacén
// se rechaza con `conteo-abierto` (venta del POS, merma y traspaso), por los callables reales (emulador). `adm` recibe siempre
// la lista y puede traspasar.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, uuid, type RespuestaLlamada, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'sto-a';
type Obj = Record<string, unknown>;
const faltantes = (r: RespuestaLlamada): Obj[] => ((r.error as { details?: { faltantes?: Obj[] } } | undefined)?.details?.faltantes ?? []) as Obj[];

describe.skipIf(!hayEmulador)('stock insuficiente: la cantidad se oculta durante un conteo (emulador)', () => {
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  const inv = (u: Usuario, nombre: string, datos: unknown) => accion('inventarios', nombre, datos, u.token, A);

  /** Un solo turno por caja: cada intento abre el suyo, vende y lo cierra. */
  async function venta(u: Usuario): Promise<RespuestaLlamada> {
    const turnoId = uuid();
    const t = await accion('pos', 'abrirTurno', { turnoId, apertura: { BOB: 1000 } }, u.token, A);
    expect(t.status, JSON.stringify(t.error)).toBe(200);
    const r = await accion('pos', 'confirmarVenta', {
      requestId: uuid(),
      carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 3 }] },
      pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 21_000 }],
    }, u.token, A);
    const c = await accion('pos', 'cerrarTurno', { turnoId, contado: { BOB: 1000 } }, u.token, A);
    expect(c.status, JSON.stringify(c.error)).toBe(200);
    return r;
  }
  const merma = (u: Usuario) => inv(u, 'solicitarMerma', { operacionId: unico('m'), productoId: 'lapiz', ubicacionId: 'tienda', cantidad: 3, motivo: 'Prueba' });
  const traspasoA = (destinoId: string) => (u: Usuario) => inv(u, 'traspasar', { operacionId: unico('t'), origenId: 'tienda', destinoId, lineas: [{ productoId: 'lapiz', cantidad: 3 }] });
  const traspaso = traspasoA('deposito-2');

  /** Cada origen devuelve el rechazo de stock; `disponible` es la cantidad real (2). */
  const origenes: [string, (u: Usuario) => Promise<RespuestaLlamada>, readonly string[]][] = [
    ['venta', venta, ['caj', 'sup', 'adm']],
    ['merma', merma, ['caj', 'sup', 'adm']],
    ['traspaso', traspaso, ['sup', 'adm']],
  ];
  const quien = (r: string): Usuario => (r === 'caj' ? caj : r === 'sup' ? sup : adm);

  async function verifica(visibleParaNoAdm: boolean): Promise<void> {
    for (const [nombre, llamar, roles] of origenes) {
      for (const rol of roles) {
        // Con conteo en la tienda, el traspaso de `sup` ya no llega a la validación de stock: lo cubre la prueba de `conteo-abierto`.
        if (nombre === 'traspaso' && !visibleParaNoAdm && rol !== 'adm') continue;
        const r = await llamar(quien(rol));
        const etiqueta = `${nombre}/${rol}: ${JSON.stringify(r.error)}`;
        expect(r.status, etiqueta).toBe(400);
        const det = (r.error as { details?: Obj }).details ?? {};
        expect(det['codigo'], etiqueta).toBe('stock-insuficiente');
        const ve = rol === 'adm' || visibleParaNoAdm;
        if (ve) {
          const f = faltantes(r);
          expect(f, etiqueta).toHaveLength(1);
          expect(f[0], etiqueta).toMatchObject({ productoId: 'lapiz', almacenId: 'tienda', pedido: 3, disponible: 2 });
        } else {
          // Sin lista, ids, cantidades ni número de líneas: solo el código y el aviso; el texto tampoco nombra el producto.
          expect(det, etiqueta).toEqual({ codigo: 'stock-insuficiente', faltantesOcultos: true });
          expect(JSON.stringify(r.error), etiqueta).not.toMatch(/lapiz|disponible|pedido|faltantes"|"existencias?"/);
        }
      }
    }
  }

  beforeAll(async () => {
    const h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 2 }, { id: 'goma', nombre: 'Goma', precioUSD: { bo: 1000, ar: 1000 }, tienda: 0 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('sin conteo abierto todos reciben la cantidad, como hoy', async () => {
    await verifica(true);
  });

  it('un conteo abierto en OTRO almacén no recorta el faltante de la tienda ni bloquea el traspaso a un tercero', async () => {
    const abrir = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'deposito-1' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
    await verifica(true);
  });

  it('con un conteo en un almacén, sup no traspasa desde ni hacia él (conteo-abierto, sin cantidades); adm sí', async () => {
    for (const [destino, origen] of [['deposito-1', 'tienda'], ['tienda', 'deposito-1']] as const) {
      // Con y sin stock suficiente en el origen la respuesta es la misma.
      const resp = [];
      for (const cantidad of [1, 999]) {
        const r = await inv(sup, 'traspasar', { operacionId: unico('t'), origenId: origen, destinoId: destino, lineas: [{ productoId: 'lapiz', cantidad }] });
        expect(r.status, JSON.stringify(r.error)).toBe(400);
        const e = r.error as { message?: string; details?: Obj };
        expect(e.details).toMatchObject({ codigo: 'conteo-abierto', ubicacionId: 'deposito-1' });
        expect(Object.keys(e.details ?? {}).sort()).toEqual(['abiertoEn', 'codigo', 'conteoId', 'ubicacionId']);
        expect(e.message).not.toMatch(/lapiz|\d{2,}/);
        resp.push(JSON.stringify(r.error));
      }
      expect(resp[1]).toBe(resp[0]);
    }
    const ok = await inv(adm, 'traspasar', { operacionId: unico('t'), origenId: 'tienda', destinoId: 'deposito-1', lineas: [{ productoId: 'lapiz', cantidad: 1 }] });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    const vuelta = await inv(adm, 'traspasar', { operacionId: unico('t'), origenId: 'deposito-1', destinoId: 'tienda', lineas: [{ productoId: 'lapiz', cantidad: 1 }] });
    expect(vuelta.status, JSON.stringify(vuelta.error)).toBe(200);
  });

  it('con un conteo abierto en el almacén del faltante, caj y sup no reciben la lista (y la línea sin stock no cambia la respuesta); adm sí', async () => {
    const abrir = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'tienda' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
    await verifica(false);
    // Línea objetivo con stock (1 de 2) + línea de un producto sin stock vs. línea objetivo sin stock (3 de 2) + la misma: respuesta idéntica.
    const venta2 = async (cantidad: number): Promise<string> => {
      const turnoId = uuid();
      await accion('pos', 'abrirTurno', { turnoId, apertura: { BOB: 1000 } }, caj.token, A);
      const r = await accion('pos', 'confirmarVenta', {
        requestId: uuid(),
        carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad }, { productoId: 'goma', cantidad: 5 }] },
        pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 99_000 }],
      }, caj.token, A);
      await accion('pos', 'cerrarTurno', { turnoId, contado: { BOB: 1000 } }, caj.token, A);
      expect(r.status, JSON.stringify(r.error)).toBe(400);
      return JSON.stringify(r.error);
    };
    expect(await venta2(1)).toBe(await venta2(3));
  });
});
