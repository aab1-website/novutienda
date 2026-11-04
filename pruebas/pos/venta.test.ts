import { LimiteDelPlan, SinCotizacionUtilizable, validarEvento } from '@plataforma/nucleo';
import { confirmarVenta, ErrorPos } from '@plataforma/pos';
import { describe, expect, it } from 'vitest';
import {
  AHORA, SerieNoDisponible, StockInsuficiente, T, UUID, abrir, adm, auditoria, caj, caj2, carritoP1, crearEntorno, efectivo, eventos, stock, sup,
  venderP1,
} from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};

describe('confirmarVenta: camino feliz', () => {
  it('recalcula precio y total en el servidor, descuenta stock y publica un evento válido', async () => {
    const e = crearEntorno();
    await abrir(e);
    const r = await venderP1(e, 1, caj, 2);
    expect(r.repetida).toBe(false);
    expect(r.venta.lineas[0]).toMatchObject({ nombre: 'Producto p1', precioUnitario: 7000, cantidad: 2 });
    expect(r.venta.total).toBe(14000);
    expect(r.venta.receiptNo).toBe(1);
    expect(r.venta.cotizacion?.par).toBe('BOB/USD');
    expect(stock(e, 'tienda', 'p1')).toBe(8);
    const ev = eventos(e, 'venta.confirmada');
    expect(ev).toHaveLength(1);
    expect(validarEvento(ev[0]).ok).toBe(true);
    expect(auditoria(e).some((a) => a['accion'] === 'pos.venta.confirmar')).toBe(true);
    // el turno acumula el efectivo
    const turno = e.db.dato(`tenants/${T}/turnos/${UUID(900)}`) as { totales: { BOB: { efectivo: number } } };
    expect(turno.totales.BOB.efectivo).toBe(14000);
  });

  it('el contador del recibo es correlativo', async () => {
    const e = crearEntorno();
    await abrir(e);
    const a = await venderP1(e, 1);
    const b = await venderP1(e, 2);
    expect([a.venta.receiptNo, b.venta.receiptNo]).toEqual([1, 2]);
    expect(e.db.dato(`tenants/${T}/contadores/recibo_A`)).toMatchObject({ ultimo: 2 });
    // El POS es el dueño del número: viaja en el evento para que Recibos lo use tal cual.
    const numeros = eventos(e, 'venta.confirmada').map((x) => (x['datos'] as { numeroRecibo: string }).numeroRecibo).sort();
    expect(numeros).toEqual(['A-000001', 'A-000002']);
  });

  it('venta en USD no lleva cotización y en ARS usa la lista AR', async () => {
    const e = crearEntorno();
    await abrir(e, caj, { BOB: 0, USD: 0, ARS: 0 });
    const u = await confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'USD', lineas: [{ productoId: 'p1', cantidad: 1 }] }, [
      { medio: 'transferencia', moneda: 'USD', monto: 1000 },
    ]);
    expect(u.venta.cotizacion).toBeNull();
    expect(u.venta.total).toBe(1000);
    const a = await confirmarVenta(e.deps, T, caj, UUID(2), { mercado: 'AR', moneda: 'ARS', lineas: [{ productoId: 'p1', cantidad: 1 }] }, [
      { medio: 'transferencia', moneda: 'ARS', monto: 1000000 },
    ]);
    expect(a.venta.total).toBe(1000000);
  });

  it('el efectivo con cambio suma neto de cambio', async () => {
    const e = crearEntorno();
    await abrir(e);
    await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), [efectivo(10000, 3000)]);
    const turno = e.db.dato(`tenants/${T}/turnos/${UUID(900)}`) as { totales: { BOB: { efectivo: number } } };
    expect(turno.totales.BOB.efectivo).toBe(7000);
  });
});

describe('confirmarVenta: turno', () => {
  it('sin turno abierto se rechaza', async () => {
    const e = crearEntorno();
    expect(await codigo(venderP1(e, 1))).toBe('sin-turno');
  });
  it('con el turno de otro usuario se rechaza', async () => {
    const e = crearEntorno();
    await abrir(e, caj);
    expect(await codigo(venderP1(e, 1, caj2))).toBe('turno-ajeno');
    expect(await codigo(venderP1(e, 2, sup))).toBe('turno-ajeno');
  });
  it('segundo turno con la caja ocupada lo rechaza el núcleo', async () => {
    const e = crearEntorno();
    await abrir(e, caj);
    await expect(abrir(e, caj2, { BOB: 0 }, UUID(901))).rejects.toBeInstanceOf(ErrorPos);
  });
  it('el cupo de caja del núcleo se agota aunque el puntero faltara', async () => {
    const e = crearEntorno();
    await abrir(e, caj);
    e.db.poner(`tenants/${T}/pos_config/turno_activo`, undefined);
    await expect(abrir(e, caj2, { BOB: 0 }, UUID(901))).rejects.toBeInstanceOf(LimiteDelPlan);
  });
});

describe('confirmarVenta: precios y total', () => {
  it('rechaza un precio mostrado alterado', async () => {
    const e = crearEntorno();
    await abrir(e);
    const c = { ...carritoP1(), lineas: [{ productoId: 'p1', cantidad: 1, precioMostrado: 100 }] };
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), c, [efectivo(100)]))).toBe('precio-alterado');
    expect(stock(e, 'tienda', 'p1')).toBe(10);
  });
  it('rechaza un total mostrado alterado', async () => {
    const e = crearEntorno();
    await abrir(e);
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(1, { totalMostrado: 1 }), [efectivo(1)]))).toBe('precio-alterado');
  });
  it('ignora un precio que el cliente intente fijar', async () => {
    const e = crearEntorno();
    await abrir(e);
    const c = { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p1', cantidad: 1, precioUnitario: 1 }] } as unknown as Parameters<typeof confirmarVenta>[4];
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), c, [efectivo(1)]))).toBe('pagos-invalidos');
    const ok = await confirmarVenta(e.deps, T, caj, UUID(2), c, [efectivo(7000)]);
    expect(ok.venta.total).toBe(7000);
  });
  it('sin cotización utilizable se rechaza con el error del núcleo', async () => {
    const e = crearEntorno();
    await abrir(e);
    e.db.poner(`tenants/${T}/cotizaciones/BO`, undefined);
    await expect(venderP1(e, 1)).rejects.toBeInstanceOf(SinCotizacionUtilizable);
  });
  it('producto sin precio en la lista, inexistente o inactivo', async () => {
    const e = crearEntorno();
    await abrir(e);
    const v = (id: string, mercado: 'BO' | 'AR' = 'BO') =>
      confirmarVenta(e.deps, T, caj, UUID(5), { mercado, moneda: mercado === 'BO' ? 'BOB' : 'ARS', lineas: [{ productoId: id, cantidad: 1 }] }, [efectivo(1)]);
    expect(await codigo(v('p3', 'AR'))).toBe('sin-precio');
    expect(await codigo(v('nada'))).toBe('producto-inexistente');
    e.db.poner(`tenants/${T}/_productos/p1`, { productoId: 'p1', nombre: 'x', activo: false, preciosUsd: { BO: 1 }, controlaSeries: false });
    expect(await codigo(v('p1'))).toBe('producto-inactivo');
  });
  it('valida el carrito', async () => {
    const e = crearEntorno();
    await abrir(e);
    const v = (c: unknown) => confirmarVenta(e.deps, T, caj, UUID(1), c as never, [efectivo(1)]);
    expect(await codigo(v({ mercado: 'BO', moneda: 'ARS', lineas: [{ productoId: 'p1', cantidad: 1 }] }))).toBe('entrada-invalida');
    expect(await codigo(v({ mercado: 'BO', moneda: 'BOB', lineas: [] }))).toBe('entrada-invalida');
    expect(await codigo(v({ mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p1', cantidad: 0 }] }))).toBe('entrada-invalida');
    expect(await codigo(v({ mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p1', cantidad: 1 }, { productoId: 'p1', cantidad: 1 }] }))).toBe('entrada-invalida');
    expect(await codigo(v({ mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p1', cantidad: 1, almacenId: 'otro' }] }))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(e.deps, T, caj, 'no-uuid', carritoP1(), [efectivo(7000)]))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(e.deps, 'Ten/ant', caj, UUID(1), carritoP1(), [efectivo(7000)]))).toBe('entrada-invalida');
    expect(await codigo(confirmarVenta(e.deps, T, { uid: 'x', rol: 'otro' as never }, UUID(1), carritoP1(), [efectivo(7000)]))).toBe('no-autorizado');
  });
});

describe('confirmarVenta: pagos', () => {
  const venta = async (pagos: unknown, extra: Parameters<typeof carritoP1>[1] = {}) => {
    const e = crearEntorno();
    await abrir(e);
    return { e, c: await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(1, extra), pagos)) };
  };
  it('pagos distintos del total', async () => {
    expect((await venta([efectivo(6999)])).c).toBe('pagos-invalidos');
    expect((await venta([efectivo(7001)])).c).toBe('pagos-invalidos');
    expect((await venta([efectivo(7000, 0), efectivo(5)])).c).toBe('pagos-invalidos');
  });
  it('pagos en otra moneda', async () => {
    expect((await venta([{ medio: 'efectivo', moneda: 'USD', monto: 7000 }])).c).toBe('pagos-invalidos');
    expect((await venta([efectivo(3500), { medio: 'qr', moneda: 'ARS', monto: 3500, referencia: 'r' }])).c).toBe('pagos-invalidos');
  });
  it('cambio solo en efectivo y nunca mayor al monto', async () => {
    expect((await venta([{ medio: 'transferencia', moneda: 'BOB', monto: 8000, cambio: 1000 }])).c).toBe('pagos-invalidos');
    expect((await venta([efectivo(100, 200)])).c).toBe('pagos-invalidos');
  });
  it('QR exige referencia y guarda «registrado por», nunca verificado', async () => {
    expect((await venta([{ medio: 'qr', moneda: 'BOB', monto: 7000 }])).c).toBe('pagos-invalidos');
    const e = crearEntorno();
    await abrir(e);
    const r = await confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), [{ medio: 'qr', moneda: 'BOB', monto: 7000, referencia: 'REF-1' }]);
    expect(r.venta.pagos[0]).toMatchObject({ registradoPor: 'u-caj', referencia: 'REF-1' });
    expect(JSON.stringify(r.venta)).not.toMatch(/verific/i);
    const turno = e.db.dato(`tenants/${T}/turnos/${UUID(900)}`) as { totales: { BOB: { efectivo: number; qr: number } } };
    expect(turno.totales.BOB).toMatchObject({ qr: 7000, efectivo: 0 });
  });
  it('medio no habilitado y pagos mal formados', async () => {
    const e = crearEntorno();
    await abrir(e);
    const cfg = { negocio: { nombre: 'N' }, colores: { primario: '#000000', secundario: '#ffffff' }, mediosHabilitados: ['efectivo'], monedaPorDefecto: 'BOB', topesDescuentoBp: { caj: 500, sup: 1000, adm: 1000 }, textoRecibo: '', serieRecibo: 'A' };
    e.db.poner(`tenants/${T}/pos_config/main`, { config: cfg });
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), [{ medio: 'qr', moneda: 'BOB', monto: 7000, referencia: 'r' }]))).toBe('medio-no-habilitado');
    for (const mal of [[], 'x', [null], [{ ...efectivo(7000), extra: 1 }], [{ ...efectivo(7000), medio: 'cheque' }], [{ ...efectivo(7000), monto: 1.5 }], [{ ...efectivo(7000), cambio: -1 }], [{ ...efectivo(7000), referencia: ' ' }]]) {
      expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(1), carritoP1(), mal))).toBe('pagos-invalidos');
    }
  });
});

describe('confirmarVenta: stock y series', () => {
  it('stock insuficiente aborta todo', async () => {
    const e = crearEntorno();
    await abrir(e);
    await expect(venderP1(e, 1, caj, 11)).rejects.toBeInstanceOf(StockInsuficiente);
    expect(e.db.dato(`tenants/${T}/ventas/${UUID(1)}`)).toBeUndefined();
    expect(e.db.dato(`tenants/${T}/contadores/recibo_A`)).toBeUndefined();
    expect(eventos(e, 'venta.confirmada')).toHaveLength(0);
    const turno = e.db.dato(`tenants/${T}/turnos/${UUID(900)}`) as { totales: object };
    expect(turno.totales).toEqual({});
  });
  it('serie vendida o no disponible aborta; serie válida se vende una vez', async () => {
    const e = crearEntorno();
    await abrir(e);
    const c = (series: string[]) => ({ mercado: 'BO' as const, moneda: 'BOB' as const, lineas: [{ productoId: 'p2', cantidad: 1, series }] });
    await confirmarVenta(e.deps, T, caj, UUID(1), c(['S1']), [efectivo(70000)]);
    await expect(confirmarVenta(e.deps, T, caj, UUID(2), c(['S1']), [efectivo(70000)])).rejects.toBeInstanceOf(SerieNoDisponible);
    expect(stock(e, 'tienda', 'p2')).toBe(2);
    expect(eventos(e, 'venta.confirmada')).toHaveLength(1);
  });
  it('un producto con serie exige una por unidad y uno sin serie no las admite', async () => {
    const e = crearEntorno();
    await abrir(e);
    const v = (productoId: string, cantidad: number, series?: string[]) =>
      codigo(confirmarVenta(e.deps, T, caj, UUID(1), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId, cantidad, ...(series ? { series } : {}) }] }, [efectivo(1)]));
    expect(await v('p2', 1)).toBe('series-invalidas');
    expect(await v('p2', 2, ['S1', 'S1'])).toBe('series-invalidas');
    expect(await v('p1', 1, ['S1'])).toBe('series-invalidas');
  });
  it('dos ventas simultáneas de la última unidad: una gana', async () => {
    const e = crearEntorno();
    await abrir(e);
    const c = (n: number) =>
      confirmarVenta(e.deps, T, caj, UUID(n), { mercado: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p3', cantidad: 1 }] }, [efectivo(3500)]);
    const r = await Promise.allSettled([c(1), c(2)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(stock(e, 'tienda', 'p3')).toBe(0);
    expect(eventos(e, 'venta.confirmada')).toHaveLength(1);
  });
});

describe('confirmarVenta: idempotencia', () => {
  it('reintentar con el mismo requestId descuenta una vez y no repite evento', async () => {
    const e = crearEntorno();
    await abrir(e);
    const a = await venderP1(e, 1);
    const b = await venderP1(e, 1);
    expect(b.repetida).toBe(true);
    expect(b.venta.receiptNo).toBe(a.venta.receiptNo);
    expect(stock(e, 'tienda', 'p1')).toBe(9);
    expect(eventos(e, 'venta.confirmada')).toHaveLength(1);
    expect(e.db.dato(`tenants/${T}/contadores/recibo_A`)).toMatchObject({ ultimo: 1 });
  });
  it('dos reintentos simultáneos descuentan una vez', async () => {
    const e = crearEntorno();
    await abrir(e);
    await Promise.all([venderP1(e, 1), venderP1(e, 1)]);
    expect(stock(e, 'tienda', 'p1')).toBe(9);
    expect(eventos(e, 'venta.confirmada')).toHaveLength(1);
  });
  it('otro usuario no puede reclamar un requestId ya usado', async () => {
    const e = crearEntorno();
    await abrir(e);
    await venderP1(e, 1);
    expect(await codigo(venderP1(e, 1, adm))).toBe('request-en-uso');
  });
});

describe('confirmarVenta: reloj', () => {
  it('la venta guarda el instante del servidor', async () => {
    const e = crearEntorno();
    await abrir(e);
    expect((await venderP1(e, 1)).venta.creadoEnMs).toBe(AHORA);
  });
});
