// Ningún error distingue «stock >= N» de «stock < N» cuando la entrada es inválida por otra razón (oráculos de existencias
// sin efectos, que `caj`/`sup` podrían usar durante un conteo). Cada caso corre el MISMO pedido en dos mundos (con stock que
// alcanza y sin él) y exige la misma respuesta: mismo tipo, código, mensaje y detalles.
import { describe, expect, it } from 'vitest';
import {
  aplicarSalida,
  ajustar,
  ingresar,
  prepararSalida,
  solicitarMerma,
  traspasar,
  StockInsuficiente,
  type LineaSalida,
} from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, cargar, CAJ, doc, nuevoEntorno, op, producto, SUP, T, verificarInvariantes } from './entorno.js';

type Foto = { tipo: string; codigo: unknown; mensaje: string; props: string } | 'completo';

async function foto(f: () => Promise<unknown>): Promise<Foto> {
  try {
    await f();
    return 'completo';
  } catch (e) {
    const x = e as Error & { codigo?: unknown };
    return { tipo: x.name, codigo: x.codigo, mensaje: x.message, props: JSON.stringify(e) };
  }
}

/** Mundo con `n` unidades de lápiz y `n` de celular (series S1..Sn) en la tienda. */
async function mundo(n: number): Promise<DobleDb> {
  const db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz'));
  await altaProducto(db, producto('celular', { conSerie: true }));
  await altaProducto(db, producto('sinctl', { controlaStock: false }));
  await cargar(db, 'lapiz', 'tienda', n);
  await cargar(db, 'celular', 'tienda', n, Array.from({ length: n }, (_, i) => `S${i + 1}`));
  return db;
}

/** Corre `f` con stock suficiente (10) y con stock insuficiente (1) para N = 5 y exige respuestas idénticas y de error. */
async function identicaConYSinStock(f: (db: DobleDb) => Promise<unknown>): Promise<void> {
  const [con, sin] = await Promise.all([mundo(10), mundo(1)]).then(([a, b]) => Promise.all([foto(() => f(a)), foto(() => f(b))]));
  expect(con).not.toBe('completo');
  expect(sin).toEqual(con);
}

const salida = (db: DobleDb, lineas: LineaSalida[]) =>
  db.runTransaction(async (tx) => {
    const plan = await prepararSalida(tx, T, lineas);
    aplicarSalida(tx, plan, { tipo: 'venta', id: op('v') }, CAJ);
  });
const tras = (db: DobleDb, lineas: { productoId: string; cantidad: number; series?: string[] }[]) =>
  db.runTransaction((tx) => traspasar(tx, { tenantId: T, operacionId: op('t'), por: SUP, origenId: 'tienda', destinoId: 'deposito-1', lineas }));

describe('oráculo de venta con series (puerto.prepararSalida)', () => {
  it('N series inventadas fallan igual haya o no stock', () =>
    identicaConYSinStock((db) => salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 5, series: ['X1', 'X2', 'X3', 'X4', 'X5'] }])));
  it('series de otra ubicación o mezcladas con una válida fallan igual', () =>
    identicaConYSinStock((db) => salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 5, series: ['S1', 'X2', 'X3', 'X4', 'X5'] }])));
  it('series que no son tantas como la cantidad fallan igual', () =>
    identicaConYSinStock((db) => salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 5, series: ['S1'] }])));
  it('series en un producto sin serie fallan igual', () =>
    identicaConYSinStock((db) => salida(db, [{ productoId: 'lapiz', almacenId: 'tienda', cantidad: 5, series: ['A'] }])));
  it('una línea sin stock no oculta ni cambia el error de otra línea inválida (en cualquier orden)', async () => {
    await identicaConYSinStock((db) =>
      salida(db, [{ productoId: 'lapiz', almacenId: 'tienda', cantidad: 5 }, { productoId: 'celular', almacenId: 'tienda', cantidad: 1, series: ['X'] }]),
    );
    await identicaConYSinStock((db) =>
      salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 1, series: ['X'] }, { productoId: 'lapiz', almacenId: 'tienda', cantidad: 5 }]),
    );
  });
  it('un producto inexistente en otra línea falla igual', () =>
    identicaConYSinStock((db) => salida(db, [{ productoId: 'lapiz', almacenId: 'tienda', cantidad: 5 }, { productoId: 'nada', almacenId: 'tienda', cantidad: 1 }])));

  it('regresión: venta con series elegidas y con asignación automática', async () => {
    const db = await mundo(10);
    await salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 2, series: ['S3', 'S4'] }]);
    expect(doc(db, 'unidades', 'celular__S3')?.['estado']).toBe('vendida');
    await salida(db, [{ productoId: 'celular', almacenId: 'tienda', cantidad: 2 }]);
    expect(doc(db, 'unidades', 'celular__S1')?.['estado']).toBe('vendida');
    expect(doc(db, 'existencias', 'celular__tienda')?.['cantidad']).toBe(6);
    verificarInvariantes(db);
  });
  it('regresión: sin stock y entrada válida sigue siendo StockInsuficiente con todos los faltantes', async () => {
    const db = await mundo(1);
    const e = await salida(db, [{ productoId: 'lapiz', almacenId: 'tienda', cantidad: 5 }, { productoId: 'celular', almacenId: 'tienda', cantidad: 3 }]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StockInsuficiente);
    expect((e as StockInsuficiente).faltantes.map((f) => f.productoId)).toEqual(['lapiz', 'celular']);
  });
});

describe('oráculo de traspaso (stock.traspasar)', () => {
  it('línea 1 con stock objetivo y línea 2 sin serie obligatoria falla igual', () =>
    identicaConYSinStock((db) => tras(db, [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'celular', cantidad: 1 }])));
  it('línea 2 con serie inventada falla igual', () =>
    identicaConYSinStock((db) => tras(db, [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'celular', cantidad: 1, series: ['X'] }])));
  it('línea 2 de un producto que no controla stock falla igual', () =>
    identicaConYSinStock((db) => tras(db, [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'sinctl', cantidad: 1 }])));
  it('línea 2 de un producto inexistente o con series en uno sin serie falla igual', async () => {
    await identicaConYSinStock((db) => tras(db, [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'nada', cantidad: 1 }]));
    await identicaConYSinStock((db) => tras(db, [{ productoId: 'celular', cantidad: 1, series: ['X'] }, { productoId: 'lapiz', cantidad: 5, series: ['A'] }]));
  });
  it('series inventadas con cantidad N fallan igual', () =>
    identicaConYSinStock((db) => tras(db, [{ productoId: 'celular', cantidad: 5, series: ['X1', 'X2', 'X3', 'X4', 'X5'] }])));

  it('regresión: traspaso de varias líneas con series mueve todo', async () => {
    const db = await mundo(10);
    await tras(db, [{ productoId: 'lapiz', cantidad: 4 }, { productoId: 'celular', cantidad: 2, series: ['S2', 'S5'] }]);
    expect(doc(db, 'existencias', 'lapiz__deposito-1')?.['cantidad']).toBe(4);
    expect(doc(db, 'existencias', 'celular__tienda')?.['cantidad']).toBe(8);
    expect(doc(db, 'unidades', 'celular__S5')?.['ubicacionId']).toBe('deposito-1');
    verificarInvariantes(db);
  });
  it('regresión: dos líneas sin stock se informan juntas y no se mueve nada', async () => {
    const db = await mundo(1);
    const e = await tras(db, [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'celular', cantidad: 3, series: ['S1', 'S2', 'S3'] }]).catch((x: unknown) => x);
    expect((e as Error).name).toBe('SerieNoDisponible');
    const e2 = await tras(db, [{ productoId: 'lapiz', cantidad: 5 }]).catch((x: unknown) => x);
    expect(e2).toBeInstanceOf(StockInsuficiente);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(1);
  });
});

describe('otras operaciones de varias líneas y de solicitud', () => {
  it('ajuste: una línea sin stock no cambia el error de una línea inválida posterior', () =>
    identicaConYSinStock((db) =>
      db.runTransaction((tx) =>
        ajustar(tx, { tenantId: T, operacionId: op('a'), por: ADM, motivo: 'x', lineas: [{ productoId: 'lapiz', ubicacionId: 'tienda', delta: -5 }, { productoId: 'celular', ubicacionId: 'tienda', delta: 1 }] }),
      ),
    ));
  it('ingreso: una serie repetida en la línea 2 falla igual (el ingreso no depende del stock)', async () => {
    const f = (db: DobleDb) =>
      db.runTransaction((tx) =>
        ingresar(tx, { tenantId: T, operacionId: op('i'), por: SUP, ubicacionId: 'tienda', lineas: [{ productoId: 'lapiz', cantidad: 5 }, { productoId: 'celular', cantidad: 1, series: ['S1'] }] }),
      );
    await identicaConYSinStock(f);
  });
  it('merma: series inventadas fallan igual haya o no stock; sin otra razón, rechaza por cantidad antes de crear nada', async () => {
    await identicaConYSinStock((db) =>
      db.runTransaction((tx) => solicitarMerma(tx, { tenantId: T, operacionId: op('m'), por: CAJ, productoId: 'celular', ubicacionId: 'tienda', cantidad: 5, series: ['X1', 'X2', 'X3', 'X4', 'X5'], motivo: 'm' })),
    );
    const db = await mundo(1);
    await expect(
      db.runTransaction((tx) => solicitarMerma(tx, { tenantId: T, operacionId: 'm-sin', por: CAJ, productoId: 'lapiz', ubicacionId: 'tienda', cantidad: 5, motivo: 'm' })),
    ).rejects.toBeInstanceOf(StockInsuficiente);
    expect(doc(db, 'mermas', 'm-sin')).toBeUndefined();
  });
});
