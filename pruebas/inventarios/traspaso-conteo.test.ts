// Mientras un almacén está en conteo, `caj` y `sup` no traspasan desde ni hacia él; `adm` sí. El rechazo ocurre ANTES de
// toda validación que dependa de cantidades, así que no distingue «stock >= N» de «stock < N».
import { beforeEach, describe, expect, it } from 'vitest';
import { abrirConteo, traspasar, TraspasoBloqueadoPorConteo } from './api.js';
import type { DobleDb } from './doble-db.js';
import { ADM, altaProducto, cargar, CAJ, doc, nuevoEntorno, op, producto, SUP, T } from './entorno.js';

let db: DobleDb;
const tras = (por: { uid: string; rol: never } | typeof SUP, origenId: string, destinoId: string, cantidad = 3, productoId = 'lapiz') =>
  db.runTransaction((tx) => traspasar(tx, { tenantId: T, operacionId: op('t'), por, origenId, destinoId, lineas: [{ productoId, cantidad }] }));

beforeEach(async () => {
  db = await nuevoEntorno();
  await altaProducto(db, producto('lapiz'));
  await cargar(db, 'lapiz', 'tienda', 10);
  await cargar(db, 'lapiz', 'deposito-1', 10);
  await db.runTransaction((tx) => abrirConteo(tx, { tenantId: T, operacionId: op('a'), por: SUP, conteoId: 'ct1', ubicacionId: 'deposito-1' }));
});

describe('traspaso con conteo abierto', () => {
  it.each([['origen', 'deposito-1', 'tienda'], ['destino', 'tienda', 'deposito-1']])('sup no traspasa con el %s en conteo, y el error trae el conteo', async (_n, o, d) => {
    const e = await tras(SUP, o, d).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TraspasoBloqueadoPorConteo);
    const b = e as TraspasoBloqueadoPorConteo;
    expect(b.codigo).toBe('failed-precondition');
    expect(b.name).toBe('ConteoAbierto');
    expect([b.ubicacionId, b.conteoId, typeof b.abiertoEn]).toEqual(['deposito-1', 'ct1', 'string']);
    expect(b.message).not.toMatch(/\d{2,}|lapiz/);
    expect(doc(db, 'existencias', 'lapiz__tienda')?.['cantidad']).toBe(10);
  });
  it('caj (aunque el manifiesto no le permita traspasar) y un rol ausente o desconocido tampoco; adm sí', async () => {
    await expect(tras(CAJ, 'tienda', 'deposito-1')).rejects.toThrow();
    await expect(tras({ uid: 'x', rol: 'otro' as never }, 'tienda', 'deposito-1')).rejects.toThrow();
    await expect(tras(ADM, 'tienda', 'deposito-1')).resolves.toBeTruthy();
    await expect(tras(ADM, 'deposito-1', 'tienda')).resolves.toBeTruthy();
  });
  it('un conteo en otro almacén no bloquea', async () => {
    await expect(tras(SUP, 'tienda', 'deposito-2')).resolves.toBeTruthy();
  });
  it('el rechazo es el mismo con stock suficiente que con stock insuficiente y con un producto inexistente', async () => {
    const foto = async (f: () => Promise<unknown>): Promise<string> => {
      const e = (await f().catch((x: unknown) => x)) as Error & { ubicacionId?: string; conteoId?: string; abiertoEn?: unknown };
      return JSON.stringify([e.name, e.message, e.ubicacionId, e.conteoId, e.abiertoEn]);
    };
    const ok = await foto(() => tras(SUP, 'deposito-1', 'tienda', 3));
    expect(await foto(() => tras(SUP, 'deposito-1', 'tienda', 999))).toBe(ok);
    expect(await foto(() => tras(SUP, 'deposito-1', 'tienda', 3, 'inexistente'))).toBe(ok);
  });
});
