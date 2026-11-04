import { describe, expect, it } from 'vitest';
import { AHORA, crearEntorno, uuid } from '../ayuda-pruebas.js';
import { NOMBRES_CALLABLE, ROLES_CALLABLE } from '../api/contrato.js';
import { ErrorApi, mensajeDeError } from '../api/errores.js';
import type { Carrito, PagoEntrada } from '../api/tipos.js';

const carritoTv = (extra: Partial<Carrito> = {}, cantidad = 1, series: string[] = ['TV55-001']): Carrito => ({
  mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'tv-55', cantidad, series }], ...extra,
});
const efectivo = (monto: number): PagoEntrada[] => [{ medio: 'efectivo', moneda: 'BOB', monto }];

async function conTurno(rol: 'caj' | 'sup' | 'adm' = 'caj') {
  const e = crearEntorno(rol);
  const turnoId = uuid();
  await e.api.llamar('abrirTurno', { turnoId, apertura: { BOB: 10000 } });
  return { e, turnoId };
}

async function falla(p: Promise<unknown>): Promise<ErrorApi> {
  try {
    await p;
  } catch (x) {
    expect(x).toBeInstanceOf(ErrorApi);
    return x as ErrorApi;
  }
  throw new Error('Debía fallar');
}

describe('doble: permisos del contrato', () => {
  it('cada callable rechaza a los roles que no están en su lista', async () => {
    for (const nombre of NOMBRES_CALLABLE) {
      for (const rol of ['caj', 'sup', 'adm'] as const) {
        if (ROLES_CALLABLE[nombre].includes(rol)) continue;
        const e = crearEntorno(rol);
        const err = await falla(e.api.llamar(nombre, {} as never));
        expect(err.codigoHttps).toBe('permission-denied');
        expect(err.detalle.codigo).toBe('no-autorizado');
      }
    }
  });
  it('el vendedor no ve el costo; el administrador sí', async () => {
    const caj = await crearEntorno('caj').api.llamar('listarProductos', {});
    expect(caj.every((p) => p.costoUSD === undefined)).toBe(true);
    const adm = await crearEntorno('adm').api.llamar('listarProductos', {});
    expect(adm.every((p) => typeof p.costoUSD === 'number')).toBe(true);
  });
});

describe('doble: turnos y arqueo', () => {
  it('no hay venta sin turno ni segundo turno abierto', async () => {
    const e = crearEntorno('caj');
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv(), pagos: efectivo(1) }))).detalle.codigo).toBe('sin-turno');
    await e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } });
    expect((await falla(e.api.llamar('abrirTurno', { turnoId: uuid(), apertura: { BOB: 0 } }))).detalle.codigo).toBe('turno-ya-abierto');
  });
  it('abrir el mismo turno dos veces es idempotente y valida los montos', async () => {
    const e = crearEntorno('caj');
    const turnoId = uuid();
    const a = await e.api.llamar('abrirTurno', { turnoId, apertura: { BOB: 500 } });
    const b = await e.api.llamar('abrirTurno', { turnoId, apertura: { BOB: 500 } });
    expect(b).toEqual(a);
    expect((await falla(e.api.llamar('abrirTurno', { turnoId: 'no-uuid', apertura: { BOB: 1 } }))).detalle.codigo).toBe('entrada-invalida');
  });
  it('el cierre conserva la diferencia negativa (no se tapa en cero)', async () => {
    const { e, turnoId } = await conTurno();
    const r = await e.api.llamar('cerrarTurno', { turnoId, contado: { BOB: 9000 } });
    expect(r.arqueo.BOB).toEqual({ esperado: 10000, contado: 9000, diferencia: -1000 });
    expect(r.turno.diferencia?.BOB).toBe(-1000);
    expect((await falla(e.api.llamar('cerrarTurno', { turnoId, contado: { BOB: 9000 } }))).detalle.codigo).toBe('turno-no-abierto');
  });
  it('exige contar todas las monedas con movimiento', async () => {
    const e = crearEntorno('caj');
    const turnoId = uuid();
    await e.api.llamar('abrirTurno', { turnoId, apertura: { BOB: 100, USD: 100 } });
    expect((await falla(e.api.llamar('cerrarTurno', { turnoId, contado: { BOB: 100 } }))).detalle.codigo).toBe('conteo-faltante');
  });
  it('solo el administrador fuerza el cierre, con motivo', async () => {
    const { e, turnoId } = await conTurno();
    e.como('adm');
    await falla(e.api.llamar('cerrarTurnoForzado', { turnoId, contado: { BOB: 10000 }, motivo: '  ' }));
    const r = await e.api.llamar('cerrarTurnoForzado', { turnoId, contado: { BOB: 10000 }, motivo: 'Se fue sin cerrar' });
    expect(r.turno.estado).toBe('cerrado_forzado');
  });
  it('la supervisión ve todos los turnos; el vendedor, solo el suyo', async () => {
    const { e } = await conTurno('caj');
    expect((await falla(e.api.llamar('listarTurnos', { estado: 'abierto' }))).codigoHttps).toBe('permission-denied');
    expect(await e.api.llamar('turnoActual', {})).not.toBeNull();
    e.como('sup');
    expect(await e.api.llamar('listarTurnos', { estado: 'abierto' })).toHaveLength(1);
    expect(await e.api.llamar('turnoActual', {})).not.toBeNull();
  });
});

describe('doble: venta', () => {
  it('cobra en efectivo con cambio, descuenta stock y serie, emite recibo y es idempotente', async () => {
    const { e } = await conTurno();
    const requestId = uuid();
    const r1 = await e.api.llamar('confirmarVenta', { requestId, carrito: carritoTv(), pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 320000, cambio: 6800 }] });
    // 450 USD * 6,96 = 3132,00 Bs.
    expect(r1.venta.total).toBe(313200);
    expect(r1.repetida).toBe(false);
    const r2 = await e.api.llamar('confirmarVenta', { requestId, carrito: carritoTv(), pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 320000, cambio: 6800 }] });
    expect(r2.repetida).toBe(true);
    const tv = (await e.api.llamar('listarProductos', {})).find((p) => p.id === 'tv-55');
    expect(tv?.existencias.tienda).toBe(2);
    const series = await e.api.llamar('listarSeries', { productoId: 'tv-55', soloDisponibles: true });
    expect(series.map((s) => s.serie)).not.toContain('TV55-001');
    const recibo = await e.api.llamar('obtenerRecibo', { ventaId: requestId });
    expect(recibo?.numero).toBe('A-000001');
    expect(recibo?.lineas[0]?.garantiaHasta).toBe('2027-11-04');
  });
  it('recalcula el precio: un precio o total alterado se rechaza', async () => {
    const { e } = await conTurno();
    const c = carritoTv();
    const alterado = { ...c, lineas: [{ productoId: 'tv-55', cantidad: 1, series: ['TV55-001'], precioMostrado: 1 }] };
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: alterado, pagos: efectivo(313200) }))).detalle.codigo).toBe('precio-alterado');
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { ...c, totalMostrado: 5 }, pagos: efectivo(313200) }))).detalle.codigo).toBe('precio-alterado');
  });
  it('el ARS se redondea al múltiplo de 100 y el USD no usa cotización', async () => {
    const { e } = await conTurno();
    await e.api.llamar('cerrarTurno', { turnoId: (await e.api.llamar('turnoActual', {}))?.turnoId ?? '', contado: { BOB: 10000 } });
    const turnoId = uuid();
    await e.api.llamar('abrirTurno', { turnoId, apertura: { ARS: 0, USD: 0 } });
    const ars = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'AR', moneda: 'ARS', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'efectivo', moneda: 'ARS', monto: 900000 }] });
    expect(ars.venta.total).toBe(900000);
    expect(ars.venta.total % 10000).toBe(0); // múltiplo de 100 pesos
    const usd = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'USD', lineas: [{ productoId: 'cable-hdmi', cantidad: 2 }] }, pagos: [{ medio: 'efectivo', moneda: 'USD', monto: 1600 }] });
    expect(usd.venta.cotizacion).toBeNull();
    expect(usd.venta.total).toBe(1600);
  });
  it('rechaza pagos que no suman, otra moneda, cambio fuera del efectivo y QR sin referencia', async () => {
    const { e } = await conTurno();
    const c: Carrito = { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] };
    const total = 5568;
    const intentar = (pagos: PagoEntrada[]) => falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: c, pagos }));
    expect((await intentar(efectivo(total - 1))).detalle.codigo).toBe('pagos-invalidos');
    expect((await intentar([{ medio: 'efectivo', moneda: 'USD', monto: total }])).detalle.codigo).toBe('pagos-invalidos');
    expect((await intentar([{ medio: 'transferencia', moneda: 'BOB', monto: total + 100, cambio: 100 }])).detalle.codigo).toBe('pagos-invalidos');
    expect((await intentar([{ medio: 'qr', moneda: 'BOB', monto: total }])).detalle.codigo).toBe('pagos-invalidos');
  });
  it('QR se guarda como registrado por el usuario y no suma al efectivo', async () => {
    const { e } = await conTurno();
    const r = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 5568, referencia: 'REF-1' }] });
    expect(r.venta.pagos[0]?.registradoPor).toBe('u-caj');
    const t = await e.api.llamar('turnoActual', {});
    expect(t?.totales.BOB?.qr).toBe(5568);
    expect(t?.totales.BOB?.efectivo).toBe(0);
  });
  it('stock insuficiente y serie vendida abortan; el stock no cambia', async () => {
    const { e } = await conTurno();
    const grande: Carrito = { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'parlante', cantidad: 5 }] };
    const err = await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: grande, pagos: efectivo(87000) }));
    expect(err.detalle.codigo).toBe('stock-insuficiente');
    expect(mensajeDeError(err)).toContain('parlante en tienda');
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv(), pagos: efectivo(313200) });
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv(), pagos: efectivo(313200) }))).detalle.codigo).toBe('serie-no-disponible');
  });
  it('producto con serie exige una serie por unidad; sin serie, ninguna', async () => {
    const { e } = await conTurno();
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv({}, 2, ['TV55-001']), pagos: efectivo(1) }))).detalle.codigo).toBe('series-invalidas');
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1, series: ['X'] }] }, pagos: efectivo(1) }))).detalle.codigo).toBe('series-invalidas');
  });
  it('producto sin precio (a consultar) y moneda que no corresponde a la lista', async () => {
    const { e } = await conTurno('adm');
    await e.api.llamar('cambiarPrecioUSD', { productoId: 'cable-hdmi', precioUSD: { bo: 0, ar: 9 } });
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: efectivo(1) }))).detalle.codigo).toBe('sin-precio');
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'ARS', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: efectivo(1) }))).detalle.codigo).toBe('entrada-invalida');
  });
});

describe('doble: descuentos y aprobaciones', () => {
  const montoDesc = 20000; // 63,9 % del subtotal del cable ×? se usa sobre el televisor (313200): 6,4 %
  it('hasta 5 % pasa sin permiso; por encima exige aprobación de un solo uso', async () => {
    const { e } = await conTurno();
    const chico = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv({ descuento: { monto: 15000, motivo: 'Cliente frecuente' } }), pagos: efectivo(298200) });
    expect(chico.venta.descuento?.aprobacionId).toBeUndefined();
    const segundo = carritoTv({ descuento: { monto: montoDesc, motivo: 'Pidió rebaja' } }, 1, ['TV55-002']);
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: segundo, pagos: efectivo(293200) }))).detalle.codigo).toBe('descuento-sin-aprobacion');
    const aprobacionId = uuid();
    await e.api.llamar('solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'descuento', moneda: 'BOB', monto: montoDesc, motivo: 'Pidió rebaja' } });
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: segundo, pagos: efectivo(293200), aprobacionId }))).detalle.codigo).toBe('aprobacion-no-aprobada');
    e.como('sup');
    await e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'aprobar' });
    e.como('caj');
    const ok = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: segundo, pagos: efectivo(293200), aprobacionId });
    expect(ok.venta.descuento?.aprobadoPor).toBe('u-sup');
    const tercero = carritoTv({ descuento: { monto: montoDesc, motivo: 'Otra vez' } }, 1, ['TV55-003']);
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: tercero, pagos: efectivo(293200), aprobacionId }))).detalle.codigo).toBe('aprobacion-usada');
  });
  it('nadie aprueba su propia solicitud ni se resuelve dos veces', async () => {
    const e = crearEntorno('sup');
    const aprobacionId = uuid();
    await e.api.llamar('solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 100, motivo: 'x' } });
    expect((await falla(e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'aprobar' }))).detalle.codigo).toBe('autoaprobacion');
    e.como('adm');
    await e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'rechazar' });
    expect((await falla(e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'aprobar' }))).detalle.codigo).toBe('estado');
  });
  it('una aprobación de otro solicitante o por menos monto no sirve', async () => {
    const { e } = await conTurno();
    const aprobacionId = uuid();
    await e.api.llamar('solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'descuento', moneda: 'BOB', monto: 100, motivo: 'poco' } });
    e.como('sup');
    await e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'aprobar' });
    e.como('caj');
    const c = carritoTv({ descuento: { monto: montoDesc, motivo: 'más' } });
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: c, pagos: efectivo(293200), aprobacionId }))).detalle.codigo).toBe('aprobacion-no-coincide');
  });
});

describe('doble: crédito, caja y anulaciones', () => {
  it('el crédito exige deudor y, si vende un vendedor, la aprobación de crédito', async () => {
    const { e } = await conTurno();
    const base: Carrito = { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] };
    const pagos: PagoEntrada[] = [{ medio: 'credito', moneda: 'BOB', monto: 5568 }];
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: base, pagos }))).detalle.codigo).toBe('pagos-invalidos');
    const conDeudor = { ...base, cliente: { nombre: 'Ana Pérez' } };
    expect((await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: conDeudor, pagos }))).detalle.codigo).toBe('aprobacion-inexistente');
    const aprobacionId = uuid();
    await e.api.llamar('solicitarAprobacion', { aprobacionId, solicitud: { tipo: 'credito', moneda: 'BOB', monto: 5568, motivo: 'Crédito', deudor: 'Ana Pérez' } });
    e.como('sup');
    await e.api.llamar('resolverAprobacion', { aprobacionId, decision: 'aprobar' });
    e.como('caj');
    const v = await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: conDeudor, pagos, aprobacionCreditoId: aprobacionId });
    e.como('sup');
    const [credito] = await e.api.llamar('listarCreditos', { estado: 'pendiente' });
    e.como('caj');
    expect(credito?.saldo).toBe(5568);
    // Cobro del crédito en efectivo: entra al turno y baja el saldo.
    const cobro = await e.api.llamar('cobrarCredito', { requestId: uuid(), ventaId: v.venta.ventaId, cobro: { medio: 'efectivo', monto: 2000 } });
    expect(cobro.repetido).toBe(false);
    expect((await e.api.llamar('turnoActual', {}))?.totales.BOB?.efectivo).toBe(2000);
    expect((await falla(e.api.llamar('cobrarCredito', { requestId: uuid(), ventaId: v.venta.ventaId, cobro: { medio: 'efectivo', monto: 99999 } }))).detalle.codigo).toBe('credito-saldo-insuficiente');
    expect((await falla(e.api.llamar('cobrarCredito', { requestId: uuid(), ventaId: v.venta.ventaId, cobro: { medio: 'qr', monto: 1 } }))).detalle.codigo).toBe('entrada-invalida');
  });
  it('un egreso mayor al efectivo se rechaza y los movimientos son idempotentes', async () => {
    const { e, turnoId } = await conTurno();
    expect((await falla(e.api.llamar('registrarMovimientoCaja', { requestId: uuid(), movimiento: { tipo: 'egreso', moneda: 'BOB', monto: 10001, motivo: 'Compra' } }))).detalle.codigo).toBe('egreso-excede-efectivo');
    const requestId = uuid();
    await e.api.llamar('registrarMovimientoCaja', { requestId, movimiento: { tipo: 'egreso', moneda: 'BOB', monto: 4000, motivo: 'Compra de bolsas' } });
    const r = await e.api.llamar('registrarMovimientoCaja', { requestId, movimiento: { tipo: 'egreso', moneda: 'BOB', monto: 4000, motivo: 'Compra de bolsas' } });
    expect(r.repetido).toBe(true);
    expect((await e.api.llamar('turnoActual', {}))?.totales.BOB?.egresos).toBe(4000);
    expect(await e.api.llamar('listarMovimientosCaja', { turnoId })).toHaveLength(1);
  });
  it('anulación: la solicita el vendedor, la aprueba otra persona y reembolsa por los medios originales', async () => {
    const { e } = await conTurno();
    const ventaId = uuid();
    await e.api.llamar('confirmarVenta', { requestId: ventaId, carrito: carritoTv(), pagos: [{ medio: 'efectivo', moneda: 'BOB', monto: 200000 }, { medio: 'qr', moneda: 'BOB', monto: 113200, referencia: 'R9' }] });
    expect((await falla(e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Aprobada tras revisar' }))).codigoHttps).toBe('permission-denied');
    const sol = await e.api.llamar('solicitarAnulacion', { ventaId, motivo: 'Cliente devolvió' });
    expect(sol.solicitudAnulacion?.por).toBe('u-caj');
    expect((await falla(e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Aprobada tras revisar' }))).codigoHttps).toBe('permission-denied');
    e.como('sup');
    // El reembolso entra en el turno abierto de la caja (la caja es única), aunque lo apruebe otra persona.
    const r = await e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Aprobada tras revisar' });
    expect(r.reembolsos).toEqual([{ medio: 'efectivo', moneda: 'BOB', monto: 200000 }, { medio: 'qr', moneda: 'BOB', monto: 113200 }]);
    const t = await e.api.llamar('turnoActual', {});
    expect(t?.totales.BOB?.efectivo).toBe(0); // lo cobrado menos lo reembolsado
    expect(t?.totales.BOB?.qr).toBe(0);
    expect((await falla(e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Aprobada tras revisar' }))).detalle.codigo).toBe('venta-ya-anulada');
    const tv = (await e.api.llamar('listarProductos', {})).find((p) => p.id === 'tv-55');
    expect(tv?.existencias.tienda).toBe(3);
    expect((await e.api.llamar('obtenerRecibo', { ventaId }))?.estado).toBe('ANULADO');
  });
  it('quien solicita no aprueba su propia anulación y un vendedor no anula ventas ajenas', async () => {
    const { e } = await conTurno('adm');
    const ventaId = uuid();
    await e.api.llamar('confirmarVenta', { requestId: ventaId, carrito: carritoTv(), pagos: efectivo(313200) });
    await e.api.llamar('solicitarAnulacion', { ventaId, motivo: 'error' });
    expect((await falla(e.api.llamar('aprobarAnulacion', { ventaId, motivo: 'Aprobada tras revisar' }))).detalle.codigo).toBe('autoaprobacion');
    e.como('caj');
    expect((await falla(e.api.llamar('solicitarAnulacion', { ventaId, motivo: 'x' }))).detalle.codigo).toBe('no-autorizado');
  });
  it('listados: ventas propias, auditoría filtrada y configuración del POS', async () => {
    const { e } = await conTurno();
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }, pagos: efectivo(5568) });
    expect(await e.api.llamar('listarVentas', {})).toHaveLength(1);
    e.como('sup');
    expect((await e.api.llamar('listarAuditoria', { accion: 'pos.venta' })).length).toBeGreaterThan(0);
    expect(await e.api.llamar('listarAuditoria', { accion: 'no-existe' })).toHaveLength(0);
    e.como('adm');
    const cfg = await e.api.llamar('leerConfigPos', {});
    expect((await falla(e.api.llamar('guardarConfigPos', { config: { ...cfg, serieRecibo: 'mal serie' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await e.api.llamar('guardarConfigPos', { config: { ...cfg, serieRecibo: 'B' } })).serieRecibo).toBe('B');
    expect((await falla(e.api.llamar('guardarConfigPos', { config: { ...cfg, topesDescuentoBp: { caj: 20000, sup: 1, adm: 1 } } }))).detalle.codigo).toBe('entrada-invalida');
  });
});

describe('doble: inventarios', () => {
  it('la misma operacionId es idempotente y con otro contenido falla', async () => {
    const e = crearEntorno('sup');
    const operacionId = uuid();
    const linea = [{ productoId: 'cable-hdmi', cantidad: 5 }];
    expect((await e.api.llamar('ingresar', { operacionId, ubicacionId: 'tienda', lineas: linea })).repetida).toBe(false);
    expect((await e.api.llamar('ingresar', { operacionId, ubicacionId: 'tienda', lineas: linea })).repetida).toBe(true);
    expect((await falla(e.api.llamar('ingresar', { operacionId, ubicacionId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 6 }] }))).detalle.codigo).toBe('operacion-conflicto');
    const p = (await e.api.llamar('listarProductos', {})).find((x) => x.id === 'cable-hdmi');
    expect(p?.existencias.tienda).toBe(30);
    expect(p?.stockTotal).toBe(40);
  });
  it('ingreso con series crea las unidades; repetir una serie falla; sin series en un producto con serie falla', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'deposito-2', lineas: [{ productoId: 'cel-a1', cantidad: 2, series: ['N1', 'N2'] }] });
    expect((await e.api.llamar('buscarSerie', { serie: 'n1' }))[0]?.ubicacionId).toBe('deposito-2');
    expect((await falla(e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'cel-a1', cantidad: 1, series: ['N1'] }] }))).detalle.codigo).toBe('estado-invalido');
    expect((await falla(e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'cel-a1', cantidad: 1 }] }))).detalle.codigo).toBe('entrada-invalida');
    expect(await e.api.llamar('buscarSerie', { serie: '  ' })).toEqual([]);
  });
  it('traspaso mueve stock y series; origen igual a destino o sin stock falla', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('traspasar', { operacionId: uuid(), origenId: 'deposito-1', destinoId: 'tienda', lineas: [{ productoId: 'tv-55', cantidad: 1, series: ['TV55-004'] }] });
    expect((await e.api.llamar('listarSeries', { productoId: 'tv-55', ubicacionId: 'tienda' })).map((s) => s.serie)).toContain('TV55-004');
    expect((await falla(e.api.llamar('traspasar', { operacionId: uuid(), origenId: 'tienda', destinoId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }))).detalle.codigo).toBe('entrada-invalida');
    const err = await falla(e.api.llamar('traspasar', { operacionId: uuid(), origenId: 'deposito-2', destinoId: 'tienda', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }] }));
    expect(err.detalle.codigo).toBe('stock-insuficiente');
    expect((await e.api.llamar('listarMovimientos', { tipo: 'traspaso' })).length).toBe(2);
  });
  it('el ajuste es de administrador, exige motivo y no admite productos con serie', async () => {
    const e = crearEntorno('adm');
    await falla(e.api.llamar('ajustar', { operacionId: uuid(), motivo: ' ', lineas: [{ productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: 1 }] }));
    expect((await falla(e.api.llamar('ajustar', { operacionId: uuid(), motivo: 'Rotura', lineas: [{ productoId: 'tv-55', ubicacionId: 'tienda', delta: -1 }] }))).detalle.codigo).toBe('estado-invalido');
    await e.api.llamar('ajustar', { operacionId: uuid(), motivo: 'Rotura', lineas: [{ productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: -5 }] });
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'cable-hdmi')?.existencias.tienda).toBe(20);
    expect((await falla(e.api.llamar('ajustar', { operacionId: uuid(), motivo: 'Mucho', lineas: [{ productoId: 'cable-hdmi', ubicacionId: 'tienda', delta: -999 }] }))).detalle.codigo).toBe('stock-insuficiente');
    e.como('sup');
    expect((await falla(e.api.llamar('ajustar', { operacionId: uuid(), motivo: 'x', lineas: [] }))).codigoHttps).toBe('permission-denied');
  });
  it('merma: quien solicita no la resuelve; aprobada descuenta y pasa la serie a merma; no se resuelve dos veces', async () => {
    const e = crearEntorno('sup');
    await e.api.llamar('solicitarMerma', { operacionId: 'op-merma-1', productoId: 'tv-55', ubicacionId: 'tienda', cantidad: 1, series: ['TV55-002'], motivo: 'Pantalla rota' });
    const [m] = await e.api.llamar('listarMermas', { estado: 'solicitada' });
    expect(m?.estado).toBe('solicitada');
    const mermaId = m?.mermaId ?? '';
    expect((await falla(e.api.llamar('resolverMerma', { operacionId: uuid(), mermaId, decision: 'aprobada' }))).detalle.codigo).toBe('estado-invalido');
    e.como('adm');
    await e.api.llamar('resolverMerma', { operacionId: uuid(), mermaId, decision: 'aprobada' });
    expect((await e.api.llamar('buscarSerie', { serie: 'TV55-002' }))[0]?.estado).toBe('merma');
    expect((await falla(e.api.llamar('resolverMerma', { operacionId: uuid(), mermaId, decision: 'rechazada' }))).detalle.codigo).toBe('estado-invalido');
    await falla(e.api.llamar('solicitarMerma', { operacionId: uuid(), productoId: 'tv-55', ubicacionId: 'tienda', cantidad: 1, series: ['TV55-002'], motivo: 'otra vez' }));
  });
  it('conteo ciego: el teórico no viaja mientras está abierto; al cerrar, faltante genera merma y sobrante ingresa', async () => {
    const e = crearEntorno('sup');
    const conteoId = 'conteo-1';
    await e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId, ubicacionId: 'tienda' });
    expect((await falla(e.api.llamar('abrirConteo', { operacionId: uuid(), conteoId: 'conteo-2', ubicacionId: 'tienda' }))).detalle.codigo).toBe('estado-invalido');
    await e.api.llamar('registrarLineaConteo', { operacionId: uuid(), conteoId, productoId: 'cable-hdmi', contado: 20 });
    await e.api.llamar('registrarLineaConteo', { operacionId: uuid(), conteoId, productoId: 'parlante', contado: 3 });
    const abierto = (await e.api.llamar('listarConteos', {}))[0];
    expect(JSON.stringify(abierto)).not.toContain('teorico');
    expect(abierto?.resultado).toBeUndefined();
    await e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId });
    const cerrado = (await e.api.llamar('listarConteos', {}))[0];
    expect(cerrado?.resultado).toEqual([{ productoId: 'cable-hdmi', teorico: 25, contado: 20, diferencia: -5 }, { productoId: 'parlante', teorico: 1, contado: 3, diferencia: 2 }]);
    expect((await e.api.llamar('listarMermas', {})).some((m) => m.productoId === 'cable-hdmi' && m.cantidad === 5)).toBe(true);
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'parlante')?.existencias.tienda).toBe(3);
    expect((await falla(e.api.llamar('cerrarConteo', { operacionId: uuid(), conteoId }))).detalle.codigo).toBe('estado-invalido');
    e.como('caj');
    expect((await e.api.llamar('listarConteos', {}))[0]?.resultado).toBeUndefined();
  });
  it('productos: alta con tope de 200, SKU único, conSerie inmutable tras un movimiento; CSV sin costo para sup', async () => {
    const e = crearEntorno('adm');
    const nuevo = { id: 'mouse-1', nombre: 'Mouse', categoria: 'Accesorios', sku: 'MOUSE-1', precioUSD: { bo: 1000, ar: 1100 }, costoUSD: 500 };
    await e.api.llamar('crearProducto', { operacionId: uuid(), producto: nuevo });
    expect((await falla(e.api.llamar('crearProducto', { operacionId: uuid(), producto: nuevo }))).detalle.codigo).toBe('conflicto');
    expect((await falla(e.api.llamar('crearProducto', { operacionId: uuid(), producto: { ...nuevo, id: 'Malo' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('crearProducto', { operacionId: uuid(), producto: { ...nuevo, id: 'mouse-2' } }))).detalle.codigo).toBe('estado-invalido');
    await e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'mouse-1', cambios: { minimo: 4 } });
    await falla(e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'mouse-1', cambios: {} }));
    await e.api.llamar('ingresar', { operacionId: uuid(), ubicacionId: 'tienda', lineas: [{ productoId: 'mouse-1', cantidad: 1 }] });
    expect((await falla(e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'mouse-1', cambios: { conSerie: true } }))).detalle.codigo).toBe('estado-invalido');
    expect((await e.api.llamar('exportarProductosCsv', {})).csv).toContain('costoUSD');
    e.como('sup');
    expect((await e.api.llamar('exportarProductosCsv', {})).csv).not.toContain('costoUSD');
  });
  it('el CSV de exportación neutraliza celdas que empiezan con = + - @', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('crearProducto', { operacionId: uuid(), producto: { id: 'formula-1', nombre: '=HYPERLINK("x")', categoria: '+cmd', sku: 'F-1', precioUSD: { bo: 1, ar: 1 } } });
    const { csv } = await e.api.llamar('exportarProductosCsv', {});
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+cmd");
  });
  it('importación CSV: crea productos, rechaza ids repetidos y filas fuera de rango', async () => {
    const e = crearEntorno('adm');
    const csv = 'id,nombre,categoria,sku,precioUSDbo,precioUSDar\r\nnuevo-1,Nuevo,Cat,N-1,1000,1100\r\n';
    expect((await e.api.llamar('importarProductosCsv', { operacionId: uuid(), csv })).resultado['creados']).toBe(1);
    expect((await falla(e.api.llamar('importarProductosCsv', { operacionId: uuid(), csv }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('importarProductosCsv', { operacionId: uuid(), csv: 'id,nombre\r\nx,y\r\n' }))).detalle.codigo).toBe('entrada-invalida');
  });
});

describe('doble: recibos', () => {
  async function conVenta() {
    const { e } = await conTurno();
    const ventaId = uuid();
    await e.api.llamar('confirmarVenta', { requestId: ventaId, carrito: { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'cable-hdmi', cantidad: 1 }], cliente: { nombre: 'José Núñez', telefono: '70012345' } }, pagos: efectivo(5568) });
    const recibo = await e.api.llamar('obtenerRecibo', { ventaId });
    return { e, ventaId, reciboId: recibo?.reciboId ?? '' };
  }
  it('busca por número, cliente (sin tildes) y fecha; el vendedor ve solo los suyos', async () => {
    const { e } = await conVenta();
    expect(await e.api.llamar('buscarComprobantes', { consulta: { numero: 'a-000001' } })).toHaveLength(1);
    expect(await e.api.llamar('buscarComprobantes', { consulta: { cliente: 'jose nunez' } })).toHaveLength(1);
    expect(await e.api.llamar('buscarComprobantes', { consulta: { desde: '2026-11-05' } })).toHaveLength(0);
    expect((await falla(e.api.llamar('buscarComprobantes', { consulta: { desde: '04/11/2026' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('buscarComprobantes', { consulta: { limite: 999 } }))).detalle.codigo).toBe('entrada-invalida');
    e.como('adm');
    expect(await e.api.llamar('buscarComprobantes', { consulta: {} })).toHaveLength(1);
  });
  it('el enlace de WhatsApp lo arma el servidor (wa.me) y queda el estado; sin teléfono no hay enlace', async () => {
    const { e, reciboId } = await conVenta();
    const r = await e.api.llamar('enviarRecibo', { reciboId });
    expect(r.estado).toBe('enlace_generado');
    expect(r.enlace).toMatch(/^https:\/\/wa\.me\/59170012345\?text=/);
    expect((await e.api.llamar('buscarComprobantes', { consulta: {} }))[0]?.envioWhatsapp.estado).toBe('enlace_generado');
    expect((await e.api.llamar('enviarRecibo', { reciboId, codigoPais: '54' })).enlace).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    await falla(e.api.llamar('enviarRecibo', { reciboId: 'no-existe' }));
  });
  it('referencia de factura SUMA solo para sup/adm, con formato válido', async () => {
    const { e, reciboId } = await conVenta();
    expect((await falla(e.api.llamar('referenciarFacturaSuma', { reciboId, facturaSuma: '123' }))).codigoHttps).toBe('permission-denied');
    e.como('sup');
    expect((await falla(e.api.llamar('referenciarFacturaSuma', { reciboId, facturaSuma: '<script>' }))).detalle.codigo).toBe('entrada-invalida');
    await e.api.llamar('referenciarFacturaSuma', { reciboId, facturaSuma: 'F-2026/123' });
    expect((await e.api.llamar('buscarComprobantes', { consulta: {} }))[0]?.facturaSuma).toBe('F-2026/123');
  });
  it('la plantilla valida el nombre y que el logo sea https', async () => {
    const e = crearEntorno('adm');
    expect((await falla(e.api.llamar('guardarPlantilla', { plantilla: { negocio: { nombre: ' ' } } }))).detalle.codigo).toBe('plantilla-invalida');
    expect((await falla(e.api.llamar('guardarPlantilla', { plantilla: { negocio: { nombre: 'X' }, logoUrl: 'http://x' } }))).detalle.codigo).toBe('plantilla-invalida');
    await e.api.llamar('guardarPlantilla', { plantilla: { negocio: { nombre: 'X' }, pie: 'Gracias' } });
    expect((await e.api.llamar('leerPlantilla', {})).pie).toBe('Gracias');
  });
});

describe('doble: catálogo y sitio', () => {
  it('flujo de subida: reservar, subir, finalizar; topes de 5 fotos y 1 video; tamaño máximo', async () => {
    const e = crearEntorno('sup');
    const reservar = (tipo: 'foto' | 'video', bytes = 1000, subidaId = uuid()) => e.api.llamar('reservarSubida', { subidaId, productoId: 'tv-55', tipo, bytes });
    for (let i = 0; i < 5; i++) {
      const r = await reservar('foto');
      await e.almacen.subir(r.rutaOriginal, new Blob(['x']), () => undefined);
      expect((await e.api.llamar('finalizarSubida', { subidaId: r.subidaId })).tipo).toBe('foto');
    }
    expect((await falla(reservar('foto'))).detalle.codigo).toBe('limite');
    await reservar('video');
    expect((await falla(reservar('video'))).detalle.codigo).toBe('limite');
    expect((await falla(e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'cable-hdmi', tipo: 'foto', bytes: 16 * 1024 * 1024 }))).detalle.codigo).toBe('limite');
    expect((await falla(e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'cable-hdmi', tipo: 'video', bytes: 201 * 1024 * 1024 }))).detalle.codigo).toBe('limite');
    expect((await falla(e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'inexistente', tipo: 'foto', bytes: 1 }))).detalle.codigo).toBe('no-encontrado');
    // Reintento de la misma reserva: idempotente.
    const id = uuid();
    const a = await e.api.llamar('reservarSubida', { subidaId: id, productoId: 'cable-hdmi', tipo: 'foto', bytes: 10 });
    expect(await e.api.llamar('reservarSubida', { subidaId: id, productoId: 'cable-hdmi', tipo: 'foto', bytes: 10 })).toEqual(a);
    expect((await falla(e.api.llamar('reservarSubida', { subidaId: id, productoId: 'cable-hdmi', tipo: 'foto', bytes: 11 }))).detalle.codigo).toBe('conflicto');
  });
  it('ficha: slug único, texto alternativo, medios del producto; publicar la deja en el tablero', async () => {
    const e = crearEntorno('sup');
    const r = await e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    const medio = await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    const base = { slug: 'tv-55', descripcion: 'Un televisor', garantia: '12 meses', medios: [{ medioId: medio.id, alt: 'Frente' }], seo: { titulo: 'TV', descripcion: 'x' }, estado: 'publicado' as const };
    await e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: base });
    expect((await falla(e.api.llamar('guardarFicha', { productoId: 'cel-a1', ficha: { ...base, medios: [] } }))).detalle.codigo).toBe('conflicto');
    expect((await falla(e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { ...base, descripcion: '' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { ...base, medios: [{ medioId: medio.id, alt: ' ' }] } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarFicha', { productoId: 'cel-a1', ficha: { ...base, slug: 'cel', medios: [{ medioId: medio.id, alt: 'x' }] } }))).detalle.codigo).toBe('no-encontrado');
    expect((await falla(e.api.llamar('guardarFicha', { productoId: 'tv-55', ficha: { ...base, slug: 'Mal Slug' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await e.api.llamar('listarFichas', {}))).toHaveLength(1);
    const t = await e.api.llamar('obtenerTablero', {});
    expect(t.cambiosSinPublicar).toBeGreaterThan(0);
    expect(t.uso.originalesBytes.usados).toBe(10);
    expect(t.cotizaciones.map((c) => c.estado)).toEqual(['vigente', 'vigente']);
    expect((await falla(e.api.llamar('publicarSitio', {}))).codigoHttps).toBe('permission-denied');
    e.como('adm');
    const p = await e.api.llamar('publicarSitio', {});
    expect(p.version).toBe(1);
    expect((await e.api.llamar('obtenerTablero', {})).cambiosSinPublicar).toBe(0);
    // Borrar el medio lo quita de la ficha.
    e.como('sup');
    await e.api.llamar('borrarMedio', { medioId: medio.id });
    expect((await e.api.llamar('listarFichas', {}))[0]?.ficha.medios).toEqual([]);
    await falla(e.api.llamar('borrarMedio', { medioId: 'no-existe' }));
  });
  it('secciones: máximo 5, enlaces con lista blanca, orden exacto y medio en uso no se borra', async () => {
    const e = crearEntorno('adm');
    const r = await e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'tv-55', tipo: 'foto', bytes: 10 });
    const m = await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    for (let i = 1; i <= 5; i++) await e.api.llamar('guardarSeccion', { seccion: { id: `s${i}`, titulo: `Sección ${i}`, visible: true, bloques: [{ tipo: i === 1 ? 'imagen' : 'texto', ...(i === 1 ? { medioId: m.id, alt: 'foto' } : { titulo: 'T', parrafos: ['p'] }) } as never] } });
    expect((await falla(e.api.llamar('guardarSeccion', { seccion: { id: 's6', titulo: 'Seis', visible: true, bloques: [{ tipo: 'texto', titulo: 'T', parrafos: [] }] } }))).detalle.codigo).toBe('limite');
    expect((await falla(e.api.llamar('guardarSeccion', { seccion: { id: 's1', titulo: 'Uno', visible: true, bloques: [{ tipo: 'enlaces', items: [{ texto: 'x', url: 'javascript:alert(1)' }] }] } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarSeccion', { seccion: { id: 's1', titulo: 'Uno', visible: true, bloques: [{ tipo: 'enlaces', items: [{ texto: 'x', url: '//evil.test' }] }] } }))).detalle.codigo).toBe('entrada-invalida');
    await e.api.llamar('ordenarSecciones', { orden: ['s5', 's4', 's3', 's2', 's1'] });
    expect((await e.api.llamar('listarSecciones', {})).map((s) => s.id)).toEqual(['s5', 's4', 's3', 's2', 's1']);
    expect((await falla(e.api.llamar('ordenarSecciones', { orden: ['s1'] }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('borrarMedio', { medioId: m.id }))).detalle.codigo).toBe('conflicto');
    await e.api.llamar('eliminarSeccion', { seccionId: 's1' });
    await falla(e.api.llamar('eliminarSeccion', { seccionId: 's1' }));
    await e.api.llamar('borrarMedio', { medioId: m.id });
  });
  it('apariencia: plantilla de lista cerrada, WhatsApp válido, medición válida y carrusel con fotos', async () => {
    const e = crearEntorno('adm');
    const cfg = { plantillaActiva: 'ambar' as const, whatsappNovuchat: '59170000000', medicion: { ga4: 'G-ABC12345' } };
    await e.api.llamar('guardarConfigSitio', { config: cfg });
    expect((await e.api.llamar('leerConfigSitio', {}))?.plantillaActiva).toBe('ambar');
    expect((await falla(e.api.llamar('guardarConfigSitio', { config: { ...cfg, plantillaActiva: 'rosa' as never } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarConfigSitio', { config: { ...cfg, whatsappNovuchat: '123' } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarConfigSitio', { config: { ...cfg, medicion: { ga4: 'xx' } } }))).detalle.codigo).toBe('entrada-invalida');
    expect((await falla(e.api.llamar('guardarCarrusel', { carrusel: { plantilla: 'ambar', items: [{ medioId: 'no-existe', alt: 'x' }] } }))).detalle.codigo).toBe('no-encontrado');
    const r = await e.api.llamar('reservarSubida', { subidaId: uuid(), productoId: 'tv-55', tipo: 'foto', bytes: 5 });
    const m = await e.api.llamar('finalizarSubida', { subidaId: r.subidaId });
    await e.api.llamar('guardarCarrusel', { carrusel: { plantilla: 'ambar', items: [{ medioId: m.id, alt: 'Portada' }] } });
    expect(await e.api.llamar('listarCarruseles', {})).toHaveLength(1);
    expect(await e.api.llamar('listarMedios', { productoId: 'tv-55' })).toHaveLength(1);
  });
  it('productos desde la consola: precios en centavos (el servidor los recibe en dólares), tope de 200 y edición', async () => {
    const e = crearEntorno('adm');
    const nuevo = { id: 'nuevo-x', nombre: 'X', categoria: 'C', sku: 'NX', precioUSD: { bo: 1250, ar: 1300 }, costoUSD: 700 };
    await e.api.llamar('crearProducto', { operacionId: uuid(), producto: nuevo });
    const creado = (await e.api.llamar('listarProductos', {})).find((p) => p.id === 'nuevo-x');
    expect(creado?.precioUSD).toEqual({ bo: 1250, ar: 1300 });
    expect(creado?.costoUSD).toBe(700);
    // En el cable del servidor el precio viaja en dólares decimales y el costo en centavos.
    const alta = e.api.transporte.invocaciones.find((i) => i.accion === 'crearProducto');
    expect(alta?.datos).toMatchObject({ precioUSD: { bo: 12.5, ar: 13 } });
    expect(e.api.transporte.invocaciones.find((i) => i.accion === 'fijarCosto')?.datos).toMatchObject({ costoUSD: 700 });
    expect((await falla(e.api.llamar('crearProducto', { operacionId: uuid(), producto: nuevo }))).detalle.codigo).toBe('conflicto');
    expect((await falla(e.api.llamar('cambiarPrecioUSD', { productoId: 'nuevo-x', precioUSD: { bo: 123.4, ar: 100 } }))).detalle.codigo).toBe('entrada-invalida');
    await e.api.llamar('cambiarPrecioUSD', { productoId: 'nuevo-x', precioUSD: { bo: 1999, ar: 2000 } });
    expect(e.api.transporte.invocaciones.filter((i) => i.accion === 'cambiarPrecioUSD').at(-1)?.datos).toMatchObject({ precioUSD: { bo: 19.99, ar: 20 } });
    await e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'nuevo-x', cambios: { nombre: 'Equis' } });
    await falla(e.api.llamar('actualizarProducto', { operacionId: uuid(), productoId: 'nada', cambios: { nombre: 'a' } }));
    await falla(e.api.llamar('cambiarPrecioUSD', { productoId: 'nada', precioUSD: { bo: 100, ar: 100 } }));
  });
  it('importación con simulación: filas con error bloquean salvo omitirlas; el stock se ignora', async () => {
    const e = crearEntorno('adm');
    const csv = 'id,nombre,categoria,sku,precioBO,precioAR,stock\r\nok-1,Uno,Cat,S1,10,11,50\r\nMAL ID,Dos,Cat,S2,1,1,1\r\ntv-55,Televisor nuevo nombre,Cat,S3,500,520,0\r\n';
    const b64 = btoa(csv);
    const sim = await e.api.llamar('simularImportacion', { contenidoBase64: b64 });
    expect(sim.resumen).toEqual({ crear: 1, actualizar: 1, sinCambios: 0, errores: 1 });
    expect(sim.columnasIgnoradas[0]).toContain('el CSV no modifica el stock');
    const err = await falla(e.api.llamar('importarProductos', { contenidoBase64: b64 }));
    expect(mensajeDeError(err)).toContain('Línea 3');
    const r = await e.api.llamar('importarProductos', { contenidoBase64: b64, omitirErrores: true });
    expect(r.aplicadas).toBe(2);
    expect((await e.api.llamar('listarProductos', {})).find((p) => p.id === 'ok-1')?.existencias.tienda).toBe(0);
    expect((await falla(e.api.llamar('simularImportacion', { contenidoBase64: '***' }))).detalle.codigo).toBe('entrada-invalida');
    expect((await e.api.llamar('exportarProductosCsvSitio', {})).csv).toContain('precioBO');
  });
});

describe('doble: usuarios', () => {
  it('asigna y quita roles de vendedor y supervisor; nunca toca a un administrador', async () => {
    const e = crearEntorno('adm');
    await e.api.llamar('asignarRol', { uid: 'u-caj', rol: 'sup' });
    expect((await e.api.llamar('listarUsuarios', {})).find((u) => u.uid === 'u-caj')?.rol).toBe('sup');
    expect((await falla(e.api.llamar('asignarRol', { uid: 'u-caj', rol: 'adm' }))).detalle.codigo).toBe('jerarquia');
    expect((await falla(e.api.llamar('quitarRol', { uid: 'u-adm' }))).detalle.codigo).toBe('jerarquia');
    expect((await falla(e.api.llamar('asignarRol', { uid: 'nadie', rol: 'caj' }))).detalle.codigo).toBe('no-miembro');
    await e.api.llamar('quitarRol', { uid: 'u-sup' });
    expect(await e.api.llamar('listarUsuarios', {})).toHaveLength(2);
    expect((await falla(e.api.llamar('quitarRol', { uid: 'nadie' }))).detalle.codigo).toBe('no-miembro');
  });
});

describe('doble: alta de personal', () => {
  it('asigna rol a una cuenta existente con correo verificado, respeta el tope de 3 y exige verificación', async () => {
    const e = crearEntorno('adm');
    expect((await e.api.llamar('buscarUsuarioPorCorreo', { correo: 'pendiente@ejemplo.test' })).correoVerificado).toBe(false);
    expect((await falla(e.api.llamar('asignarRol', { uid: 'u-nueva', rol: 'caj' }))).codigoHttps).toBe('resource-exhausted');
    await e.api.llamar('quitarRol', { uid: 'u-sup' });
    expect((await falla(e.api.llamar('asignarRol', { uid: 'u-pendiente', rol: 'caj' }))).detalle.codigo).toBe('correo-no-verificado');
    await e.api.llamar('asignarRol', { uid: 'u-nueva', rol: 'sup' });
    expect((await e.api.llamar('listarUsuarios', {})).map((u) => u.uid)).toContain('u-nueva');
  });
});

describe('doble: aislamiento de la entrada', () => {
  it('el servidor no comparte objetos con el cliente y registra las llamadas', async () => {
    const e = crearEntorno('caj');
    const entrada = { turnoId: uuid(), apertura: { BOB: 100 } };
    const t = await e.api.llamar('abrirTurno', entrada);
    (entrada.apertura as { BOB: number }).BOB = 999;
    (t.apertura as { BOB?: number }).BOB = 555;
    expect((await e.api.llamar('turnoActual', {}))?.apertura.BOB).toBe(100);
    expect(e.api.llamadas.map((l) => l.nombre)).toEqual(['abrirTurno', 'turnoActual']);
    expect(AHORA).toBeGreaterThan(0);
  });
  it('un error no tipado se convierte en ErrorApi', async () => {
    const e = crearEntorno('caj');
    const err = await falla(e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: null as never, pagos: [] }));
    expect(err).toBeInstanceOf(ErrorApi);
  });
});

describe('doble: buscar usuario por correo y exportar ventas', () => {
  it('buscarUsuarioPorCorreo: solo el administrador; devuelve uid y estado de la cuenta; sin cuenta → no encontrado', async () => {
    const e = crearEntorno('adm');
    const [u] = await e.api.llamar('listarUsuarios', {});
    const r = await e.api.llamar('buscarUsuarioPorCorreo', { correo: ` ${(u?.correo ?? '').toUpperCase()} ` });
    expect(r).toEqual({ uid: u?.uid, correoVerificado: u?.verificado, conContrasena: true });
    expect((await falla(e.api.llamar('buscarUsuarioPorCorreo', { correo: 'nadie@ejemplo.test' }))).codigoHttps).toBe('not-found');
    expect((await falla(crearEntorno('sup').api.llamar('buscarUsuarioPorCorreo', { correo: 'a@b.co' }))).codigoHttps).toBe('permission-denied');
  });
  it('exportarVentasCsv: sup/adm reciben el CSV de las ventas del rango; el vendedor no', async () => {
    const { e } = await conTurno('adm');
    await e.api.llamar('confirmarVenta', { requestId: uuid(), carrito: carritoTv(), pagos: efectivo(313200) }).catch(() => undefined);
    const { csv } = await e.api.llamar('exportarVentasCsv', {});
    expect(csv.split('\r\n')[0]).toContain('ventaId');
    expect((await e.api.llamar('exportarVentasCsv', { desde: '2000-01-01', hasta: '2000-01-02' })).csv.trim().split('\r\n')).toHaveLength(1);
    expect((await falla(crearEntorno('caj').api.llamar('exportarVentasCsv', {}))).codigoHttps).toBe('permission-denied');
  });
});
