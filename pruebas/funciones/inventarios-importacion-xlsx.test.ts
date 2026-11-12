// Importación de un .xlsx real pequeño por el callable de Inventarios (simulación y real), contra el emulador.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';
import { xlsx } from './xlsx-ayuda.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'impx-a';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;

describe.skipIf(!hayEmulador)('inventarios: importación de .xlsx (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  const libro = (): string => xlsx([
    ['id', 'nombre', 'categoria', 'sku', 'precioUSDbo', 'precioUSDar'],
    ['xl-uno', 'Hoja uno', 'general', 'XL-1', 1250, 1300],
    ['xl-dos', 'Hoja dos', 'general', 'XL-2', 500, 500],
  ]).toString('base64');

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A);
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
  });

  it('simular no escribe; la importación real crea los productos; un archivo que no es xlsx ni csv se rechaza', async () => {
    const antes = (await h.firestore.collection(`tenants/${A}/productos`).get()).size;
    const sim = await accion('inventarios', 'importarProductosCsv', { simular: true, archivo: libro() }, adm.token, A);
    expect(sim.status, JSON.stringify(sim.error)).toBe(200);
    expect((cuerpo(sim)['simulacion'] as { filas: { accion: string }[] }).filas.map((f) => f.accion)).toEqual(['crear', 'crear']);
    expect((await h.firestore.collection(`tenants/${A}/productos`).get()).size).toBe(antes);

    const real = await accion('inventarios', 'importarProductosCsv', { operacionId: unico('xl'), archivo: libro() }, adm.token, A);
    expect(real.status, JSON.stringify(real.error)).toBe(200);
    expect(cuerpo(real)).toMatchObject({ simular: false, completa: true, creados: 2 });
    expect((await h.firestore.doc(`tenants/${A}/productos/xl-uno`).get()).data()).toMatchObject({ nombre: 'Hoja uno', precioUSD: { bo: 1250, ar: 1300 } });

    const malo = await accion('inventarios', 'importarProductosCsv', { simular: true, archivo: Buffer.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]).toString('base64') }, adm.token, A);
    expect(malo.status).toBe(400);
  });
});
