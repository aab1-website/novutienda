import { confirmarVenta, ErrorPos, resolverAprobacion, solicitarAprobacion } from '@novutienda/pos';
import { describe, expect, it } from 'vitest';
import { T, UUID, abrir, adm, auditoria, caj, caj2, carritoP1, crearEntorno, efectivo, eventos, sup, sup2, type Entorno } from './ayudas.js';

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (e) {
    return e instanceof ErrorPos ? e.codigo : `otro:${String(e)}`;
  }
  return 'sin-error';
};

// 10 unidades de p1 = 70000 centavos; 5 % = 3500.
const conDescuento = (e: Entorno, n: number, monto: number, aprobacionId?: string, actor = caj) =>
  confirmarVenta(e.deps, T, actor, UUID(n), carritoP1(10, { descuento: { monto, motivo: 'cliente frecuente' } }), [efectivo(70000 - monto)], aprobacionId);

const aprobada = async (e: Entorno, id: number, monto: number, solicitante = caj, aprobador = sup) => {
  await solicitarAprobacion(e.deps, T, solicitante, UUID(id), { tipo: 'descuento', moneda: 'BOB', monto, motivo: 'pedido del cliente' });
  await resolverAprobacion(e.deps, T, aprobador, UUID(id), 'aprobar');
};

describe('descuentos', () => {
  it('hasta el 5 % del vendedor no pide aprobación y viaja en el evento', async () => {
    const e = crearEntorno();
    await abrir(e);
    const r = await conDescuento(e, 1, 3500);
    expect(r.venta.total).toBe(66500);
    expect(r.venta.descuento).toEqual({ monto: 3500, motivo: 'cliente frecuente' });
    expect(eventos(e, 'venta.confirmada')[0]?.['datos']).toMatchObject({ descuento: { monto: 3500 } });
  });

  it('sobre el tope sin aprobación se rechaza', async () => {
    const e = crearEntorno();
    await abrir(e);
    expect(await codigo(conDescuento(e, 1, 3501))).toBe('descuento-sin-aprobacion');
  });

  it('con aprobación de un supervisor pasa y la aprobación queda usada (un solo uso)', async () => {
    const e = crearEntorno();
    await abrir(e);
    await aprobada(e, 50, 7000);
    const r = await conDescuento(e, 1, 7000, UUID(50));
    expect(r.venta.descuento).toMatchObject({ aprobadoPor: 'u-sup', aprobacionId: UUID(50) });
    expect(eventos(e, 'venta.confirmada')[0]?.['datos']).toMatchObject({ descuento: { aprobadoPor: 'u-sup' } });
    expect(await codigo(conDescuento(e, 2, 7000, UUID(50)))).toBe('aprobacion-usada');
  });

  it('reintento de la misma venta no consume la aprobación otra vez', async () => {
    const e = crearEntorno();
    await abrir(e);
    await aprobada(e, 50, 7000);
    await conDescuento(e, 1, 7000, UUID(50));
    expect((await conDescuento(e, 1, 7000, UUID(50))).repetida).toBe(true);
  });

  it('aprobación vencida', async () => {
    const e = crearEntorno();
    await abrir(e);
    await aprobada(e, 50, 7000);
    e.reloj.ahora += 16 * 60 * 1000;
    expect(await codigo(conDescuento(e, 1, 7000, UUID(50)))).toBe('aprobacion-vencida');
  });

  it('nadie resuelve su propia solicitud; el cajero no aprueba', async () => {
    const e = crearEntorno();
    await solicitarAprobacion(e.deps, T, sup, UUID(50), { tipo: 'descuento', moneda: 'BOB', monto: 7000, motivo: 'm' });
    expect(await codigo(resolverAprobacion(e.deps, T, sup, UUID(50), 'aprobar'))).toBe('autoaprobacion');
    expect(await codigo(resolverAprobacion(e.deps, T, caj2, UUID(50), 'aprobar'))).toBe('no-autorizado');
    await resolverAprobacion(e.deps, T, adm, UUID(50), 'aprobar');
    expect(await codigo(resolverAprobacion(e.deps, T, sup2, UUID(50), 'aprobar'))).toBe('aprobacion-usada');
    expect(await codigo(resolverAprobacion(e.deps, T, adm, UUID(51), 'aprobar'))).toBe('aprobacion-inexistente');
  });

  it('una aprobación autoaprobada (documento forjado) no sirve', async () => {
    const e = crearEntorno();
    await abrir(e);
    e.db.poner(`tenants/${T}/aprobaciones_descuento/${UUID(50)}`, {
      aprobacionId: UUID(50), tipo: 'descuento', estado: 'aprobada', moneda: 'BOB', monto: 7000, motivo: 'm',
      solicitadoPor: 'u-caj', aprobadoPor: 'u-caj', aprobadoRol: 'caj', venceEnMs: Number.MAX_SAFE_INTEGER,
    });
    expect(await codigo(conDescuento(e, 1, 7000, UUID(50)))).toBe('autoaprobacion');
  });

  it('pendiente, rechazada, de otro vendedor, de monto menor o de otro tipo', async () => {
    const e = crearEntorno();
    await abrir(e);
    await solicitarAprobacion(e.deps, T, caj, UUID(50), { tipo: 'descuento', moneda: 'BOB', monto: 7000, motivo: 'm' });
    expect(await codigo(conDescuento(e, 1, 7000, UUID(50)))).toBe('aprobacion-no-aprobada');
    await resolverAprobacion(e.deps, T, sup, UUID(50), 'rechazar');
    expect(await codigo(conDescuento(e, 1, 7000, UUID(50)))).toBe('aprobacion-no-aprobada');
    await aprobada(e, 51, 7000, caj2);
    expect(await codigo(conDescuento(e, 1, 7000, UUID(51)))).toBe('aprobacion-no-coincide');
    await aprobada(e, 52, 4000);
    expect(await codigo(conDescuento(e, 1, 7000, UUID(52)))).toBe('aprobacion-no-coincide');
    await solicitarAprobacion(e.deps, T, caj, UUID(53), { tipo: 'credito', moneda: 'BOB', monto: 70000, motivo: 'm', deudor: 'Ana' });
    await resolverAprobacion(e.deps, T, sup, UUID(53), 'aprobar');
    expect(await codigo(conDescuento(e, 1, 7000, UUID(53)))).toBe('aprobacion-no-coincide');
    expect(await codigo(conDescuento(e, 1, 7000, UUID(99)))).toBe('aprobacion-inexistente');
  });

  it('el descuento no puede igualar el subtotal ni faltar el motivo', async () => {
    const e = crearEntorno();
    await abrir(e, sup);
    expect(await codigo(conDescuento(e, 1, 70000, undefined, sup))).toBe('entrada-invalida');
    const c = carritoP1(1, { descuento: { monto: 100, motivo: ' ' } });
    expect(await codigo(confirmarVenta(e.deps, T, sup, UUID(2), c, [efectivo(6900)]))).toBe('entrada-invalida');
  });

  it('el supervisor vende con su propio tope (configurable)', async () => {
    const e = crearEntorno();
    await abrir(e, sup);
    const r = await conDescuento(e, 1, 30000, undefined, sup);
    expect(r.venta.descuento?.aprobadoPor).toBeUndefined();
  });

  it('solicitudes: validación, idempotencia y request ajeno', async () => {
    const e = crearEntorno();
    const base = { tipo: 'descuento' as const, moneda: 'BOB' as const, monto: 100, motivo: 'm' };
    const a = await solicitarAprobacion(e.deps, T, caj, UUID(60), base);
    expect((await solicitarAprobacion(e.deps, T, caj, UUID(60), base)).solicitadoEnMs).toBe(a.solicitadoEnMs);
    expect(await codigo(solicitarAprobacion(e.deps, T, caj2, UUID(60), base))).toBe('request-en-uso');
    expect(await codigo(solicitarAprobacion(e.deps, T, caj, UUID(61), { ...base, tipo: 'x' as never }))).toBe('entrada-invalida');
    expect(await codigo(solicitarAprobacion(e.deps, T, caj, UUID(61), { ...base, moneda: 'EUR' as never }))).toBe('entrada-invalida');
    expect(await codigo(solicitarAprobacion(e.deps, T, caj, UUID(61), { ...base, monto: 0 }))).toBe('entrada-invalida');
    expect(await codigo(solicitarAprobacion(e.deps, T, caj, UUID(61), { ...base, tipo: 'credito' }))).toBe('entrada-invalida');
    expect(await codigo(resolverAprobacion(e.deps, T, sup, UUID(60), 'x' as never))).toBe('entrada-invalida');
  });
});

describe('motivo opcional del rechazo', () => {
  const pedir = async (e: Entorno, n: number) => {
    await solicitarAprobacion(e.deps, T, caj, UUID(n), { tipo: 'descuento', moneda: 'BOB', monto: 7000, motivo: 'pedido del cliente' });
  };
  const leer = async (e: Entorno, n: number) => await Promise.resolve(e.db.dato(`tenants/${T}/aprobaciones_descuento/${UUID(n)}`) as Record<string, unknown>);

  it('rechazar con motivo lo guarda aparte del motivo de la solicitud, recortado, y la auditoría lo lleva', async () => {
    const e = crearEntorno();
    await abrir(e);
    await pedir(e, 60);
    const r = await resolverAprobacion(e.deps, T, sup, UUID(60), 'rechazar', '  Excede lo permitido  ');
    expect(r).toMatchObject({ estado: 'rechazada', motivoRechazo: 'Excede lo permitido', motivo: 'pedido del cliente' });
    expect((await leer(e, 60))['motivoRechazo']).toBe('Excede lo permitido');
    const aud = auditoria(e).find((a) => a['accion'] === 'pos.aprobacion.rechazar');
    expect(aud?.['motivo']).toBe('Excede lo permitido');
  });

  it('sin motivo, con solo espacios o con solo caracteres de control: documento idéntico al de hoy', async () => {
    const e = crearEntorno();
    await abrir(e);
    for (const [n, m] of [[61, undefined], [62, '   '], [63, '\u0000\u0007\n']] as const) {
      await pedir(e, n);
      await resolverAprobacion(e.deps, T, sup, UUID(n), 'rechazar', m);
      const d = await leer(e, n);
      expect(d['estado']).toBe('rechazada');
      expect('motivoRechazo' in d).toBe(false);
    }
  });

  it('quita los caracteres de control y respeta el tope de 200', async () => {
    const e = crearEntorno();
    await abrir(e);
    await pedir(e, 64);
    const r = await resolverAprobacion(e.deps, T, sup, UUID(64), 'rechazar', 'Muy\u0000 alto\u0007\n');
    expect(r.motivoRechazo).toBe('Muy alto');
    await pedir(e, 65);
    expect(await codigo(resolverAprobacion(e.deps, T, sup, UUID(65), 'rechazar', 'x'.repeat(201)))).toBe('entrada-invalida');
    expect((await leer(e, 65))['estado']).toBe('pendiente');
    const ok = await resolverAprobacion(e.deps, T, sup, UUID(65), 'rechazar', 'x'.repeat(200));
    expect(ok.motivoRechazo).toHaveLength(200);
  });

  it('200 caracteres con espacios alrededor se miden crudos (error); invisibles y bidi se quitan', async () => {
    const e = crearEntorno();
    await abrir(e);
    await pedir(e, 67);
    expect(await codigo(resolverAprobacion(e.deps, T, sup, UUID(67), 'rechazar', ` ${'x'.repeat(200)} `))).toBe('entrada-invalida');
    const r = await resolverAprobacion(e.deps, T, sup, UUID(67), 'rechazar', 'A\u200bB\ufeffC\u2028D\u202eE\u2066F');
    expect(r.motivoRechazo).toBe('ABCDEF');
  });

  it('un motivo enviado con «aprobar» se rechaza y la solicitud sigue pendiente', async () => {
    const e = crearEntorno();
    await abrir(e);
    await pedir(e, 66);
    expect(await codigo(resolverAprobacion(e.deps, T, sup, UUID(66), 'aprobar', 'por qué'))).toBe('entrada-invalida');
    expect((await leer(e, 66))['estado']).toBe('pendiente');
  });
});
