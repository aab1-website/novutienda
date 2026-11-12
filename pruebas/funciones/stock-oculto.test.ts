// El rechazo por stock insuficiente no revela la cantidad a `caj` ni `sup` mientras hay un conteo abierto que alcanza al almacén
// del faltante (venta del POS, merma y traspaso), por los callables reales (emulador). `adm` la recibe siempre.
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
  const traspaso = (u: Usuario) => inv(u, 'traspasar', { operacionId: unico('t'), origenId: 'tienda', destinoId: 'deposito-1', lineas: [{ productoId: 'lapiz', cantidad: 3 }] });

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
        const r = await llamar(quien(rol));
        const etiqueta = `${nombre}/${rol}: ${JSON.stringify(r.error)}`;
        expect(r.status, etiqueta).toBe(400);
        expect((r.error as { details?: { codigo?: string } }).details?.codigo, etiqueta).toBe('stock-insuficiente');
        const f = faltantes(r);
        expect(f, etiqueta).toHaveLength(1);
        expect(f[0], etiqueta).toMatchObject({ productoId: 'lapiz', almacenId: 'tienda', pedido: 3 });
        const ve = rol === 'adm' || visibleParaNoAdm;
        if (ve) expect(f[0]?.['disponible'], etiqueta).toBe(2);
        else expect(Object.hasOwn(f[0] as Obj, 'disponible'), etiqueta).toBe(false);
        // La cantidad real no viaja por ninguna otra vía de la respuesta.
        if (!ve) expect(JSON.stringify(r.error), etiqueta).not.toMatch(/disponible|"existencias?"/);
      }
    }
  }

  beforeAll(async () => {
    const h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 2 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('sin conteo abierto todos reciben la cantidad, como hoy', async () => {
    await verifica(true);
  });

  it('un conteo abierto en OTRO almacén no recorta el faltante de la tienda', async () => {
    const abrir = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'deposito-1' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
    await verifica(true);
  });

  it('con un conteo abierto en el almacén del faltante, caj y sup no reciben la cantidad; adm sí', async () => {
    const abrir = await inv(sup, 'abrirConteo', { operacionId: unico('op'), conteoId: unico('ct').slice(0, 30), ubicacionId: 'tienda' });
    expect(abrir.status, JSON.stringify(abrir.error)).toBe(200);
    await verifica(false);
  });
});
