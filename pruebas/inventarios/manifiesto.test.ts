import { describe, expect, it } from 'vitest';
import { crearRegistro, manifiestoNucleo, type ManifiestoModulo } from '@plataforma/nucleo';
import { aplicarSalida, EntradaInvalida, ingresar, manifiestoInventarios, prepararSalida } from './api.js';
import { ADM, altaProducto, cargar, CAJ, doc, nuevoEntorno, op, producto, SUP, T, tenantOk } from './entorno.js';

describe('manifiesto', () => {
  it('es válido en el registro y todas las colecciones son de un segmento, de escritura servidor', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(manifiestoNucleo);
    r.registrar(manifiestoInventarios);
    expect(r.rutas()).toEqual(expect.arrayContaining(['productos', 'existencias', 'movimientos']));
    for (const c of manifiestoInventarios.colecciones) {
      expect(c.ruta).not.toContain('/');
      expect(c.escritura).toBe('servidor');
    }
  });

  it('declara los límites, la visibilidad por rol y los eventos', () => {
    const por = (ruta: string) => manifiestoInventarios.colecciones.find((c) => c.ruta === ruta);
    expect(por('productos')?.limite).toBe('productos');
    expect(por('ubicaciones')?.limite).toBe('almacenes');
    expect(por('costos')?.lectura).toEqual(['adm']);
    expect(por('conteoTeoricos')?.lectura).toEqual(['sup', 'adm']);
    expect(por('existenciasPublicas')?.lectura).toEqual([]);
    expect(manifiestoInventarios.emite).toEqual(['stock.cambiado', 'stock.bajo']);
    expect(manifiestoInventarios.consume).toEqual(['venta.anulada', 'pedido.confirmado']);
    for (const c of ['movimientos', 'operaciones', 'mermas']) expect(por(c)?.lectura).not.toContain('caj');
  });
});

describe('aislamiento entre tenants', () => {
  it('operar en un tenant no toca al otro y un tenantId con ruta se rechaza', async () => {
    const db = await nuevoEntorno();
    await altaProducto(db, producto('lapiz'));
    await cargar(db, 'lapiz', 'tienda', 5);
    db.poner('tenants/t2', tenantOk);
    await db.runTransaction((tx) => import('./api.js').then((m) => m.crearProducto(tx, { tenantId: 't2', operacionId: op(), por: ADM, producto: producto('lapiz') })));
    await db.runTransaction((tx) => ingresar(tx, { tenantId: 't2', operacionId: op(), por: SUP, ubicacionId: 'tienda', lineas: [{ productoId: 'lapiz', cantidad: 9 }] }));
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(5);
    expect(db.dato('tenants/t2/productos/lapiz')?.['stockTotal']).toBe(9);
    // vender en t2 no descuenta t1
    await db.runTransaction(async (tx) => {
      const plan = await prepararSalida(tx, 't2', [{ productoId: 'lapiz', cantidad: 9, almacenId: 'tienda' }]);
      aplicarSalida(tx, plan, { tipo: 'venta', id: 'v1' }, CAJ);
    });
    expect(doc(db, 'productos', 'lapiz')?.['stockTotal']).toBe(5);
    expect(db.dato('tenants/t2/existencias/lapiz__tienda')?.['cantidad']).toBe(0);
    for (const malo of ['../t1', 't1/productos/x', 'T1', '', 't1 ']) {
      await expect(db.runTransaction((tx) => prepararSalida(tx, malo, [{ productoId: 'lapiz', cantidad: 1, almacenId: 'tienda' }]))).rejects.toBeInstanceOf(EntradaInvalida);
    }
    expect(T).toBe('t1');
  });
});
