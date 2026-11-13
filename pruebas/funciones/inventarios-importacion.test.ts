// Importación de Inventarios por el callable (simulación, tandas, permisos), conteo con «faltan» y lecturas con `cortada`,
// contra el emulador de Firestore: aquí sí rige el tope real de 500 escrituras por transacción.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'impi-a';
/** Tenant aparte para la importación grande: sus 150 productos con stock en tienda no deben entrar en los conteos de A. */
const B = 'impi-b';
type Obj = Record<string, unknown>;
const cuerpo = (r: { resultado?: unknown }): Obj => r.resultado as Obj;
const CAB = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar';

describe.skipIf(!hayEmulador)('inventarios: importación, conteo y lecturas (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let admB: Usuario;

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 10 }, { id: 'goma', nombre: 'Goma', precioUSD: { bo: 500, ar: 500 }, tienda: 4 }] });
    await sembrarTenant(h, B);
    admB = await crearUsuario(h, { rol: 'adm', tenant: B });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
  });

  it('simular no escribe, no exige operacionId y solo lo hace adm', async () => {
    const antes = (await h.firestore.collection(`tenants/${A}/productos`).get()).size;
    const r = await accion('inventarios', 'importarProductosCsv', { simular: true, csv: `${CAB}\nnuevo-1,Nuevo,c,NV-1,1,2\nlapiz,Lápiz 2,general,SKU-lapiz,1000,1000\n` }, adm.token, A);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const sim = cuerpo(r)['simulacion'] as { resumen: Obj; filas: { accion: string }[] };
    expect(cuerpo(r)['simular']).toBe(true);
    expect(sim.filas.map((f) => f.accion)).toEqual(['crear', 'actualizar']);
    expect((await h.firestore.collection(`tenants/${A}/productos`).get()).size).toBe(antes);
    for (const u of [sup, caj]) expect((await accion('inventarios', 'importarProductosCsv', { simular: true, csv: `${CAB}\na1,x,c,S-1,1,1\n` }, u.token, A)).status).toBe(403);
    expect((await accion('inventarios', 'importarProductosCsv', { csv: `${CAB}\na1,x,c,S-1,1,1\n` }, adm.token, A)).status).toBe(400);
  });

  it('crea y actualiza; 150 productos con stock en 3 almacenes caben en tandas de la transacción real', async () => {
    const filas = Array.from({ length: 150 }, (_, i) => `imp-${String(i)}x,Imp ${String(i)},c,IMP-${String(i)},100,200,2,1,1`).join('\n');
    const csv = `${CAB},stockTienda,stockDeposito1,stockDeposito2\n${filas}\n`;
    const operacionId = unico('imp');
    const r = await accion('inventarios', 'importarProductosCsv', { operacionId, csv, cargaInicial: true }, admB.token, B);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect(cuerpo(r)).toMatchObject({ simular: false, completa: true, creados: 150 });
    expect((cuerpo(r)['lotes'] as { total: number }).total).toBeGreaterThan(1);
    const rep = await accion('inventarios', 'importarProductosCsv', { operacionId, csv, cargaInicial: true }, admB.token, B);
    expect(cuerpo(rep)).toMatchObject({ completa: true, creados: 150 });
    expect((await h.firestore.collection(`tenants/${B}/productos`).get()).size).toBe(150);
    const act = await accion('inventarios', 'importarProductosCsv', { operacionId: unico('imp'), csv: `${CAB}\nimp-0x,Cambiado,c,IMP-0,100,200\n` }, admB.token, B);
    expect(cuerpo(act)).toMatchObject({ completa: true, creados: 0, actualizados: 1 });
    expect((await h.firestore.doc(`tenants/${B}/productos/imp-0x`).get()).data()?.['nombre']).toBe('Cambiado');
  });

  it('conteo ciego: con el conteo abierto ningún rol recibe existencias ni derivados; da la lista a contar; al cerrar hay resultado y mermas', async () => {
    const conteoId = unico('cnt');
    await accion('inventarios', 'abrirConteo', { operacionId: unico('op'), conteoId, ubicacionId: 'tienda' }, sup.token, A);
    const reg = await accion('inventarios', 'registrarLineaConteo', { operacionId: unico('op'), conteoId, productoId: 'lapiz', contado: 10 }, caj.token, A);
    expect(JSON.stringify(cuerpo(reg))).not.toMatch(/teorico|esperado|diferencia|existencia|stock|faltan/i);
    for (const tok of [caj.token, sup.token]) {
      const vista = cuerpo(await accion('inventarios', 'conteo', { conteoId }, tok, A));
      const productos = vista['productos'] as Obj[];
      expect(productos.map((x) => x['productoId'])).toEqual(expect.arrayContaining(['lapiz', 'goma']));
      expect(productos.every((x) => Object.keys(x).every((k) => ['productoId', 'nombre', 'sku', 'categoria', 'marca', 'conSerie'].includes(k)))).toBe(true);
      expect(vista['faltan']).toBeUndefined();
      expect(vista['resultado']).toBeUndefined();
      expect(JSON.stringify(vista)).not.toMatch(/teorico|esperado|diferencia|existencia|stock|bajoMinimo|faltan|"cantidad"/i);
    }
    const cierre = await accion('inventarios', 'cerrarConteo', { operacionId: unico('op'), conteoId }, sup.token, A);
    expect(cierre.status, JSON.stringify(cierre.error)).toBe(200);
    expect(cuerpo(cuerpo(cierre))['sinContar']).toContain('goma');
    expect((await h.firestore.doc(`tenants/${A}/mermas/${conteoId}-goma`).get()).data()).toMatchObject({ estado: 'solicitada', cantidad: 4 });
    const cerrado = cuerpo(await accion('inventarios', 'conteo', { conteoId }, sup.token, A));
    expect(cerrado['productos']).toBeUndefined();
    expect((cerrado['resultado'] as Obj[]).find((x) => x['productoId'] === 'lapiz')).toMatchObject({ contado: 10, teorico: expect.any(Number) });
    expect(cuerpo(await accion('inventarios', 'conteo', { conteoId }, caj.token, A))['resultado']).toBeUndefined();
  });

  it('movimientos y mermas informan si la lista vino cortada; mermas filtra por estado y guarda el motivo del rechazo', async () => {
    const m = cuerpo(await accion('inventarios', 'movimientos', { limite: 1 }, sup.token, A));
    expect(m['cortada']).toBe(true);
    expect((m['movimientos'] as unknown[]).length).toBe(1);
    expect(cuerpo(await accion('inventarios', 'movimientos', { limite: 200 }, sup.token, A))['cortada']).toBe(false);
    const sol = cuerpo(await accion('inventarios', 'mermas', { estado: 'solicitada' }, sup.token, A));
    expect((sol['mermas'] as Obj[]).every((x) => x['estado'] === 'solicitada')).toBe(true);
    const mermaId = ((sol['mermas'] as Obj[])[0] as Obj)['id'] as string;
    const rech = await accion('inventarios', 'resolverMerma', { operacionId: unico('op'), mermaId, decision: 'rechazada', motivo: 'Conteo mal hecho' }, adm.token, A);
    expect(rech.status, JSON.stringify(rech.error)).toBe(200);
    const rechazadas = cuerpo(await accion('inventarios', 'mermas', { estado: 'rechazada' }, sup.token, A))['mermas'] as Obj[];
    expect(rechazadas.find((x) => x['id'] === mermaId)).toMatchObject({ resolucionMotivo: 'Conteo mal hecho' });
  });
  it('mermas sale de la más reciente a la más antigua, también filtrada por estado; rechazar sin motivo se rechaza en el servidor', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const operacionId = unico('mm');
      ids.push(operacionId);
      const r = await accion('inventarios', 'solicitarMerma', { operacionId, productoId: 'lapiz', ubicacionId: 'tienda', cantidad: 1, motivo: 'roto' }, caj.token, A);
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      await new Promise((ok) => setTimeout(ok, 30));
    }
    const todas = (cuerpo(await accion('inventarios', 'mermas', {}, sup.token, A))['mermas'] as Obj[]).map((x) => x['id']);
    expect(todas.slice(0, 3)).toEqual([...ids].reverse());
    const solicitadas = (cuerpo(await accion('inventarios', 'mermas', { estado: 'solicitada' }, sup.token, A))['mermas'] as Obj[]).map((x) => x['id']);
    expect(solicitadas.slice(0, 3)).toEqual([...ids].reverse());
    for (const motivo of [undefined, '', '   ', 'x'.repeat(501)]) {
      const r = await accion('inventarios', 'resolverMerma', { operacionId: unico('op'), mermaId: ids[0], decision: 'rechazada', ...(motivo !== undefined ? { motivo } : {}) }, adm.token, A);
      expect(r.status).toBe(400);
    }
    expect((await h.firestore.doc(`tenants/${A}/mermas/${ids[0]}`).get()).data()?.['estado']).toBe('solicitada');
  });

  it('importar con omitirErrores exige lineasOmitidas y rechaza sin escribir si no coinciden con la simulación', async () => {
    const csv = `${CAB}\nom-1,Om,c,OM-1,1,1\nMAL ID,x,c,OM-2,1,1\n`;
    const sin = await accion('inventarios', 'importarProductosCsv', { operacionId: unico('op'), csv, omitirErrores: true }, adm.token, A);
    expect(sin.status).toBe(400);
    const desfase = await accion('inventarios', 'importarProductosCsv', { operacionId: unico('op'), csv, omitirErrores: true, lineasOmitidas: [2] }, adm.token, A);
    expect(desfase.status, JSON.stringify(desfase.error)).toBe(200);
    expect(cuerpo(desfase)).toMatchObject({ completa: false, desactualizada: true, creados: 0 });
    expect((await h.firestore.doc(`tenants/${A}/productos/om-1`).get()).exists).toBe(false);
    const ok = await accion('inventarios', 'importarProductosCsv', { operacionId: unico('op'), csv, omitirErrores: true, lineasOmitidas: [3] }, adm.token, A);
    expect(cuerpo(ok)).toMatchObject({ completa: true, creados: 1, omitidas: 1 });
  });
});
