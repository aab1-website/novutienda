// Carritos guardados (ventas en espera) del POS por los callables reales (emulador): roles, propiedad, conflicto de versión,
// tope de 10, cierre bloqueado y forzado, cobro idempotente con carrito, aprobación ligada al carrito y cancelación por sup/adm.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { accion, crearUsuario, hayEmulador, herramientas, sembrarTenant, uuid, type Herramientas, type RespuestaLlamada, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const A = 'car-a';
type Obj = Record<string, unknown>;
const codigo = (r: RespuestaLlamada): unknown => (r.error?.details as { codigo?: string } | undefined)?.codigo;
const detalles = (r: RespuestaLlamada): Obj => (r.error?.details ?? {}) as Obj;
const res = (r: RespuestaLlamada): Obj => r.resultado as Obj;
const carritoDe = (r: RespuestaLlamada): Obj => res(r)['carrito'] as Obj;
const CONTENIDO = { mercadoId: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }], cliente: { nombre: 'Ana Pérez', telefono: '70000000' } };
const CARRITO_VENTA = { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 1 }] };

describe.skipIf(!hayEmulador)('carritos guardados del POS (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let otroCaj: Usuario;
  let sinRol: Usuario;
  let turnoId: string;
  const pos = (u: Usuario, nombre: string, datos: unknown) => accion('pos', nombre, datos, u.token, A);

  async function crear(u: Usuario, etiqueta?: string): Promise<{ id: string; version: number }> {
    const id = uuid();
    const r = await pos(u, 'crearCarrito', { carritoId: id, ...(etiqueta !== undefined ? { etiqueta } : {}) });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    return { id, version: carritoDe(r)['version'] as number };
  }
  const docCarrito = async (id: string): Promise<Obj> => (await h.firestore.doc(`tenants/${A}/carritos/${id}`).get()).data() as Obj;
  const auditoria = async (accionAuditada: string, ruta?: string): Promise<Obj[]> =>
    (await h.firestore.collection(`tenants/${A}/auditoria`).where('accion', '==', accionAuditada).get()).docs.map((d) => d.data() as Obj).filter((d) => ruta === undefined || d['ruta'] === ruta);

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, { productos: [{ id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 200 }] });
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    otroCaj = await crearUsuario(h, { rol: 'caj', tenant: A });
    sinRol = await crearUsuario(h, { rol: 'caj', tenant: 'otra-tienda' });
  });

  // Un solo turno por caja: cada caso abre el suyo con `caj` y el administrador lo cierra de forma forzada (lo que cancela sus carritos).
  beforeEach(async () => {
    turnoId = uuid();
    const t = await pos(caj, 'abrirTurno', { turnoId, apertura: { BOB: 1000 } });
    expect(t.status, JSON.stringify(t.error)).toBe(200);
  });
  afterEach(async () => {
    const r = await pos(adm, 'cerrarTurnoForzado', { turnoId, contado: { BOB: 1000 }, motivo: 'Limpieza de la prueba' });
    expect(r.status, JSON.stringify(r.error)).toBe(200);
  });

  it('roles: sin rol en el tenant o sin sesión se rechaza; caj, sup y adm usan las lecturas', async () => {
    expect((await pos(sinRol, 'crearCarrito', { carritoId: uuid() })).status).toBe(403);
    expect((await pos(sinRol, 'misCarritos', {})).status).toBe(403);
    expect((await accion('pos', 'crearCarrito', { carritoId: uuid() }, undefined, A)).status).toBe(401);
    for (const u of [caj, sup, adm]) {
      const r = await pos(u, 'misCarritos', {});
      expect(r.status, JSON.stringify(r.error)).toBe(200);
    }
    // sup y adm no tienen turno propio: crear exige turno abierto del actor.
    const r = await pos(sup, 'crearCarrito', { carritoId: uuid() });
    expect(r.status).toBe(403);
    expect(codigo(r)).toBe('turno-ajeno');
  });

  it('crear es idempotente, pone la etiqueta por omisión y misCarritos lista los abiertos', async () => {
    const id = uuid();
    const a = await pos(caj, 'crearCarrito', { carritoId: id });
    const b = await pos(caj, 'crearCarrito', { carritoId: id });
    expect(carritoDe(a)).toMatchObject({ carritoId: id, estado: 'abierto', version: 1, etiqueta: 'Cliente 1', turnoId });
    expect(carritoDe(b)['version']).toBe(1);
    const otro = await pos(caj, 'crearCarrito', { carritoId: uuid() });
    expect(carritoDe(otro)['etiqueta']).toBe('Cliente 2');
    const lista = (res(await pos(caj, 'misCarritos', {}))['carritos'] as Obj[]);
    expect(lista).toHaveLength(2);
    expect(await auditoria('pos.carrito.crear', `tenants/${A}/carritos/${id}`)).toHaveLength(1);
  });

  it('carrito ajeno: otro cajero no lo guarda ni lo cancela; el creador sí lo guarda', async () => {
    const { id, version } = await crear(caj);
    const g = await pos(otroCaj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    expect(g.status).toBe(403);
    expect(codigo(g)).toBe('carrito-ajeno');
    const c = await pos(otroCaj, 'cancelarCarrito', { carritoId: id, motivo: 'No es mío' });
    expect(codigo(c)).toBe('carrito-ajeno');
    expect((await docCarrito(id))['estado']).toBe('abierto');
    const ok = await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(carritoDe(ok)['version']).toBe(version + 1);
    expect((await pos(caj, 'guardarCarrito', { carritoId: uuid(), version: 1, etiqueta: 'x' })).status).toBe(404);
  });

  it('conflicto de versión: devuelve el carrito vigente en details y no escribe', async () => {
    const { id, version } = await crear(caj);
    const g1 = await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    expect(g1.status).toBe(200);
    const g2 = await pos(caj, 'guardarCarrito', { carritoId: id, version, etiqueta: 'Desde otra pantalla' });
    expect(g2.status).toBe(400);
    expect(codigo(g2)).toBe('carrito-conflicto');
    expect(detalles(g2)['carrito']).toMatchObject({ carritoId: id, version: version + 1, estado: 'abierto' });
    expect((await docCarrito(id))['etiqueta']).not.toBe('Desde otra pantalla');
  });

  it('tope de 10 carritos abiertos por turno; cancelar uno libera el cupo', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push((await crear(caj)).id);
    const r = await pos(caj, 'crearCarrito', { carritoId: uuid() });
    expect(r.status).toBe(429);
    expect(codigo(r)).toBe('limite-carritos');
    expect((await pos(caj, 'cancelarCarrito', { carritoId: ids[0], motivo: 'Libero cupo' })).status).toBe(200);
    expect((await pos(caj, 'crearCarrito', { carritoId: uuid() })).status).toBe(200);
  });

  it('cierre normal bloqueado con la lista en details; tras cancelar, cierra', async () => {
    const a = await crear(caj, 'Uno');
    const b = await crear(caj, 'Dos');
    const c = await pos(caj, 'cerrarTurno', { turnoId, contado: { BOB: 1000 } });
    expect(c.status).toBe(400);
    expect(codigo(c)).toBe('carritos-abiertos');
    expect(JSON.stringify(detalles(c))).toContain(a.id);
    expect(JSON.stringify(detalles(c))).toContain(b.id);
    expect((await pos(caj, 'cancelarCarrito', { carritoId: a.id, motivo: 'Se fue' })).status).toBe(200);
    expect((await pos(caj, 'cancelarCarrito', { carritoId: b.id, motivo: 'Se fue' })).status).toBe(200);
    // Ya cerrado el turno, el afterEach vuelve a cerrar por la vía forzada: se reabre uno nuevo para que ese cierre no falle.
    const cierre = await pos(caj, 'cerrarTurno', { turnoId, contado: { BOB: 1000 } });
    expect(cierre.status, JSON.stringify(cierre.error)).toBe(200);
    turnoId = uuid();
    expect((await pos(caj, 'abrirTurno', { turnoId, apertura: { BOB: 1000 } })).status).toBe(200);
  });

  it('cierre forzado: cancela los carritos abiertos con el motivo, borra su contenido y audita cada uno', async () => {
    const a = await crear(caj);
    const b = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: a.id, version: a.version, contenido: CONTENIDO });
    const forzado = await pos(adm, 'cerrarTurnoForzado', { turnoId, contado: { BOB: 1000 }, motivo: 'Cajero se fue sin cerrar' });
    expect(forzado.status, JSON.stringify(forzado.error)).toBe(200);
    for (const { id } of [a, b]) {
      const d = await docCarrito(id);
      expect(d).toMatchObject({ estado: 'cancelado', motivoCancelacion: 'Cajero se fue sin cerrar' });
      expect(d['contenido']).toBeUndefined();
      expect(await auditoria('pos.carrito.cancelar_forzado', `tenants/${A}/carritos/${id}`)).toHaveLength(1);
    }
    // El afterEach cierra de nuevo: abre otro turno para que su cierre forzado tenga qué cerrar.
    turnoId = uuid();
    expect((await pos(caj, 'abrirTurno', { turnoId, apertura: { BOB: 1000 } })).status).toBe(200);
  });

  it('cobro con carrito: idempotente, cierra el carrito, borra el contenido y la repetición no duplica', async () => {
    const { id, version } = await crear(caj);
    const g = await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    const v = carritoDe(g)['version'] as number;
    const cobro = { requestId: id, carrito: CARRITO_VENTA, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }], carritoId: id, carritoVersion: v };
    const r1 = await pos(caj, 'confirmarVenta', cobro);
    expect(r1.status, JSON.stringify(r1.error)).toBe(200);
    expect(res(r1)['repetida']).toBe(false);
    const r2 = await pos(caj, 'confirmarVenta', cobro);
    expect(r2.status, JSON.stringify(r2.error)).toBe(200);
    expect(res(r2)['repetida']).toBe(true);
    const d = await docCarrito(id);
    expect(d).toMatchObject({ estado: 'cerrado', ventaId: id });
    expect(d['contenido']).toBeUndefined();
    expect(res(await pos(caj, 'misCarritos', {}))['carritos']).toEqual([]);
    const venta = await h.firestore.doc(`tenants/${A}/ventas/${id}`).get();
    expect(venta.data()).toMatchObject({ carritoId: id });
    // Un carrito cobrado ya no se guarda ni se cancela.
    expect(codigo(await pos(caj, 'guardarCarrito', { carritoId: id, version: v + 1, etiqueta: 'x' }))).toBe('carrito-cerrado');
    expect(codigo(await pos(caj, 'cancelarCarrito', { carritoId: id, motivo: 'tarde' }))).toBe('carrito-cerrado');
  });

  it('cobro con una versión vieja del carrito: conflicto con el vigente y sin venta', async () => {
    const { id, version } = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    const r = await pos(caj, 'confirmarVenta', { requestId: id, carrito: CARRITO_VENTA, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }], carritoId: id, carritoVersion: version });
    expect(codigo(r)).toBe('carrito-conflicto');
    expect(detalles(r)['carrito']).toMatchObject({ carritoId: id, version: version + 1 });
    expect((await h.firestore.doc(`tenants/${A}/ventas/${id}`).get()).exists).toBe(false);
  });

  it('aprobación ligada al carrito: no sirve para otro carrito ni sin carrito; sí para el suyo', async () => {
    const uno = await crear(caj);
    const dos = await crear(caj);
    const aprobacionId = uuid();
    const sol = await pos(caj, 'solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 1000, motivo: 'Cliente frecuente', carritoId: uno.id } });
    expect(sol.status, JSON.stringify(sol.error)).toBe(200);
    expect((await pos(sup, 'resolverAprobacion', { aprobacionId, decision: 'aprobar' })).status).toBe(200);
    const venta = (carritoId: string | undefined, version: number | undefined) => pos(caj, 'confirmarVenta', {
      requestId: carritoId ?? uuid(),
      carrito: { ...CARRITO_VENTA, descuento: { monto: 1000, motivo: 'Cliente frecuente' } },
      pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 6000 }],
      aprobacionId,
      ...(carritoId !== undefined && version !== undefined ? { carritoId, carritoVersion: version } : {}),
    });
    const otroCarrito = await venta(dos.id, dos.version);
    expect(otroCarrito.status).toBe(400);
    expect(codigo(otroCarrito)).toBe('aprobacion-no-coincide');
    expect(codigo(await venta(undefined, undefined))).toBe('aprobacion-no-coincide');
    const propio = await venta(uno.id, uno.version);
    expect(propio.status, JSON.stringify(propio.error)).toBe(200);
  });

  it('pedir una aprobación para un carrito ajeno se rechaza', async () => {
    const { id } = await crear(caj);
    const r = await pos(otroCaj, 'solicitarAprobacion', { aprobacionId: uuid(), solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 1000, motivo: 'x', carritoId: id } });
    expect(codigo(r)).toBe('carrito-ajeno');
  });

  it('sup y adm cancelan un carrito ajeno con motivo y queda auditado con quién y por qué', async () => {
    const a = await crear(caj);
    const b = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: a.id, version: a.version, contenido: CONTENIDO });
    const porSup = await pos(sup, 'cancelarCarrito', { carritoId: a.id, motivo: 'Cliente abandonó' });
    expect(porSup.status, JSON.stringify(porSup.error)).toBe(200);
    const porAdm = await pos(adm, 'cancelarCarrito', { carritoId: b.id, motivo: 'Fin de jornada' });
    expect(porAdm.status, JSON.stringify(porAdm.error)).toBe(200);
    expect(await docCarrito(a.id)).toMatchObject({ estado: 'cancelado', motivoCancelacion: 'Cliente abandonó' });
    expect(await docCarrito(b.id)).toMatchObject({ estado: 'cancelado', motivoCancelacion: 'Fin de jornada' });
    const [entrada] = await auditoria('pos.carrito.cancelar', `tenants/${A}/carritos/${a.id}`);
    expect(entrada).toMatchObject({ uid: sup.uid, rol: 'sup', motivo: 'Cliente abandonó' });
    // Cancelar uno ya cancelado es idempotente; sin motivo se rechaza.
    expect((await pos(sup, 'cancelarCarrito', { carritoId: a.id, motivo: 'Cliente abandonó' })).status).toBe(200);
    expect((await pos(sup, 'cancelarCarrito', { carritoId: uuid(), motivo: 'x' })).status).toBe(404);
  });

  it('cancelar borra el contenido (cliente y teléfono) del documento', async () => {
    const { id, version } = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    expect(JSON.stringify(await docCarrito(id))).toContain('Ana Pérez');
    expect((await pos(caj, 'cancelarCarrito', { carritoId: id, motivo: 'Cambió de idea' })).status).toBe(200);
    const d = await docCarrito(id);
    expect(d['contenido']).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain('Ana Pérez');
    expect(JSON.stringify(d)).not.toContain('70000000');
  });

  it('un carritoId igual al ventaId de una venta existente da request-en-uso', async () => {
    const { id, version } = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    const cobro = await pos(caj, 'confirmarVenta', { requestId: id, carrito: CARRITO_VENTA, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }], carritoId: id, carritoVersion: version + 1 });
    expect(cobro.status, JSON.stringify(cobro.error)).toBe(200);
    // Una venta sin carrito: su ventaId (= requestId) tampoco se puede usar como carritoId.
    const ventaId = uuid();
    const v = await pos(caj, 'confirmarVenta', { requestId: ventaId, carrito: CARRITO_VENTA, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 7000 }] });
    expect(v.status, JSON.stringify(v.error)).toBe(200);
    const r = await pos(caj, 'crearCarrito', { carritoId: ventaId });
    expect(r.status).toBe(409);
    expect(codigo(r)).toBe('request-en-uso');
    expect((await h.firestore.doc(`tenants/${A}/carritos/${ventaId}`).get()).exists).toBe(false);
  });

  it('la auditoría pos.carrito.crear no contiene la etiqueta', async () => {
    const etiqueta = 'Etiqueta confidencial 7731';
    const { id } = await crear(caj, etiqueta);
    const filas = await auditoria('pos.carrito.crear', `tenants/${A}/carritos/${id}`);
    expect(filas).toHaveLength(1);
    expect(JSON.stringify(filas)).not.toContain(etiqueta);
    expect(JSON.stringify(filas)).not.toContain('7731');
  });

  it('supervisión muestra el resumen de carritos abiertos sin cliente ni teléfono', async () => {
    const { id, version } = await crear(caj);
    await pos(caj, 'guardarCarrito', { carritoId: id, version, contenido: CONTENIDO });
    const r = await pos(sup, 'supervision', {});
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const texto = JSON.stringify(r.resultado);
    expect(texto).toContain(id);
    expect(texto).not.toContain('Ana Pérez');
    expect(texto).not.toContain('70000000');
  });
});
