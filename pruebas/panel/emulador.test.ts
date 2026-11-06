// El cliente del panel (`ClienteRemoto` + `TRADUCCION`) contra las funciones REALES en el emulador (Auth, Firestore,
// Storage, Functions): cada operación del panel viaja como `{ accion, tenantId, datos }` por el protocolo HTTP de los
// callables, con ID tokens del emulador de Auth. Sin emulador se omite en `npm test`; `pnpm test:funciones` (probar.mjs) la corre con
// el emulador y APP_CHECK_EXIGIDO=true, y allí su ausencia es un fallo (pruebas/funciones/emulador.test.ts).
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ClienteRemoto, ErrorApi, mensajeDeError, precioDeVenta, type Rol, type Transporte } from '@novutienda/panel';
import { esperarSubida } from '@novutienda/panel/consola';
import { crearUsuario, esperar, hayEmulador, herramientas, llamar, sembrarTenant, uuid, unico, type Herramientas, type Usuario } from '../funciones/ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const TENANT = 'panel-real';
const CODIGOS: Readonly<Record<string, string>> = {
  INVALID_ARGUMENT: 'invalid-argument', FAILED_PRECONDITION: 'failed-precondition', ALREADY_EXISTS: 'already-exists', NOT_FOUND: 'not-found',
  PERMISSION_DENIED: 'permission-denied', RESOURCE_EXHAUSTED: 'resource-exhausted', UNAUTHENTICATED: 'unauthenticated', ABORTED: 'aborted',
  UNAVAILABLE: 'unavailable', INTERNAL: 'internal',
};

/** Transporte de prueba: el protocolo HTTP de los callables con el ID token de un usuario del emulador. */
function transporteDe(u: Usuario): Transporte {
  return {
    async invocar(modulo, sobre) {
      const r = await llamar(modulo, sobre, u.token);
      if (r.error !== undefined) {
        throw new ErrorApi(CODIGOS[r.error.status ?? ''] ?? 'internal', r.error.message ?? 'Error', (r.error.details as object | undefined) ?? {});
      }
      return r.resultado;
    },
  };
}
const clienteDe = (u: Usuario, rol: Rol): ClienteRemoto => new ClienteRemoto(transporteDe(u), () => ({ tenantId: TENANT, rol }));

describe.skipIf(!hayEmulador)('panel contra las funciones reales (emulador)', () => {
  let h: Herramientas;
  let adm: Usuario;
  let sup: Usuario;
  let caj: Usuario;
  let api: { adm: ClienteRemoto; sup: ClienteRemoto; caj: ClienteRemoto };

  beforeAll(async () => {
    h = herramientas();
    await sembrarTenant(h, TENANT, {
      productos: [
        { id: 'cable-hdmi', nombre: 'Cable HDMI 2 m', precioUSD: { bo: 800, ar: 900 }, tienda: 25 },
        { id: 'televisor', nombre: 'Televisor 55', precioUSD: { bo: 45000, ar: 48000 }, tienda: 3, conSerie: true, series: ['TV-1', 'TV-2', 'TV-3'] },
      ],
    });
    adm = await crearUsuario(h, { rol: 'adm', tenant: TENANT });
    sup = await crearUsuario(h, { rol: 'sup', tenant: TENANT });
    caj = await crearUsuario(h, { rol: 'caj', tenant: TENANT });
    api = { adm: clienteDe(adm, 'adm'), sup: clienteDe(sup, 'sup'), caj: clienteDe(caj, 'caj') };
  });

  it('lecturas del vendedor: productos sin costo con existencias por almacén, configuración y turno vacío', async () => {
    const productos = await api.caj.llamar('listarProductos', {});
    const cable = productos.find((p) => p.id === 'cable-hdmi');
    expect(cable).toMatchObject({ nombre: 'Cable HDMI 2 m', precioUSD: { bo: 800, ar: 900 }, activo: true, disponible: true, conSerie: false });
    expect(cable?.existencias.tienda).toBe(25);
    expect(cable?.existencias['deposito-1']).toBe(0);
    expect(cable?.costoUSD).toBeUndefined();
    expect((await api.caj.llamar('leerConfigPos', {})).serieRecibo).toBeTruthy();
    expect(await api.caj.llamar('turnoActual', {})).toBeNull();
    expect(await api.caj.llamar('listarVentas', {})).toEqual([]);
    expect(await api.caj.llamar('listarAprobaciones', {})).toEqual([]);
  });

  it('cotizaciones del día: todos los roles las reciben de pos.cotizaciones, igual que la política de redondeo', async () => {
    for (const cliente of [api.adm, api.sup, api.caj]) {
      const cot = await cliente.llamar('cotizacionesVigentes', {});
      expect(cot.BO).toMatchObject({ par: 'BOB/USD', valor: 7, estado: 'vigente' });
      expect(cot.AR).toMatchObject({ par: 'ARS/USD', valor: 1000 });
    }
  });

  it('turno → venta con cambio → recibo → envío por WhatsApp → vendedor solo ve lo suyo → cierre', async () => {
    const turnoId = uuid();
    const turno = await api.caj.llamar('abrirTurno', { turnoId, apertura: { BOB: 10000 } });
    expect(turno).toMatchObject({ turnoId, estado: 'abierto' });
    expect((await api.caj.llamar('turnoActual', {}))?.turnoId).toBe(turnoId);
    // Otra persona ve la caja ocupada, no el turno.
    expect(await api.sup.llamar('turnoActual', {})).not.toBeNull();

    // Precio de venta calculado por el panel con la cotización vigente y el redondeo del servidor.
    const cot = (await api.sup.llamar('cotizacionesVigentes', {})).BO;
    const unit = precioDeVenta(800, 'BO', 'BOB', cot);
    expect(unit).toMatchObject({ tipo: 'precio', centavos: 5600 });
    const total = 2 * 5600;
    const requestId = uuid();
    const r = await api.caj.llamar('confirmarVenta', {
      requestId,
      carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }], totalMostrado: total },
      pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 20000, cambio: 20000 - total }],
    });
    expect(r.repetida).toBe(false);
    expect(r.venta).toMatchObject({ estado: 'confirmada', total, moneda: 'BOB' });
    expect((await api.caj.llamar('confirmarVenta', { requestId, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }], totalMostrado: total }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 20000, cambio: 20000 - total }] })).repetida).toBe(true);

    // El recibo se emite al consumir el evento.
    const recibo = (await esperar(async () => (await api.caj.llamar('obtenerRecibo', { ventaId: r.venta.ventaId })) ?? undefined, 60_000, 'el recibo de la venta'));
    expect(recibo).toMatchObject({ ventaId: r.venta.ventaId, estado: 'EMITIDO', total });
    expect((await api.caj.llamar('buscarComprobantes', { consulta: {} })).map((x) => x.reciboId)).toContain(recibo.reciboId);
    expect((await api.caj.llamar('buscarComprobantes', { consulta: { numero: recibo.numero } })).length).toBe(1);
    expect((await api.caj.llamar('listarVentas', { turnoId })).map((v) => v.ventaId)).toEqual([r.venta.ventaId]);
    expect((await api.caj.llamar('listarMovimientosCaja', { turnoId }))).toEqual([]);

    // Sin teléfono no hay enlace de WhatsApp.
    expect((await api.caj.llamar('enviarRecibo', { reciboId: recibo.reciboId })).estado).toBe('sin_telefono');
    // Un recibo inexistente: el panel lo trata como «todavía no está listo».
    expect(await api.caj.llamar('obtenerRecibo', { ventaId: uuid() })).toBeNull();

    // El stock bajó.
    expect((await api.sup.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.existencias.tienda).toBe(23);

    // Otro vendedor no ve ventas ni recibos ajenos.
    const otro = await crearUsuario(h, { rol: 'caj', tenant: TENANT });
    const apiOtro = clienteDe(otro, 'caj');
    expect(await apiOtro.llamar('listarVentas', {})).toEqual([]);
    expect(await apiOtro.llamar('buscarComprobantes', { consulta: {} })).toEqual([]);
    expect(await apiOtro.llamar('turnoActual', {})).toBeNull();

    // Supervisión: turnos abiertos y movimientos; cierre con arqueo.
    expect((await api.sup.llamar('listarTurnos', { estado: 'abierto' })).map((t) => t.turnoId)).toEqual([turnoId]);
    const cierre = await api.caj.llamar('cerrarTurno', { turnoId, contado: { BOB: 10000 + total } });
    expect(cierre.turno.estado).toBe('cerrado');
    expect(cierre.arqueo.BOB).toBeDefined();
    expect(await api.caj.llamar('turnoActual', {})).toBeNull();
  });

  it('errores del servidor: el panel conserva code, message y details y los traduce a un mensaje', async () => {
    const sinTurno = await api.caj.llamar('confirmarVenta', {
      requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 5600 }],
    }).catch((x: unknown) => x);
    expect(sinTurno).toBeInstanceOf(ErrorApi);
    expect((sinTurno as ErrorApi).codigoHttps).toBe('not-found');
    expect(mensajeDeError(sinTurno)).toMatch(/turno/i);
    // Stock insuficiente: details.faltantes.
    await api.caj.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    const faltante = await api.caj.llamar('confirmarVenta', {
      requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 500 }], totalMostrado: 500 * 5600 }, pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 500 * 5600 }],
    }).catch((x: unknown) => x);
    expect((faltante as ErrorApi).codigoHttps).toBe('failed-precondition');
    expect((faltante as ErrorApi).detalle.faltantes?.[0]).toMatchObject({ productoId: 'cable-hdmi', almacenId: 'tienda' });
    expect(mensajeDeError(faltante)).toContain('cable-hdmi en tienda');
    // Rol insuficiente (el panel ya lo evita, el servidor decide): se simula con un cliente que cree ser adm.
    const mentiroso = clienteDe(caj, 'adm');
    const denegado = await mentiroso.llamar('ajustar', { operacionId: uuid(), motivo: 'x', lineas: [{ productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: 1 }] }).catch((x: unknown) => x);
    expect((denegado as ErrorApi).codigoHttps).toBe('permission-denied');
    expect(mensajeDeError(denegado)).toBeTruthy();
    // Datos inválidos: details.campos, sin valores.
    const invalido = await api.caj.llamar('abrirTurno', { turnoId: 'no-uuid', apertura: {} }).catch((x: unknown) => x);
    expect((invalido as ErrorApi).codigoHttps).toBe('invalid-argument');
    expect((invalido as ErrorApi).detalle.campos?.length).toBeGreaterThan(0);
  });

  it('inventario: ingreso, traspaso, merma con resolución por otra persona, conteo ciego y movimientos', async () => {
    await api.sup.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'deposito-1', lineas: [{ productoId: 'cable-hdmi', cantidad: 10 }] });
    await api.sup.llamar('traspasar', { operacionId: uuid(), origenId: 'deposito-1', destinoId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 4 }] });
    const p = (await api.sup.llamar('listarProductos', {})).find((x) => x.id === 'cable-hdmi');
    expect(p?.existencias['deposito-1']).toBe(6);
    const movs = await api.sup.llamar('listarMovimientos', { productoId: 'cable-hdmi' });
    expect(movs.length).toBeGreaterThan(2);
    expect(movs[0]).toMatchObject({ productoId: 'cable-hdmi' });
    expect(typeof movs[0]?.id).toBe('string');
    expect(typeof movs[0]?.fecha).toBe('string');
    expect((await api.sup.llamar('listarMovimientos', { tipo: 'traspaso', limite: 20 })).every((m) => m.tipo === 'traspaso')).toBe(true);
    // Merma: la pide un vendedor, la resuelve un supervisor.
    const mermaId = uuid();
    await api.caj.llamar('solicitarMerma', { operacionId: mermaId, productoId: 'cable-hdmi', ubicacionId: 'tienda', cantidad: 1, motivo: 'Cable roto' });
    const pendientes = await api.sup.llamar('listarMermas', { estado: 'solicitada' });
    expect(pendientes.find((m) => m.mermaId === mermaId)).toMatchObject({ productoId: 'cable-hdmi', cantidad: 1, estado: 'solicitada' });
    await api.sup.llamar('resolverMerma', { operacionId: uuid(), mermaId, decision: 'aprobada' });
    expect((await api.sup.llamar('listarMermas', { estado: 'aprobada' })).some((m) => m.mermaId === mermaId)).toBe(true);
    // Conteo ciego.
    const conteoId = unico('cnt');
    await api.sup.llamar('abrirConteo', { operacionId: uuid(), conteoId, ubicacionId: 'deposito-1' });
    await api.caj.llamar('registrarLineaConteo', { operacionId: uuid(), conteoId, productoId: 'cable-hdmi', contado: 6 });
    const abierto = (await api.caj.llamar('listarConteos', {})).find((c) => c.conteoId === conteoId);
    expect(abierto).toMatchObject({ estado: 'abierto', ubicacionId: 'deposito-1' });
    expect(abierto?.lineas).toEqual([{ productoId: 'cable-hdmi', contado: 6 }]);
    expect(JSON.stringify(abierto)).not.toContain('teorico');
    await api.sup.llamar('cerrarConteo', { operacionId: uuid(), conteoId });
    expect((await api.sup.llamar('listarConteos', {})).find((c) => c.conteoId === conteoId)?.estado).toBe('cerrado');
    // Serie.
    const series = await api.sup.llamar('buscarSerie', { serie: 'TV-1' });
    expect(series[0]).toMatchObject({ productoId: 'televisor', serie: 'TV-1', estado: 'disponible', ubicacionId: 'tienda' });
    // CSV: el costo solo lo exporta el administrador.
    expect((await api.sup.llamar('exportarProductosCsv', {})).csv).toContain('cable-hdmi');
  });

  it('catálogo: alta con precio en dólares y costo, cambio de precio, edición, tablero, usuarios y publicación', async () => {
    await api.adm.llamar('crearProducto', {
      operacionId: uuid(),
      producto: { id: 'mouse-1', nombre: 'Mouse', categoria: 'Accesorios', sku: 'MOUSE-1', precioUSD: { bo: 1250, ar: 1999 }, costoUSD: 700, minimo: 2, publicado: false },
    });
    let mouse = (await api.adm.llamar('listarProductos', {})).find((p) => p.id === 'mouse-1');
    expect(mouse).toMatchObject({ nombre: 'Mouse', precioUSD: { bo: 1250, ar: 1999 }, costoUSD: 700 });
    // Ni el supervisor ni el vendedor ven el costo.
    expect((await api.sup.llamar('listarProductos', {})).find((p) => p.id === 'mouse-1')?.costoUSD).toBeUndefined();
    await api.adm.llamar('cambiarPrecioUSD', { productoId: 'mouse-1', precioUSD: { bo: 1300, ar: 2000 } });
    await api.adm.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'mouse-1', cambios: { nombre: 'Mouse óptico', minimo: 3, costoUSD: 800 } });
    mouse = (await api.adm.llamar('listarProductos', {})).find((p) => p.id === 'mouse-1');
    expect(mouse).toMatchObject({ nombre: 'Mouse óptico', precioUSD: { bo: 1300, ar: 2000 }, costoUSD: 800, minimo: 3 });
    expect((await api.adm.llamar('exportarProductosCsv', {})).csv).toContain('mouse-1');
    expect((await api.adm.llamar('exportarProductosCsvSitio', {})).csv).toContain('mouse-1');
    const tablero = await api.sup.llamar('obtenerTablero', {});
    expect(tablero.cambiosSinPublicar).toBeGreaterThan(0);
    expect(tablero.uso.productos.tope).toBe(200);
    // Usuarios: el personal ya existe en Auth; el rol se asigna por uid.
    await api.adm.llamar('asignarRol', { uid: caj.uid, rol: 'caj' });
    const usuarios = await api.adm.llamar('listarUsuarios', {});
    expect(usuarios.find((u) => u.uid === caj.uid)).toMatchObject({ rol: 'caj', correo: caj.correo, verificado: true });
    // Plantilla de recibo y configuración del POS.
    const plantilla = await api.caj.llamar('leerPlantilla', {});
    await api.sup.llamar('guardarPlantilla', { plantilla: { ...plantilla, negocio: { ...plantilla.negocio, nombre: 'Casa de prueba' }, pie: 'Gracias por su compra.' } });
    expect((await api.caj.llamar('leerPlantilla', {})).pie).toBe('Gracias por su compra.');
    const cfg = await api.adm.llamar('leerConfigPos', {});
    expect((await api.adm.llamar('guardarConfigPos', { config: cfg })).serieRecibo).toBe(cfg.serieRecibo);
    // Ficha del producto.
    await api.sup.llamar('guardarFicha', { productoId: 'mouse-1', ficha: { slug: 'mouse-optico', descripcion: 'Mouse óptico USB.', garantia: '6 meses', medios: [], seo: { titulo: 'Mouse', descripcion: 'Mouse' }, estado: 'borrador' } });
  });

  it('medios: reservar → subir el original → esperar el estado (el disparador procesa) → finalizar (idempotente, respaldo) → listar → borrar', async () => {
    const original = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toBuffer();
    const subidaId = unico('sub').slice(0, 38);
    const reserva = await api.sup.llamar('reservarSubida', { subidaId, productoId: 'cable-hdmi', tipo: 'foto', bytes: original.length });
    expect(reserva.rutaOriginal).toBe(`tenants/${TENANT}/privado/originales/cable-hdmi/${subidaId}`);
    await h.bucket.file(reserva.rutaOriginal).save(original, { contentType: 'image/jpeg', resumable: false });
    // Como la pantalla: consulta `estadoSubida` con retroceso hasta que el disparador de Storage la resuelve (sin forzar el procesamiento).
    const medio = await esperarSubida(api.sup, subidaId);
    expect(medio).toMatchObject({ id: subidaId, productoId: 'cable-hdmi', tipo: 'foto', ancho: 800, alto: 600 });
    expect(await api.sup.llamar('estadoSubida', { subidaId })).toMatchObject({ estado: 'procesada', medio: { id: subidaId } });
    expect(await api.sup.llamar('finalizarSubida', { subidaId })).toMatchObject({ id: subidaId });
    expect((await api.sup.llamar('listarMedios', { productoId: 'cable-hdmi' })).map((m) => m.id)).toContain(subidaId);
    await api.sup.llamar('borrarMedio', { medioId: subidaId });
    await esperar(async () => !(await api.sup.llamar('listarMedios', { productoId: 'cable-hdmi' })).some((m) => m.id === subidaId), 30_000, 'el borrado del medio');
  });

  it('lecturas que antes eran propuestas: auditoría, fichas, secciones, carruseles, configuración del sitio y series', async () => {
    const llamar = (c: ClienteRemoto, n: string, x: unknown): Promise<unknown> => (c as unknown as { llamar(n: string, x: unknown): Promise<unknown> }).llamar(n, x);
    expect(Array.isArray(await llamar(api.adm, 'listarAuditoria', {}))).toBe(true);
    expect(await llamar(api.sup, 'listarAuditoria', { accion: 'no-existe-xyz' })).toEqual([]);
    for (const n of ['listarFichas', 'listarSecciones', 'listarCarruseles']) expect(Array.isArray(await llamar(api.sup, n, {})), n).toBe(true);
    expect(await llamar(api.sup, 'leerConfigSitio', {})).toSatisfy((x: unknown) => x === null || typeof x === 'object');
    expect(Array.isArray(await llamar(api.caj, 'listarSeries', { productoId: 'televisor' }))).toBe(true);
    // El vendedor no entra a la auditoría: lo decide el servidor.
    const e = await llamar(clienteDe(caj, 'adm'), 'listarAuditoria', {}).catch((x: unknown) => x);
    expect((e as ErrorApi).codigoHttps).toBe('permission-denied');
    expect((e as ErrorApi).detalle.codigo).toBe('acceso-denegado');
  });

  it('exportar ventas y buscar usuario por correo contra el servidor real', async () => {
    const llamar = (c: ClienteRemoto, n: string, x: unknown): Promise<unknown> => (c as unknown as { llamar(n: string, x: unknown): Promise<unknown> }).llamar(n, x);
    expect(String(((await llamar(api.sup, 'exportarVentasCsv', {})) as { csv: string }).csv)).toContain('\n');
    expect(((await llamar(clienteDe(caj, 'sup'), 'exportarVentasCsv', {}).catch((x: unknown) => x)) as ErrorApi).codigoHttps).toBe('permission-denied');
    expect(await llamar(api.adm, 'buscarUsuarioPorCorreo', { correo: sup.correo })).toMatchObject({ uid: sup.uid, correoVerificado: true });
    expect(((await llamar(api.adm, 'buscarUsuarioPorCorreo', { correo: 'nadie-xyz@prueba.test' }).catch((x: unknown) => x)) as ErrorApi).codigoHttps).toBe('not-found');
  });
});
