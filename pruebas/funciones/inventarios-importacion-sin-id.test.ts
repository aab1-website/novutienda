// Importación sin columna id por el callable, contra el emulador: el borde lee el catálogo completo una vez
// (`catalogoDe`) y reconoce cada producto por su SKU: actualiza, avisa de los ceros perdidos y no duplica.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const T = 'impsid-a';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const CAB = 'nombre,categoria,sku,precioUSDbo,precioUSDar';

describe.skipIf(!hayEmulador)('inventarios: importación sin id (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  const importar = (csv: string, extra: Obj = {}): ReturnType<typeof accion> => accion('inventarios', 'importarProductosCsv', { operacionId: unico('imp'), csv, ...extra }, adm.token, T);
  const total = async (): Promise<number> => (await h.firestore.collection(`tenants/${T}/productos`).get()).size;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, T);
    adm = await crearUsuario(h, { rol: 'adm', tenant: T });
    const alta = await importar(`${CAB}\nTornillo,c,00123,1,1\nCable,c,CAB-1,2,2\n`);
    expect(alta.status, JSON.stringify(alta.error)).toBe(200);
    expect(cuerpo(alta)).toMatchObject({ completa: true, creados: 2 });
  });

  it('actualiza por SKU sin id y no duplica', async () => {
    const antes = await total();
    const r = await importar(`${CAB}\nCable largo,c,CAB-1,2,2\n`);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cuerpo(r)).toMatchObject({ completa: true, creados: 0, actualizados: 1 });
    expect(await total()).toBe(antes);
    const docs = (await h.firestore.collection(`tenants/${T}/productos`).where('sku', '==', 'CAB-1').get()).docs;
    expect(docs).toHaveLength(1);
    expect(docs[0]?.data()['nombre']).toBe('Cable largo');
  });

  it('SKU con ceros a la izquierda perdidos: error, no crea duplicado ni toca el otro producto', async () => {
    const antes = await total();
    const sim = await accion('inventarios', 'importarProductosCsv', { simular: true, csv: `${CAB}\nTornillo 2,c,123,1,1\n` }, adm.token, T);
    expect(sim.status, JSON.stringify(sim.error)).toBe(200);
    const fila = (cuerpo(sim)['simulacion'] as { filas: { accion: string; errores: { columna: string; motivo: string }[] }[] }).filas[0];
    expect(fila?.accion).toBe('error');
    expect(fila?.errores[0]?.motivo).toContain('ceros a la izquierda');
    const r = await importar(`${CAB}\nTornillo 2,c,123,1,1\n`);
    expect(r.status).toBe(400); // sin omitirErrores, un archivo con filas con error se rechaza entero
    expect(await total()).toBe(antes);
    expect((await h.firestore.collection(`tenants/${T}/productos`).where('sku', '==', '00123').get()).docs[0]?.data()['nombre']).toBe('Tornillo');
  });

  it('repetir la misma importación no duplica productos', async () => {
    const csv = `${CAB}\nGoma,c,GOM-1,1,1\n`;
    expect(cuerpo(await importar(csv))).toMatchObject({ creados: 1 });
    const antes = await total();
    expect(cuerpo(await importar(csv))).toMatchObject({ creados: 0 });
    expect(await total()).toBe(antes);
  });
});
