// Flujo real contra el emulador (Auth + Firestore + Storage + Functions): abrir turno → venta → evento →
// recibo, anulación con reversión de stock, y las negativas de seguridad de los callables.
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { accion, crearUsuario, esperar, hayEmulador, herramientas, sembrarTenant, uuid, llamar, type Herramientas, type Usuario } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const A = 'flujo-a';
const B = 'flujo-b';

describe.skipIf(!hayEmulador)('flujo POS → evento → recibo (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let ajeno: Usuario;
  const turnoId = uuid();
  const ventaId = uuid();

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, A, {
      productos: [
        { id: 'lapiz', nombre: 'Lápiz HB', precioUSD: { bo: 1000, ar: 1000 }, tienda: 10 },
        { id: 'celular', nombre: 'Celular X1', precioUSD: { bo: 10000, ar: 10000 }, tienda: 3, conSerie: true, series: ['S-A', 'S-B', 'S-C'] },
      ],
    });
    await sembrarTenant(h, B);
    adm = await crearUsuario(h, { rol: 'adm', tenant: A });
    sup = await crearUsuario(h, { rol: 'sup', tenant: A });
    caj = await crearUsuario(h, { rol: 'caj', tenant: A });
    ajeno = await crearUsuario(h, { rol: 'adm', tenant: B });
  });

  it('abre el turno, vende, entrega el evento y emite el recibo con el número del POS', async () => {
    const turno = await accion('pos', 'abrirTurno', { turnoId, apertura: { BOB: 10_000 } }, caj.token, A);
    expect(turno.status).toBe(200);

    const venta = await accion(
      'pos', 'confirmarVenta',
      {
        requestId: ventaId,
        carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 2 }], cliente: { nombre: 'Ana Pérez', telefono: '70012345' } },
        pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 15_000, cambio: 1_000 }],
      },
      caj.token, A,
    );
    expect(venta.status, JSON.stringify(venta.error)).toBe(200);
    expect(venta.resultado).toMatchObject({ repetida: false, venta: { total: 14_000, estado: 'confirmada' } });

    // Reintento idempotente: devuelve la venta original sin repetir nada.
    const repetida = await accion('pos', 'confirmarVenta', {
      requestId: ventaId,
      carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'lapiz', cantidad: 2 }], cliente: { nombre: 'Ana Pérez', telefono: '70012345' } },
      pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 15_000, cambio: 1_000 }],
    }, caj.token, A);
    expect(repetida.resultado).toMatchObject({ repetida: true });

    // El disparador del bus entrega venta.confirmada a Recibos.
    const recibo = await esperar(async () => (await h.firestore.doc(`tenants/${A}/recibos/recibo-${ventaId}`).get()).data(), 30_000, 'el recibo emitido por el bus');
    expect(recibo).toMatchObject({ numero: 'A-000001', estado: 'EMITIDO', total: 14_000, moneda: 'BOB', ventaId });

    // Stock: 10 - 2 en tienda.
    const ex = (await h.firestore.doc(`tenants/${A}/existencias/lapiz__tienda`).get()).data();
    expect(ex?.['cantidad']).toBe(8);

    // El vendedor ve sus ventas y su recibo; el PDF sale del servidor.
    const mias = await accion('pos', 'misVentas', {}, caj.token, A);
    expect((mias.resultado as { ventas: unknown[] }).ventas).toHaveLength(1);
    const busqueda = await accion('recibos', 'buscarComprobantes', { numero: 'A-0000' }, caj.token, A);
    expect((busqueda.resultado as { recibos: { numero: string }[] }).recibos.map((r) => r.numero)).toEqual(['A-000001']);
    const pdf = await accion('recibos', 'pdfRecibo', { reciboId: `recibo-${ventaId}` }, caj.token, A);
    expect(Buffer.from((pdf.resultado as { pdfBase64: string }).pdfBase64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
    const envio = await accion('recibos', 'enviarRecibo', { reciboId: `recibo-${ventaId}` }, caj.token, A);
    expect(envio.status, JSON.stringify(envio.error)).toBe(200);
    expect((envio.resultado as { enlace?: string }).enlace).toMatch(/^https:\/\/wa\.me\/591/);
  });

  it('el supervisor aprueba la anulación: revierte stock y anula el recibo', async () => {
    const solicitud = await accion('pos', 'solicitarAnulacion', { ventaId, motivo: 'Cliente devolvió el producto' }, caj.token, A);
    expect(solicitud.status).toBe(200);
    // Un vendedor no aprueba.
    expect((await accion('pos', 'aprobarAnulacion', { ventaId }, caj.token, A)).status).toBe(403);
    const ok = await accion('pos', 'aprobarAnulacion', { ventaId }, sup.token, A);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    await esperar(async () => (await h.firestore.doc(`tenants/${A}/recibos/recibo-${ventaId}`).get()).data()?.['estado'] === 'ANULADO', 30_000, 'recibo anulado');
    await esperar(async () => (await h.firestore.doc(`tenants/${A}/existencias/lapiz__tienda`).get()).data()?.['cantidad'] === 10, 30_000, 'stock revertido');
  });

  it('cierra el turno con el arqueo', async () => {
    const r = await accion('pos', 'cerrarTurno', { turnoId, contado: { BOB: 10_000 } }, caj.token, A);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    const evento = await esperar(async () => (await h.firestore.collection(`tenants/${A}/eventos`).where('tipo', '==', 'turno.cerrado').get()).docs[0]?.data(), 20_000, 'evento turno.cerrado');
    expect(evento).toMatchObject({ tipo: 'turno.cerrado', tenantId: A });
  });

  describe('seguridad de los callables', () => {
    it('sin sesión → 401', async () => {
      expect((await accion('pos', 'leerConfig', {}, undefined, A)).status).toBe(401);
    });

    it('correo sin verificar → 401 aunque tenga rol', async () => {
      const sinVerificar = await crearUsuario(h, { rol: 'adm', tenant: A, verificado: false });
      const r = await accion('pos', 'leerConfig', {}, sinVerificar.token, A);
      expect(r.status).toBe(401);
      expect(r.error?.status).toBe('UNAUTHENTICATED');
    });

    it('un usuario de otro tenant → permission-denied (403)', async () => {
      const r = await accion('pos', 'leerConfig', {}, ajeno.token, A);
      expect(r.status).toBe(403);
      expect(r.error?.status).toBe('PERMISSION_DENIED');
    });

    it('token revocado → 401 (checkRevoked)', async () => {
      const u = await crearUsuario(h, { rol: 'caj', tenant: A });
      expect((await accion('pos', 'leerConfig', {}, u.token, A)).status).toBe(200);
      await new Promise((r) => setTimeout(r, 1200));
      await h.auth.revokeRefreshTokens(u.uid);
      await new Promise((r) => setTimeout(r, 1500));
      expect((await accion('pos', 'leerConfig', {}, u.token, A)).status).toBe(401);
    });

    it('el rol del claim manda: un vendedor no entra a la consola ni a acciones de supervisión', async () => {
      expect((await accion('consola', 'tablero', {}, caj.token, A)).status).toBe(403);
      expect((await accion('pos', 'guardarConfig', { config: {} }, sup.token, A)).status).toBe(403);
      expect((await accion('inventarios', 'ajustar', { operacionId: 'op-x', motivo: 'm', lineas: [{ productoId: 'lapiz', ubicacionId: 'tienda', delta: 1 }] }, sup.token, A)).status).toBe(403);
    });

    it('entrada inválida → 400 sin eco de los valores; acción desconocida → 400', async () => {
      const r = await accion('pos', 'abrirTurno', { turnoId: 'no-es-uuid', apertura: { BOB: 1 }, extra: 'x' }, caj.token, A);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.error)).not.toContain('no-es-uuid');
      expect((await accion('pos', 'noExiste', {}, caj.token, A)).status).toBe(400);
      expect((await llamar('pos', { tenantId: A }, caj.token)).status).toBe(400);
    });

    it('el vendedor no ve ventas ajenas', async () => {
      const otro = await crearUsuario(h, { rol: 'caj', tenant: A });
      const mias = await accion('pos', 'misVentas', {}, otro.token, A);
      expect((mias.resultado as { ventas: unknown[] }).ventas).toHaveLength(0);
      expect((await accion('pos', 'venta', { ventaId }, otro.token, A)).status).toBe(403);
      expect((await accion('recibos', 'leerRecibo', { reciboId: `recibo-${ventaId}` }, otro.token, A)).status).toBe(403);
    });
  });

  it('usuarios: el administrador asigna y quita roles; el claim y el espejo quedan de acuerdo', async () => {
    const nuevo = await crearUsuario(h, {});
    const buscado = await accion('consola', 'buscarUsuarioPorCorreo', { correo: nuevo.correo }, adm.token, A);
    expect(buscado.resultado).toMatchObject({ uid: nuevo.uid, correoVerificado: true, conContrasena: true });
    expect((await accion('consola', 'buscarUsuarioPorCorreo', { correo: 'no-existe@prueba.test' }, adm.token, A)).status).toBe(404);
    // Sin rol todavía: el nuevo no entra.
    expect((await accion('pos', 'leerConfig', {}, nuevo.token, A)).status).toBe(403);
    // Quien no es administrador no asigna roles.
    expect((await accion('consola', 'asignarRol', { uid: nuevo.uid, rol: 'caj' }, sup.token, A)).status).toBe(403);
    const ok = await accion('consola', 'asignarRol', { uid: nuevo.uid, rol: 'sup' }, adm.token, A);
    expect(ok.status, JSON.stringify(ok.error)).toBe(200);
    expect(ok.resultado).toMatchObject({ claim: { pl: { t: { [A]: 'sup' } } } });
    expect((await h.firestore.doc(`tenants/${A}/miembros/${nuevo.uid}`).get()).data()).toMatchObject({ rol: 'sup' });
    // El administrador no otorga el rol `adm` (solo el propietario de la plataforma).
    expect((await accion('consola', 'asignarRol', { uid: nuevo.uid, rol: 'adm' }, adm.token, A)).status).toBe(403);
    const lista = await accion('consola', 'listarUsuarios', {}, sup.token, A);
    expect((lista.resultado as { usuarios: { uid: string; rol: string; correo: string }[] }).usuarios).toContainEqual(expect.objectContaining({ uid: nuevo.uid, rol: 'sup', correo: nuevo.correo }));
    const fuera = await accion('consola', 'quitarRol', { uid: nuevo.uid }, adm.token, A);
    expect(fuera.status, JSON.stringify(fuera.error)).toBe(200);
    expect((await h.firestore.doc(`tenants/${A}/miembros/${nuevo.uid}`).get()).exists).toBe(false);
    // El plan admite 3 usuarios: tres asignaciones caben (el rol quitado liberó su cupo) y la cuarta no.
    for (let n = 1; n <= 3; n++) {
      const u = await crearUsuario(h, {});
      expect((await accion('consola', 'asignarRol', { uid: u.uid, rol: 'caj' }, adm.token, A)).status).toBe(200);
    }
    const cuarto = await crearUsuario(h, {});
    const rechazo = await accion('consola', 'asignarRol', { uid: cuarto.uid, rol: 'caj' }, adm.token, A);
    expect(rechazo.status).toBe(429);
    expect(rechazo.error).toMatchObject({ status: 'RESOURCE_EXHAUSTED', details: { clave: 'usuarios', tope: 3 } });
  });

  it('la política de redondeo sale de la configuración del tenant (BOB 2 decimales; ARS múltiplo de 100)', async () => {
    const r = await accion('consola', 'preciosDelDia', { precioUSD: { bo: 10.01, ar: 10.01 } }, adm.token, A);
    expect(r.status, JSON.stringify(r.error)).toBe(200);
    // 10.01 × 7 = 70.07 BOB; 10.01 × 1000 = 10010 ARS → 10000 (múltiplo de 100 más cercano).
    expect(r.resultado).toMatchObject({ BO: { tipo: 'precio', moneda: 'BOB', monto: 70.07 }, AR: { tipo: 'precio', moneda: 'ARS', monto: 10_000 } });
  });

  it('una configuración de redondeo inválida no se adivina: falla con precondición', async () => {
    const C = 'flujo-c';
    await sembrarTenant(h, C);
    await h.firestore.doc(`tenants/${C}/config/redondeo`).set({ BOB: { tipo: 'decimales', decimales: -1, modo: 'cercano' }, ARS: { tipo: 'ninguno' } });
    const admC = await crearUsuario(h, { rol: 'adm', tenant: C });
    const r = await accion('consola', 'preciosDelDia', { precioUSD: { bo: 1, ar: 1 } }, admC.token, C);
    expect(r.status).toBe(400);
    expect(r.error?.status).toBe('FAILED_PRECONDITION');
    // Una política válida distinta se respeta (ARS al múltiplo de 500 hacia arriba).
    const D = 'flujo-d';
    await sembrarTenant(h, D);
    await h.firestore.doc(`tenants/${D}/config/redondeo`).set({ BOB: { tipo: 'ninguno' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } });
    const admD = await crearUsuario(h, { rol: 'adm', tenant: D });
    const d = await accion('consola', 'preciosDelDia', { precioUSD: { bo: 10.01, ar: 10.01 } }, admD.token, D);
    expect(d.resultado).toMatchObject({ BO: { monto: 70.07 }, AR: { monto: 10_500 } });
  });
});
