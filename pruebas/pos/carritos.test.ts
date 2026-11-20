import {
  cancelarCarrito, cerrarTurno, cerrarTurnoForzado, confirmarVenta, crearCarrito, ErrorPos, guardarCarrito, leerCarritosAbiertos, misCarritos, resolverAprobacion, resumirCarrito,
  solicitarAprobacion,
} from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { T, TURNO, UUID, abrir, adm, auditoria, caj, caj2, carritoP1, crearEntorno, efectivo, sup, sup2, stock, type Entorno } from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};
const contenidoP1 = (cantidad = 1, extra: Record<string, unknown> = {}) => ({ mercadoId: 'BO', moneda: 'BOB', lineas: [{ productoId: 'p1', cantidad }], ...extra });
const turnoRaw = (e: Entorno) => e.db.dato(`tenants/${T}/turnos/${TURNO}`) as Record<string, unknown>;
const carritoRaw = (e: Entorno, id: string) => e.db.dato(`tenants/${T}/carritos/${id}`) as Record<string, unknown>;
const C1 = UUID(1001);

describe('crear y guardar', () => {
  it('crea idempotente, con etiqueta por omisión y el índice en el turno', async () => {
    const e = crearEntorno();
    await abrir(e);
    expect(turnoRaw(e)['carritosAbiertos']).toBeUndefined();
    const c = await crearCarrito(e.deps, T, caj, C1);
    expect(c).toMatchObject({ estado: 'abierto', etiqueta: 'Cliente 1', version: 1, cajeroUid: 'u-caj', requestId: C1 });
    expect((await crearCarrito(e.deps, T, caj, UUID(1002))).etiqueta).toBe('Cliente 2');
    await crearCarrito(e.deps, T, caj, C1);
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([C1, UUID(1002)]);
    expect(auditoria(e).filter((a) => a['accion'] === 'pos.carrito.crear')).toHaveLength(2);
    expect(await codigo(crearCarrito(e.deps, T, caj2, C1))).toBe('request-en-uso');
  });
  it('sin turno, con turno ajeno y con tope de 10', async () => {
    const e = crearEntorno();
    expect(await codigo(crearCarrito(e.deps, T, caj, C1))).toBe('sin-turno');
    await abrir(e);
    expect(await codigo(crearCarrito(e.deps, T, caj2, C1))).toBe('turno-ajeno');
    for (let i = 0; i < 10; i += 1) await crearCarrito(e.deps, T, caj, UUID(1100 + i));
    expect(await codigo(crearCarrito(e.deps, T, caj, UUID(1200)))).toBe('limite-carritos');
    await cancelarCarrito(e.deps, T, caj, UUID(1100), 'ya no vuelve');
    await expect(crearCarrito(e.deps, T, caj, UUID(1200))).resolves.toMatchObject({ estado: 'abierto' });
  });
  it('guarda con versión; conflicto devuelve el vigente; ajeno y cerrado se rechazan', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    const g = await guardarCarrito(e.deps, T, caj, C1, 1, { contenido: contenidoP1(2, { cliente: { nombre: 'Ana', telefono: '70000000' } }) });
    expect(g.version).toBe(2);
    expect(g.contenido?.lineas).toEqual([{ productoId: 'p1', almacenId: 'tienda', cantidad: 2, series: [] }]);
    try {
      await guardarCarrito(e.deps, T, caj, C1, 1, { etiqueta: 'Otro' });
      expect.unreachable();
    } catch (err) {
      expect((err as ErrorPos).codigo).toBe('carrito-conflicto');
      expect(((err as ErrorPos).detalle?.['carrito'] as { version: number }).version).toBe(2);
    }
    expect(await codigo(guardarCarrito(e.deps, T, sup, C1, 2, { etiqueta: 'x' }))).toBe('carrito-ajeno');
    expect(await codigo(guardarCarrito(e.deps, T, caj, UUID(1999), 1, { etiqueta: 'x' }))).toBe('carrito-inexistente');
    await cancelarCarrito(e.deps, T, caj, C1, 'cambió de idea');
    expect(await codigo(guardarCarrito(e.deps, T, caj, C1, 3, { etiqueta: 'x' }))).toBe('carrito-cerrado');
  });
  it('valida el contenido', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    const malos: unknown[] = [
      null, { ...contenidoP1(), mercadoId: 'XX' }, { ...contenidoP1(), moneda: 'EUR' }, contenidoP1(0), contenidoP1(1.5),
      { ...contenidoP1(), lineas: [{ productoId: 'a/b', cantidad: 1 }] },
      { ...contenidoP1(), lineas: [{ productoId: 'p1', cantidad: 1 }, { productoId: 'p1', cantidad: 1 }] },
      { ...contenidoP1(), lineas: Array.from({ length: 101 }, (_, i) => ({ productoId: `p${i}`, cantidad: 1 })) },
      contenidoP1(1, { descuento: { monto: 0, motivo: 'x' } }),
    ];
    for (const m of malos) expect(await codigo(guardarCarrito(e.deps, T, caj, C1, 1, { contenido: m }))).toMatch(/entrada-invalida|series-invalidas/);
    const series = Array.from({ length: 101 }, (_, i) => `S${i}`);
    expect(await codigo(guardarCarrito(e.deps, T, caj, C1, 1, { contenido: { ...contenidoP1(), lineas: [{ productoId: 'p2', cantidad: 101, series }] } }))).toBe('series-invalidas');
    expect(await codigo(crearCarrito(e.deps, T, caj, UUID(1300), ''))).toBe('entrada-invalida');
    expect(await codigo(crearCarrito(e.deps, T, caj, UUID(1301), 'x'.repeat(41)))).toBe('entrada-invalida');
  });
});

describe('cancelar y listar', () => {
  it('el dueño cancela; sup/adm cancelan ajenos con motivo; un cajero ajeno no; borra el contenido', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    await guardarCarrito(e.deps, T, caj, C1, 1, { contenido: contenidoP1(1, { cliente: { nombre: 'Ana' } }) });
    expect(await codigo(cancelarCarrito(e.deps, T, caj2, C1, 'x'))).toBe('carrito-ajeno');
    expect(await codigo(cancelarCarrito(e.deps, T, sup, C1, ' '))).toBe('entrada-invalida');
    const c = await cancelarCarrito(e.deps, T, sup, C1, 'sin cliente en caja');
    expect(c).toMatchObject({ estado: 'cancelado', canceladoPor: 'u-sup', motivoCancelacion: 'sin cliente en caja' });
    expect(carritoRaw(e, C1)['contenido']).toBeUndefined();
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([]);
    const a = auditoria(e).find((x) => x['accion'] === 'pos.carrito.cancelar');
    expect(a).toMatchObject({ uid: 'u-sup', motivo: 'sin cliente en caja' });
    // Repetir devuelve el mismo estado; uno inexistente falla.
    await expect(cancelarCarrito(e.deps, T, sup, C1, 'otra vez')).resolves.toMatchObject({ estado: 'cancelado' });
    expect(await codigo(cancelarCarrito(e.deps, T, adm, UUID(1998), 'x'))).toBe('carrito-inexistente');
  });
  it('misCarritos: los del turno propio; vacío para otro usuario o sin turno; resumen sin datos personales', async () => {
    const e = crearEntorno();
    expect((await misCarritos(e.deps, T, caj)).carritos).toEqual([]);
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    await guardarCarrito(e.deps, T, caj, C1, 1, { contenido: contenidoP1(3, { cliente: { nombre: 'Ana', telefono: '700' } }) });
    const { carritos } = await misCarritos(e.deps, T, caj);
    expect(carritos).toHaveLength(1);
    expect((await misCarritos(e.deps, T, sup)).carritos).toEqual([]);
    const r = resumirCarrito(carritos[0]!, carritos[0]!.creadoEnMs + 5000);
    expect(r).toMatchObject({ lineas: 1, unidades: 3, antiguedadMs: 5000, etiqueta: 'Cliente 1' });
    expect(JSON.stringify(r)).not.toMatch(/Ana|700/);
  });
});

describe('cobro de un carrito', () => {
  const cobrar = (e: Entorno, _v: number, actor = caj, id = C1, version = 1) =>
    confirmarVenta(e.deps, T, actor, id, carritoP1(1), [efectivo(7000)], undefined, undefined, { carritoId: id, carritoVersion: version });
  it('cierra el carrito con el ventaId, lo quita del índice, audita y es idempotente', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    const r = await cobrar(e, 1);
    expect(r).toMatchObject({ repetida: false, venta: { ventaId: C1, carritoId: C1 } });
    expect(carritoRaw(e, C1)).toMatchObject({ estado: 'cerrado', ventaId: C1, version: 2 });
    expect(carritoRaw(e, C1)['contenido']).toBeUndefined();
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([]);
    expect(auditoria(e).find((x) => x['accion'] === 'pos.venta.confirmar')?.['resumenDespues']).toMatchObject({ carritoId: C1 });
    expect(stock(e, 'tienda', 'p1')).toBe(9);
    const otra = await cobrar(e, 1);
    expect(otra.repetida).toBe(true);
    expect(stock(e, 'tienda', 'p1')).toBe(9);
  });
  it('rechaza: requestId distinto, versión vieja, ajeno, inexistente', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(5), carritoP1(1), [efectivo(7000)], undefined, undefined, { carritoId: C1, carritoVersion: 1 }))).toBe('entrada-invalida');
    expect(await codigo(cobrar(e, 1, caj, C1, 7))).toBe('carrito-conflicto');
    expect(await codigo(cobrar(e, 1, sup, C1, 1))).toBe('turno-ajeno');
    expect(await codigo(cobrar(e, 1, caj, UUID(1997), 1))).toBe('carrito-inexistente');
    expect(carritoRaw(e, C1)['estado']).toBe('abierto');
    expect(stock(e, 'tienda', 'p1')).toBe(10);
  });
  it('un carrito cancelado no se cobra', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    await cancelarCarrito(e.deps, T, caj, C1, 'no');
    expect(await codigo(cobrar(e, 1))).toBe('carrito-cerrado');
  });
  it('la aprobación de un carrito solo sirve para ese carrito; una sin carrito, solo sin carrito', async () => {
    const e = crearEntorno();
    await abrir(e);
    const C2 = UUID(1002);
    await crearCarrito(e.deps, T, caj, C1);
    await crearCarrito(e.deps, T, caj, C2);
    const sol = { tipo: 'descuento' as const, moneda: 'BOB', monto: 3000, motivo: 'cliente frecuente' };
    expect(await codigo(solicitarAprobacion(e.deps, T, caj, UUID(2001), { ...sol, carritoId: UUID(1996) }))).toBe('carrito-inexistente');
    expect(await codigo(solicitarAprobacion(e.deps, T, sup, UUID(2001), { ...sol, carritoId: C1 }))).toBe('carrito-ajeno');
    await solicitarAprobacion(e.deps, T, caj, UUID(2001), { ...sol, carritoId: C1 });
    await solicitarAprobacion(e.deps, T, caj, UUID(2002), sol);
    await resolverAprobacion(e.deps, T, sup, UUID(2001), 'aprobar');
    await resolverAprobacion(e.deps, T, sup, UUID(2002), 'aprobar');
    const venta = (id: string, apr: string) =>
      confirmarVenta(e.deps, T, caj, id, carritoP1(1, { descuento: { monto: 3000, motivo: 'cliente frecuente' } }), [efectivo(4000)], apr, undefined, { carritoId: id, carritoVersion: 1 });
    // La aprobación del carrito 1 no sirve para el 2; la que no tiene carrito no sirve con carrito.
    expect(await codigo(venta(C2, UUID(2001)))).toBe('aprobacion-no-coincide');
    expect(await codigo(venta(C2, UUID(2002)))).toBe('aprobacion-no-coincide');
    await expect(venta(C1, UUID(2001))).resolves.toMatchObject({ repetida: false });
    // Y sin carrito, la aprobación de un carrito no sirve.
    await solicitarAprobacion(e.deps, T, caj, UUID(2003), { ...sol, carritoId: C2 });
    await resolverAprobacion(e.deps, T, sup, UUID(2003), 'aprobar');
    expect(await codigo(confirmarVenta(e.deps, T, caj, UUID(77), carritoP1(1, { descuento: { monto: 3000, motivo: 'cliente frecuente' } }), [efectivo(4000)], UUID(2003)))).toBe('aprobacion-no-coincide');
  });
  it('resolver una solicitud de un carrito cerrado o cancelado se rechaza', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    await solicitarAprobacion(e.deps, T, caj, UUID(2001), { tipo: 'descuento', moneda: 'BOB', monto: 3000, motivo: 'm', carritoId: C1 });
    await cancelarCarrito(e.deps, T, caj, C1, 'no');
    expect(await codigo(resolverAprobacion(e.deps, T, sup2, UUID(2001), 'aprobar'))).toBe('carrito-cerrado');
  });
});

describe('cierre de turno', () => {
  it('el cierre normal se bloquea con la lista; al cobrar o cancelar, cierra', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1, 'Mesa 1');
    try {
      await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 });
      expect.unreachable();
    } catch (err) {
      expect((err as ErrorPos).codigo).toBe('carritos-abiertos');
      expect((err as ErrorPos).detalle).toEqual({ carritos: [{ carritoId: C1, etiqueta: 'Mesa 1' }] });
    }
    expect(turnoRaw(e)['estado']).toBe('abierto');
    await cancelarCarrito(e.deps, T, caj, C1, 'listo');
    await expect(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 })).resolves.toMatchObject({ turno: { estado: 'cerrado' } });
  });
  it('el cierre forzado cancela los abiertos con el motivo y audita cada uno', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    await crearCarrito(e.deps, T, caj, UUID(1002));
    await guardarCarrito(e.deps, T, caj, C1, 1, { contenido: contenidoP1(1, { cliente: { nombre: 'Ana' } }) });
    await cerrarTurnoForzado(e.deps, T, adm, TURNO, { BOB: 10000 }, 'cajero ausente');
    for (const id of [C1, UUID(1002)]) {
      expect(carritoRaw(e, id)).toMatchObject({ estado: 'cancelado', motivoCancelacion: 'cajero ausente', canceladoPor: 'u-adm' });
      expect(carritoRaw(e, id)['contenido']).toBeUndefined();
    }
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([]);
    expect(auditoria(e).filter((a) => a['accion'] === 'pos.carrito.cancelar_forzado')).toHaveLength(2);
  });
  it('sin carritos el turno no gana el campo carritosAbiertos', async () => {
    const e = crearEntorno();
    await abrir(e);
    await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 });
    expect('carritosAbiertos' in turnoRaw(e)).toBe(false);
  });
});

describe('choques con una venta existente', () => {
  it('crearCarrito rechaza un id que ya es una venta', async () => {
    const e = crearEntorno();
    await abrir(e);
    await confirmarVenta(e.deps, T, caj, C1, carritoP1(1), [efectivo(7000)]);
    expect(await codigo(crearCarrito(e.deps, T, caj, C1))).toBe('request-en-uso');
    expect(carritoRaw(e, C1)).toBeUndefined();
    expect(turnoRaw(e)['carritosAbiertos']).toBeUndefined();
  });
  it('confirmarVenta con vínculo rechaza el requestId de una venta sin ese carrito', async () => {
    const e = crearEntorno();
    await abrir(e);
    await confirmarVenta(e.deps, T, caj, C1, carritoP1(1), [efectivo(7000)]);
    const r = confirmarVenta(e.deps, T, caj, C1, carritoP1(1), [efectivo(7000)], undefined, undefined, { carritoId: C1, carritoVersion: 1 });
    expect(await codigo(r)).toBe('request-en-uso');
    // Sin vínculo, repetir sigue siendo idempotente.
    await expect(confirmarVenta(e.deps, T, caj, C1, carritoP1(1), [efectivo(7000)])).resolves.toMatchObject({ repetida: true });
  });
});

describe('índice del turno con ids que no son carritos abiertos', () => {
  const sembrar = async (e: Entorno): Promise<void> => {
    await crearCarrito(e.deps, T, caj, C1);
    await cancelarCarrito(e.deps, T, caj, C1, 'listo');
    e.db.poner(`tenants/${T}/turnos/${TURNO}`, { ...turnoRaw(e), carritosAbiertos: [UUID(1500), C1] });
  };
  it('el cierre normal los ignora: ni bloquea ni toca el carrito cancelado', async () => {
    const e = crearEntorno();
    await abrir(e);
    await sembrar(e);
    await expect(cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 })).resolves.toMatchObject({ turno: { estado: 'cerrado' } });
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([]);
    expect(carritoRaw(e, C1)).toMatchObject({ estado: 'cancelado', version: 2 });
  });
  it('el cierre normal bloquea solo por los abiertos y los lista sin los demás', async () => {
    const e = crearEntorno();
    await abrir(e);
    await sembrar(e);
    await crearCarrito(e.deps, T, caj, UUID(1501), 'Mesa 2');
    try {
      await cerrarTurno(e.deps, T, caj, TURNO, { BOB: 10000 });
      expect.unreachable();
    } catch (err) {
      expect((err as ErrorPos).codigo).toBe('carritos-abiertos');
      expect((err as ErrorPos).detalle).toEqual({ carritos: [{ carritoId: UUID(1501), etiqueta: 'Mesa 2' }] });
    }
  });
  it('el cierre forzado cancela solo los abiertos y no reescribe los demás', async () => {
    const e = crearEntorno();
    await abrir(e);
    await sembrar(e);
    await cerrarTurnoForzado(e.deps, T, adm, TURNO, { BOB: 10000 }, 'cajero ausente');
    expect(carritoRaw(e, C1)).toMatchObject({ estado: 'cancelado', version: 2, motivoCancelacion: 'listo' });
    expect(auditoria(e).filter((a) => a['accion'] === 'pos.carrito.cancelar_forzado')).toHaveLength(0);
    expect(turnoRaw(e)['carritosAbiertos']).toEqual([]);
  });
});

describe('lectura del índice y de los carritos', () => {
  const cod = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof ErrorPos ? e.codigo : 'otro';
    }
    return 'sin-error';
  };
  it('leerCarritosAbiertos: ausente es undefined; malformado o con más de 10 ids es dato-corrupto', () => {
    expect(leerCarritosAbiertos({})).toBeUndefined();
    expect(leerCarritosAbiertos({ carritosAbiertos: ['a'] })).toEqual(['a']);
    for (const malo of ['a', [1], [''], ['a/b'], Array.from({ length: 11 }, (_, i) => `c${i}`)]) {
      expect(cod(() => leerCarritosAbiertos({ carritosAbiertos: malo }))).toBe('dato-corrupto');
    }
    expect(leerCarritosAbiertos({ carritosAbiertos: Array.from({ length: 10 }, (_, i) => `c${i}`) })).toHaveLength(10);
  });
  it('un carrito con líneas corruptas da dato-corrupto, no NaN', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    for (const lineas of [[{ productoId: 'p1', cantidad: 'x' }], [{ productoId: 'p1', cantidad: 0 }], [{ productoId: 'p1', cantidad: 1.5 }], 'no', [null]]) {
      e.db.poner(`tenants/${T}/carritos/${C1}`, { ...carritoRaw(e, C1), contenido: { mercadoId: 'BO', moneda: 'BOB', lineas } });
      expect(await codigo(misCarritos(e.deps, T, caj))).toBe('dato-corrupto');
    }
  });
  it('crear no deja la etiqueta en la auditoría', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1, 'Ana Pérez');
    const a = auditoria(e).find((x) => x['accion'] === 'pos.carrito.crear');
    expect(JSON.stringify(a)).not.toContain('Ana');
  });
  it('productoId de más de 128 caracteres se rechaza', async () => {
    const e = crearEntorno();
    await abrir(e);
    await crearCarrito(e.deps, T, caj, C1);
    const c = { ...contenidoP1(), lineas: [{ productoId: 'p'.repeat(129), cantidad: 1 }] };
    expect(await codigo(guardarCarrito(e.deps, T, caj, C1, 1, { contenido: c }))).toBe('entrada-invalida');
  });
});
