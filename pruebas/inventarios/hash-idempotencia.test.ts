// Fija el hash de idempotencia (`hashCarga` guardado en `operaciones/{id}`) del tenant de tres monedas: si cambia, un reintento
// de una operación ya aplicada daría `OperacionConflicto`. Los valores esperados se calcularon con el código de origin/main
// (cccaf70, antes de B2) ejecutando este mismo cuerpo en un worktree temporal.
import { describe, expect, it } from 'vitest';
import { crearProducto, importarCsvPorLotes } from './api.js';
import { ADM, doc, nuevoEntorno, producto, T } from './entorno.js';

const HASH_PRODUCTO_CREAR = 'f8c68fb84f29e83dde92b273bdb6866f6ec75420b120e7fa91e3a8229554a2da';
const HASH_IMPORTAR_LOTE = 'c3cdd543525587e9226ccfc8dde448a5d2297811163e60dc85d692560b0b6669';

describe('hash de idempotencia idéntico al de main (tenant de tres monedas)', () => {
  it('alta de producto', async () => {
    const db = await nuevoEntorno();
    await db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: 'hash-prod', por: ADM, producto: producto('lapiz', { marca: 'Faber', garantiaMeses: 6, minimo: 5, costoUSD: 250 }) }));
    expect(doc(db, 'operaciones', 'hash-prod')?.['hashCarga']).toBe(HASH_PRODUCTO_CREAR);
  });
  it('tanda de importación (crear y actualizar, con stock)', async () => {
    const db = await nuevoEntorno();
    const csv = 'id,nombre,categoria,sku,precioBO,precioAR,costo,stockTienda\nlapiz,Lápiz,c,L-1,12.50,13.25,1.10,3\ngoma,Goma,c,G-1,,2.00,,\n';
    await importarCsvPorLotes(db, { tenantId: T, operacionId: 'hash-imp', por: ADM, csv, cargaInicial: true });
    expect(doc(db, 'operaciones', 'hash-imp-l1')?.['hashCarga']).toBe(HASH_IMPORTAR_LOTE);
  });
});
