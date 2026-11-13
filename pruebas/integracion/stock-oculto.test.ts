// El coordinador (`recortarDetallesDeStock`) y el marco (`comoHttpsError`) con los conteos leídos de un Firestore simulado:
// con faltantes en un almacén en conteo, caj y sup reciben solo `{ codigo, faltantesOcultos }`; adm y los demás casos, como hoy.
import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { bloqueoPorConteo, DETALLES_STOCK_OCULTO, recortarDetallesDeStock } from '../../plataforma/coordinador/index.js';
import { StockInsuficiente, TraspasoBloqueadoPorConteo } from '@novutienda/inventarios';

const T = 't1';
function dbCon(conteos: Record<string, string>, falla = false): Firestore {
  const snap = (id: string, data: object) => ({ id, exists: true, data: () => data });
  return {
    collection: () => ({
      get: async () => {
        if (falla) throw new Error('sin conexión');
        return { docs: ['tienda', 'deposito-1', 'deposito-2'].map((id) => snap(id, conteos[id] === undefined ? {} : { conteoAbiertoId: conteos[id] })) };
      },
    }),
    doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
  } as unknown as Firestore;
}
const detalles = (f: { almacenId: string; productoId?: string }[]) => ({
  codigo: 'stock-insuficiente',
  faltantes: f.map((x) => ({ productoId: x.productoId ?? 'p', almacenId: x.almacenId, pedido: 3, disponible: 2 })),
});

describe('recortarDetallesDeStock', () => {
  it.each(['caj', 'sup'] as const)('%s con un faltante en el almacén en conteo: solo el aviso, sin lista, ids ni cantidades', async (rol) => {
    const r = await recortarDetallesDeStock(dbCon({ tienda: 'c1' }), T, rol, detalles([{ almacenId: 'tienda' }, { almacenId: 'deposito-2', productoId: 'q' }]));
    expect(r).toEqual({ codigo: 'stock-insuficiente', faltantesOcultos: true });
    expect(r).toEqual(DETALLES_STOCK_OCULTO);
  });
  it('respuestas idénticas con uno o con dos faltantes (línea objetivo con o sin otra línea sin stock)', async () => {
    const db = dbCon({ tienda: 'c1' });
    const uno = await recortarDetallesDeStock(db, T, 'caj', detalles([{ almacenId: 'tienda', productoId: 'sin-stock' }]));
    const dos = await recortarDetallesDeStock(db, T, 'caj', detalles([{ almacenId: 'tienda', productoId: 'objetivo' }, { almacenId: 'tienda', productoId: 'sin-stock' }]));
    expect(JSON.stringify(uno)).toBe(JSON.stringify(dos));
  });
  it('conteo en otro almacén, adm y sin conteo: el detalle sigue como hoy', async () => {
    const d = detalles([{ almacenId: 'tienda' }]);
    expect(await recortarDetallesDeStock(dbCon({ 'deposito-1': 'c1' }), T, 'sup', d)).toEqual(d);
    expect(await recortarDetallesDeStock(dbCon({ tienda: 'c1' }), T, 'adm', d)).toEqual(d);
    expect(await recortarDetallesDeStock(dbCon({}), T, 'caj', d)).toEqual(d);
  });
  it('falla cerrado: si no se pueden leer los conteos, caj/sup/rol ausente reciben el aviso; adm la lista', async () => {
    const d = detalles([{ almacenId: 'tienda' }]);
    for (const rol of ['caj', 'sup', undefined] as const) expect(await recortarDetallesDeStock(dbCon({}, true), T, rol, d)).toEqual(DETALLES_STOCK_OCULTO);
    expect(await recortarDetallesDeStock(dbCon({}, true), T, 'adm', d)).toEqual(d);
  });
  it('otros errores pasan sin tocarse', async () => {
    expect(await recortarDetallesDeStock(dbCon({ tienda: 'c1' }), T, 'caj', { codigo: 'serie-no-disponible' })).toEqual({ codigo: 'serie-no-disponible' });
  });
});

describe('bloqueoPorConteo', () => {
  it('lleva {codigo, ubicacionId, conteoId, abiertoEn} y un mensaje sin cantidades', () => {
    const b = bloqueoPorConteo(new TraspasoBloqueadoPorConteo('deposito-1', 'c1', '2026-11-12T10:00:00.000Z'));
    expect(b?.details).toEqual({ codigo: 'conteo-abierto', ubicacionId: 'deposito-1', conteoId: 'c1', abiertoEn: '2026-11-12T10:00:00.000Z' });
    expect(b?.mensaje).not.toMatch(/\d{2,}/);
    expect(bloqueoPorConteo(new StockInsuficiente([]))).toBeUndefined();
  });
});
