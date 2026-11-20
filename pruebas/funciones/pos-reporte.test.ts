// «Mi reporte» del POS por los callables reales (emulador): propiedad de los turnos, resumen del turno contra ventas sembradas,
// paginación por cursor de misTurnos y misVentas. El emulador no exige índices compuestos: eso se verifica en staging.
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, uuid, type Herramientas, type RespuestaLlamada, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'rep-a';
type Obj = Record<string, unknown>;
const res = (r: RespuestaLlamada): Obj => r.resultado as Obj;
const resumenDe = (r: RespuestaLlamada): Obj => res(r)['resumen'] as Obj;

describe.skipIf(!hayEmulador)('«Mi reporte» del POS (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let otroCaj: Usuario;
  let turnoId: string;
  const pos = (u: Usuario, nombre: string, datos: unknown) => accion('pos', nombre, datos, u.token, A);
  const BASE = 1_700_000_000_000;

  const venta = (o: { ventaId: string; turnoId: string; cajeroUid: string; creadoEnMs: number; estado?: string; subtotal?: number; total?: number; descuento?: number }): Obj => ({
    ventaId: o.ventaId, turnoId: o.turnoId, cajaId: 'caja-1', cajeroUid: o.cajeroUid, estado: o.estado ?? 'confirmada', moneda: 'BOB', mercado: 'BO', cotizacion: null,
    lineas: [], subtotal: o.subtotal ?? 1000, ...(o.descuento !== undefined ? { descuento: { monto: o.descuento } } : {}), total: o.total ?? 1000, pagos: [],
    serie: 'A', receiptNo: 1, creadoEnMs: o.creadoEnMs,
  });
  const sembrarVenta = async (v: Obj): Promise<void> => { await h.firestore.doc(`tenants/${A}/ventas/${String(v['ventaId'])}`).set(v); };
  const turnoCerrado = (id: string, cajeroUid: string, abiertoEnMs: number): Obj => ({
    turnoId: id, cajaId: 'caja-1', cajeroUid, estado: 'cerrado', apertura: { BOB: 0 }, abiertoEnMs, cerradoEnMs: abiertoEnMs + 1000,
    totales: { BOB: { efectivo: 0, qr: 0, transferencia: 0, credito: 0, ingresos: 0, egresos: 0 } },
  });

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 200 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    otroCaj = await crearUsuario(h, { rol: 'caj', tenant: A });
    turnoId = uuid();
    const t = await pos(caj, 'abrirTurno', { turnoId, apertura: { BOB: 1000 } });
    expect(t.status, JSON.stringify(t.error)).toBe(200);
    // Totales del turno abierto, como los dejarían las ventas y anulaciones (los sube el servidor al cobrar).
    await h.firestore.doc(`tenants/${A}/turnos/${turnoId}`).update({
      totales: { BOB: { efectivo: 3000, qr: 1500, transferencia: 500, credito: 700, ingresos: 200, egresos: 100 } },
    });
    const ahora = Date.now();
    await sembrarVenta(venta({ ventaId: uuid(), turnoId, cajeroUid: caj.uid, creadoEnMs: ahora - 4, subtotal: 2000, total: 1800, descuento: 200 }));
    await sembrarVenta(venta({ ventaId: uuid(), turnoId, cajeroUid: caj.uid, creadoEnMs: ahora - 3, subtotal: 3000, total: 3000 }));
    await sembrarVenta(venta({ ventaId: uuid(), turnoId, cajeroUid: caj.uid, creadoEnMs: ahora - 2, subtotal: 500, total: 500 }));
    await sembrarVenta(venta({ ventaId: uuid(), turnoId, cajeroUid: caj.uid, creadoEnMs: ahora - 1, estado: 'anulada', subtotal: 800, total: 800 }));
    await h.firestore.doc(`tenants/${A}/anulaciones/${uuid()}`).set({
      turnoIdReembolso: turnoId, moneda: 'BOB', reembolsos: [{ medio: 'efectivo', monto: 600 }, { medio: 'qr', monto: 200 }], creditoCancelado: 0,
    });
  });
  afterAll(async () => {
    const r = await pos(adm, 'cerrarTurnoForzado', { turnoId, contado: { BOB: 1000 }, motivo: 'Limpieza de la prueba' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
  });

  it('resumenTurno sin turnoId devuelve el turno abierto propio, o null si no hay o es de otro', async () => {
    const r = await pos(caj, 'resumenTurno', {});
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    expect((resumenDe(r)['turno'] as Obj)['turnoId']).toBe(turnoId);
    const otro = await pos(otroCaj, 'resumenTurno', {});
    expect(otro.status).toBe(200);
    expect(res(otro)['resumen']).toBeNull();
  });

  it('los totales coinciden con las ventas sembradas: confirmadas, bruto, descuentos, neto, medios, anuladas y reembolsos', async () => {
    const r = await pos(caj, 'resumenTurno', { turnoId });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const resumen = resumenDe(r);
    expect(resumen['truncado']).toBe(false);
    expect(resumen['monedas']).toEqual(['BOB']);
    const bob = (resumen['porMoneda'] as Record<string, Obj>)['BOB'] as Obj;
    expect(bob).toMatchObject({
      ventas: 3, bruto: 5500, descuentos: { cantidad: 1, monto: 200 }, neto: 5300,
      porMedio: { efectivo: 3000, qr: 1500, transferencia: 500, credito: 700 },
      anuladas: { cantidad: 1, monto: 800 }, reembolsos: { efectivo: 600, qr: 200, transferencia: 0, credito: 0 },
      ingresos: 200, egresos: 100,
    });
  });

  it('el cajero no lee un turno ajeno; sup y adm sí; un turno inexistente es not-found', async () => {
    const ajeno = uuid();
    await h.firestore.doc(`tenants/${A}/turnos/${ajeno}`).set(turnoCerrado(ajeno, otroCaj.uid, BASE));
    const r = await pos(caj, 'resumenTurno', { turnoId: ajeno });
    expect(r.status).toBe(403);
    expect(r.error?.status).toBe('PERMISSION_DENIED');
    for (const u of [sup, adm]) {
      const ok = await pos(u, 'resumenTurno', { turnoId: ajeno });
      expect(ok.status, JSON.stringify(ok.error)).toBe(200);
      expect((resumenDe(ok)['turno'] as Obj)['cajeroUid']).toBe(otroCaj.uid);
    }
    expect((await pos(sup, 'resumenTurno', { turnoId: uuid() })).status).toBe(404);
  });

  it('misTurnos pagina de a 50 con cursor, sin repetidos; el cajero no pide los de otro; sup y adm filtran por cajero', async () => {
    const mio = await crearUsuario(h, { rol: 'caj', tenant: A });
    const ids: string[] = [];
    for (let i = 0; i < 55; i += 1) {
      const id = uuid();
      ids.push(id);
      await h.firestore.doc(`tenants/${A}/turnos/${id}`).set(turnoCerrado(id, mio.uid, BASE + i * 10_000));
    }
    const p1 = await pos(mio, 'misTurnos', {});
    expect(p1.status, JSON.stringify(p1.error)).toBe(200);
    const t1 = res(p1)['turnos'] as Obj[];
    expect(t1).toHaveLength(50);
    const sig = res(p1)['siguiente'] as Obj;
    expect(sig).toBeTruthy();
    expect(t1[0]?.['abiertoEnMs']).toBe(BASE + 54 * 10_000);
    const p2 = await pos(mio, 'misTurnos', { despuesDe: sig });
    expect(p2.status, JSON.stringify(p2.error)).toBe(200);
    const t2 = res(p2)['turnos'] as Obj[];
    expect(t2).toHaveLength(5);
    expect(res(p2)['siguiente']).toBeNull();
    const todos = [...t1, ...t2].map((t) => t['turnoId']);
    expect(new Set(todos).size).toBe(55);
    expect(new Set(todos)).toEqual(new Set(ids));
    // Propiedad.
    const ajeno = await pos(caj, 'misTurnos', { cajeroUid: mio.uid });
    expect(ajeno.status).toBe(403);
    expect(ajeno.error?.status).toBe('PERMISSION_DENIED');
    expect((await pos(caj, 'misTurnos', { cajeroUid: caj.uid })).status).toBe(200);
    for (const u of [sup, adm]) {
      const r = await pos(u, 'misTurnos', { cajeroUid: mio.uid, limite: 10 });
      expect(r.status, JSON.stringify(r.error)).toBe(200);
      expect(res(r)['turnos'] as Obj[]).toHaveLength(10);
      expect(res(r)['siguiente']).toBeTruthy();
    }
  });

  it('misVentas pagina de a 50 con cursor, sin repetidos, y el cajero solo ve las suyas', async () => {
    const vendedor = await crearUsuario(h, { rol: 'caj', tenant: A });
    const turno = uuid();
    const ids: string[] = [];
    for (let i = 0; i < 53; i += 1) {
      const ventaId = uuid();
      ids.push(ventaId);
      await sembrarVenta(venta({ ventaId, turnoId: turno, cajeroUid: vendedor.uid, creadoEnMs: BASE + i * 1000 }));
    }
    // Una venta ajena que no debe aparecer.
    await sembrarVenta(venta({ ventaId: uuid(), turnoId: turno, cajeroUid: caj.uid, creadoEnMs: BASE + 99_000 }));
    const p1 = await pos(vendedor, 'misVentas', {});
    expect(p1.status, JSON.stringify(p1.error)).toBe(200);
    const v1 = res(p1)['ventas'] as Obj[];
    expect(v1).toHaveLength(50);
    const sig = res(p1)['siguiente'] as Obj;
    expect(sig).toBeTruthy();
    const p2 = await pos(vendedor, 'misVentas', { despuesDe: sig });
    expect(p2.status, JSON.stringify(p2.error)).toBe(200);
    const v2 = res(p2)['ventas'] as Obj[];
    expect(v2).toHaveLength(3);
    expect(res(p2)['siguiente']).toBeNull();
    const todos = [...v1, ...v2].map((v) => v['ventaId']);
    expect(new Set(todos).size).toBe(53);
    expect(new Set(todos)).toEqual(new Set(ids));
  });

  it('misVentas con la misma marca de tiempo en tres ventas y páginas de 2: sin repetidos ni saltos', async () => {
    const vendedor = await crearUsuario(h, { rol: 'caj', tenant: A });
    const turno = uuid();
    const ids = [uuid(), uuid(), uuid()];
    for (const ventaId of ids) await sembrarVenta(venta({ ventaId, turnoId: turno, cajeroUid: vendedor.uid, creadoEnMs: BASE }));
    const p1 = await pos(vendedor, 'misVentas', { limite: 2 });
    expect(p1.status, JSON.stringify(p1.error)).toBe(200);
    const v1 = res(p1)['ventas'] as Obj[];
    expect(v1).toHaveLength(2);
    expect(res(p1)['siguiente']).toBeTruthy();
    const p2 = await pos(vendedor, 'misVentas', { limite: 2, despuesDe: res(p1)['siguiente'] });
    expect(p2.status, JSON.stringify(p2.error)).toBe(200);
    const v2 = res(p2)['ventas'] as Obj[];
    expect(v2).toHaveLength(1);
    expect(res(p2)['siguiente']).toBeNull();
    expect([...v1, ...v2].map((v) => v['ventaId']).sort()).toEqual([...ids].sort());
  });

  it('misVentas con turnoId más cursor, y con desde/hasta más cursor, pagina dentro del filtro', async () => {
    const vendedor = await crearUsuario(h, { rol: 'caj', tenant: A });
    const turnoA = uuid();
    const turnoB = uuid();
    const deA: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const ventaId = uuid();
      deA.push(ventaId);
      await sembrarVenta(venta({ ventaId, turnoId: turnoA, cajeroUid: vendedor.uid, creadoEnMs: BASE + 10_000 + i * 1000 }));
    }
    for (let i = 0; i < 3; i += 1) await sembrarVenta(venta({ ventaId: uuid(), turnoId: turnoB, cajeroUid: vendedor.uid, creadoEnMs: BASE + 10_000 + i * 1000 }));
    // Por turno.
    const t1 = await pos(vendedor, 'misVentas', { turnoId: turnoA, limite: 2 });
    expect(t1.status, JSON.stringify(t1.error)).toBe(200);
    const t2 = await pos(vendedor, 'misVentas', { turnoId: turnoA, limite: 2, despuesDe: res(t1)['siguiente'] });
    const t3 = await pos(vendedor, 'misVentas', { turnoId: turnoA, limite: 2, despuesDe: res(t2)['siguiente'] });
    expect(t3.status, JSON.stringify(t3.error)).toBe(200);
    const delTurno = [t1, t2, t3].flatMap((r) => res(r)['ventas'] as Obj[]);
    expect(delTurno.map((v) => v['ventaId']).sort()).toEqual([...deA].sort());
    expect(res(t3)['siguiente']).toBeNull();
    // Por rango: de las 8 ventas del vendedor, solo las que caen entre BASE+10_500 y BASE+12_500 (las de i = 1 y 2, en dos turnos).
    const desde = BASE + 10_500;
    const hasta = BASE + 12_500;
    const r1 = await pos(vendedor, 'misVentas', { desde, hasta, limite: 2 });
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    const r2 = await pos(vendedor, 'misVentas', { desde, hasta, limite: 2, despuesDe: res(r1)['siguiente'] });
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    const rango = [...(res(r1)['ventas'] as Obj[]), ...(res(r2)['ventas'] as Obj[])];
    expect(rango).toHaveLength(4);
    expect(rango.every((v) => Number(v['creadoEnMs']) >= desde && Number(v['creadoEnMs']) <= hasta)).toBe(true);
    expect(new Set(rango.map((v) => v['ventaId'])).size).toBe(4);
    expect(res(r2)['siguiente']).toBeNull();
  });

  it('una venta de un turno anulada desde otro: figura anulada en el suyo y como reembolso en el de la devolución', async () => {
    const vendedor = await crearUsuario(h, { rol: 'caj', tenant: A });
    const t1 = uuid();
    const t2 = uuid();
    await h.firestore.doc(`tenants/${A}/turnos/${t1}`).set(turnoCerrado(t1, vendedor.uid, BASE + 50_000));
    await h.firestore.doc(`tenants/${A}/turnos/${t2}`).set(turnoCerrado(t2, vendedor.uid, BASE + 60_000));
    await sembrarVenta(venta({ ventaId: uuid(), turnoId: t1, cajeroUid: vendedor.uid, creadoEnMs: BASE + 50_100, estado: 'anulada', subtotal: 900, total: 900 }));
    await h.firestore.doc(`tenants/${A}/anulaciones/${uuid()}`).set({ turnoIdReembolso: t2, moneda: 'BOB', reembolsos: [{ medio: 'efectivo', monto: 900 }], creditoCancelado: 0 });
    const b1 = ((resumenDe(await pos(vendedor, 'resumenTurno', { turnoId: t1 }))['porMoneda'] as Record<string, Obj>)['BOB']) as Obj;
    const b2 = ((resumenDe(await pos(vendedor, 'resumenTurno', { turnoId: t2 }))['porMoneda'] as Record<string, Obj>)['BOB']) as Obj;
    expect(b1).toMatchObject({ ventas: 0, neto: 0, anuladas: { cantidad: 1, monto: 900 }, reembolsos: { efectivo: 0 } });
    expect(b2).toMatchObject({ ventas: 0, anuladas: { cantidad: 0, monto: 0 }, reembolsos: { efectivo: 900 } });
  });

  it('con cajeroUid, el resumen sin turnoId devuelve null si el turno abierto es de otro cajero, y con turnoId ajeno es permission-denied', async () => {
    const mio = await pos(sup, 'resumenTurno', { cajeroUid: sup.uid });
    expect(mio.status).toBe(200);
    expect(res(mio)['resumen']).toBeNull();
    const ajeno = await pos(sup, 'resumenTurno', { turnoId, cajeroUid: sup.uid });
    expect(ajeno.status).toBe(403);
    const propio = await pos(sup, 'resumenTurno', { turnoId, cajeroUid: caj.uid });
    expect(propio.status, JSON.stringify(propio.error)).toBe(200);
  });
});
