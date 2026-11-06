import { describe, expect, it } from 'vitest';
import { validarEvento, type DatosVentaAnuladaV1, type DatosVentaConfirmadaV1, type SobreEvento } from '@novutienda/nucleo';
import {
  EnviadorSimulado, EnviadorWaMe, ReciboNoEncontrado, AccionNoPermitida, buscarComprobantes, enviarRecibo, escaparHtml,
  generarPdfRecibo, guardarPlantilla, manejarVentaAnulada, manejarVentaConfirmada, manifiestoRecibos, referenciarFacturaSuma,
  renderizarReciboHtml, rutaAnulacionPendiente, rutaPlantilla, rutaRecibo, validarPlantilla, type Recibo,
} from '@novutienda/recibos';
import { DobleDb } from './doble-db.js';

const cotizacion = { cotizacionId: 'BO-1', par: 'BOB/USD', valor: 6.96, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' } as const;

type Extra = { [K in keyof DatosVentaConfirmadaV1]?: DatosVentaConfirmadaV1[K] | undefined };

function datosVenta(ventaId: string, extra: Extra = {}): DatosVentaConfirmadaV1 {
  const base: DatosVentaConfirmadaV1 = {
    ventaId, turnoId: 't1', cajaId: 'c1', cajeroUid: 'u-caj', numeroRecibo: `A-${ventaId.replace(/\D/g, '').padStart(6, '0')}`, moneda: 'BOB', total: 125000, cotizacion,
    lineas: [{ productoId: 'p1', nombre: 'Lavarropas 8 kg', cantidad: 2, precioUnitario: 62500, almacenId: 'tienda', series: ['S1', 'S2'], garantiaMeses: 12 }],
    pagos: [{ medio: 'qr', moneda: 'BOB', monto: 125000, referencia: 'REF-SECRETA-1' }],
    cliente: { nombre: 'Ana Pérez', telefono: '70000000' },
  };
  const mezcla: Record<string, unknown> = { ...base, ...extra };
  for (const k of Object.keys(mezcla)) if (mezcla[k] === undefined) delete mezcla[k];
  return mezcla as unknown as DatosVentaConfirmadaV1;
}

function eventoVenta(tenantId: string, ventaId: string, extra: Extra = {}, id = `ev-${ventaId}`): SobreEvento {
  return {
    id, tipo: 'venta.confirmada', version: 1, tenantId, origen: 'pos', ocurridoEn: '2026-11-04T15:00:00Z',
    claveIdempotencia: `venta-${ventaId}`, datos: datosVenta(ventaId, extra),
  };
}

function eventoAnulada(tenantId: string, ventaId: string): SobreEvento {
  const datos: DatosVentaAnuladaV1 = {
    ventaId, turnoId: 't1', motivo: 'Error de digitación', anuladaPor: 'u-caj', aprobadoPor: 'u-sup',
    lineas: [{ productoId: 'p1', cantidad: 2, almacenId: 'tienda', series: ['S1', 'S2'] }],
    reembolsos: [{ medio: 'qr', moneda: 'BOB', monto: 125000 }], turnoIdReembolso: 't1',
  };
  return { id: `an-${ventaId}`, tipo: 'venta.anulada', version: 1, tenantId, origen: 'pos', ocurridoEn: '2026-11-05T15:00:00Z', claveIdempotencia: `anul-${ventaId}`, datos };
}

const recibo = (db: DobleDb, t: string, v: string): Recibo => db.dato(rutaRecibo(t, `recibo-${v}`)) as unknown as Recibo;
const AHORA = { ahora: () => '2026-11-04T15:00:01Z' };

describe('emisión desde venta.confirmada', () => {
  it('arma el comprobante solo con el evento: número del POS, garantía, moneda, cotización, estado', async () => {
    const db = new DobleDb();
    expect(await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA)).toBe(true);
    const r = recibo(db, 't1', 'v1');
    expect(r).toMatchObject({
      reciboId: 'recibo-v1', numero: 'A-000001', estado: 'EMITIDO', moneda: 'BOB', total: 125000, fecha: '2026-11-04',
      cotizacion, envioWhatsapp: { estado: 'no_enviado' },
    });
    expect(r.lineas[0]).toMatchObject({ nombre: 'Lavarropas 8 kg', series: ['S1', 'S2'], garantiaMeses: 12, garantiaHasta: '2027-11-04', subtotal: 125000 });
    expect(r.facturaSuma).toBeUndefined();
  });

  it('no guarda referencias de pago ni importes recibidos', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    expect(JSON.stringify(recibo(db, 't1', 'v1'))).not.toContain('REF-SECRETA');
    expect(recibo(db, 't1', 'v1').pagos[0]).toEqual({ medio: 'qr', moneda: 'BOB', monto: 125000 });
  });

  it('publica recibo.emitido válido en la misma transacción, con la garantía por serie', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const ev = db.dato('tenants/t1/eventos/recibo-emitido-v1');
    expect(ev).toBeDefined();
    expect(validarEvento(ev).ok).toBe(true);
    expect(ev).toMatchObject({
      tipo: 'recibo.emitido', origen: 'recibos',
      datos: { reciboId: 'recibo-v1', numero: 'A-000001', garantias: [{ serie: 'S1', hasta: '2027-11-04' }, { serie: 'S2', hasta: '2027-11-04' }] },
    });
  });

  it('el mismo evento dos veces genera un solo recibo', async () => {
    const db = new DobleDb();
    const ev = eventoVenta('t1', 'v1');
    expect(await manejarVentaConfirmada(db, ev, AHORA)).toBe(true);
    expect(await manejarVentaConfirmada(db, ev, AHORA)).toBe(false);
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(1);
    expect(db.coleccion('tenants/t1/eventos')).toHaveLength(1);
  });

  it('la misma venta reenviada con otro id de evento tampoco genera otro número', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    expect(await manejarVentaConfirmada(db, eventoVenta('t1', 'v1', {}, 'otro-id'), AHORA)).toBe(false);
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(1);
  });

  it('el recibo lleva el número del evento (el POS numera), también con entrega desordenada', async () => {
    const db = new DobleDb();
    const orden = [3, 1, 2, 5, 4];
    for (const n of orden) await manejarVentaConfirmada(db, eventoVenta('t1', `v${String(n)}`, { numeroRecibo: `A-00000${String(n)}` }), AHORA);
    for (const n of orden) expect(recibo(db, 't1', `v${String(n)}`).numero).toBe(`A-00000${String(n)}`);
  });

  it('20 ventas concurrentes emiten 20 recibos con los números del evento, sin tocar contadores', async () => {
    const db = new DobleDb();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => manejarVentaConfirmada(db, eventoVenta('t1', `v${String(i)}`, { numeroRecibo: `A-${String(i + 1).padStart(6, '0')}` }), AHORA)),
    );
    const numeros = db.coleccion('tenants/t1/recibos').map((r) => (r as unknown as Recibo).numero).sort();
    expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => `A-${String(i + 1).padStart(6, '0')}`).sort());
    expect([...db.docs.keys()].some((r) => r.includes('contadores'))).toBe(false);
  });

  it('el mismo evento concurrente emite un solo recibo', async () => {
    const db = new DobleDb();
    const ev = eventoVenta('t1', 'v1');
    const r = await Promise.all([manejarVentaConfirmada(db, ev, AHORA), manejarVentaConfirmada(db, ev, AHORA)]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(1);
  });

  it('un evento inválido no emite nada', () => {
    const db = new DobleDb();
    const mal = { ...eventoVenta('t1', 'v2'), datos: { basura: true } };
    expect(() => manejarVentaConfirmada(db, mal as SobreEvento)).toThrow();
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(0);
  });

  it('un evento sin número de recibo se rechaza (el contrato lo exige)', () => {
    const mal = eventoVenta('t1', 'v2', { numeroRecibo: undefined });
    expect(() => manejarVentaConfirmada(new DobleDb(), mal)).toThrow(/numeroRecibo/);
  });

  it('la plantilla del tenant ya no define serie: se rechaza y la copia en el comprobante no la lleva', async () => {
    const db = new DobleDb();
    const base = { negocio: { nombre: 'Tienda X' }, pie: 'Gracias', politicaGarantia: '12 meses', politicaCambios: '7 días' };
    await expect(guardarPlantilla(db, { tenantId: 't1', actor: { uid: 'u-adm', rol: 'adm' }, plantilla: { serie: 'T1', ...base } })).rejects.toThrow(/serie/);
    await guardarPlantilla(db, { tenantId: 't1', actor: { uid: 'u-adm', rol: 'adm' }, plantilla: base });
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const r = recibo(db, 't1', 'v1');
    expect(r.plantilla).toMatchObject({ negocio: { nombre: 'Tienda X' }, pie: 'Gracias' });
    expect(r.plantilla).not.toHaveProperty('serie');
  });

  it('una plantilla guardada antes con serie sigue vigente sin ella', async () => {
    const db = new DobleDb();
    db.poner(rutaPlantilla('t1'), { serie: 'T1', negocio: { nombre: 'Vieja' } });
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    expect(recibo(db, 't1', 'v1').plantilla).toEqual({ negocio: { nombre: 'Vieja' } });
  });

  it('rechaza un evento de otro tipo', () => {
    expect(() => manejarVentaConfirmada(new DobleDb(), eventoAnulada('t1', 'v1'))).toThrow(/venta.confirmada/);
  });

  it('audita la emisión sin datos personales', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const aud = db.coleccion('tenants/t1/auditoria');
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ accion: 'recibos.emitir' });
    expect(JSON.stringify(aud)).not.toContain('Ana');
  });
});

describe('aislamiento entre tenants', () => {
  it('cada tenant tiene sus propios documentos y conserva el número de su venta', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1', { numeroRecibo: 'A-000001' }), AHORA);
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v2', { numeroRecibo: 'A-000002' }), AHORA);
    await manejarVentaConfirmada(db, eventoVenta('t2', 'v1', { numeroRecibo: 'A-000001' }), AHORA);
    expect(recibo(db, 't2', 'v1').numero).toBe('A-000001');
    expect(recibo(db, 't1', 'v2').numero).toBe('A-000002');
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(2);
    expect(db.coleccion('tenants/t2/recibos')).toHaveLength(1);
  });

  it('la plantilla de un tenant no afecta a otro', async () => {
    const db = new DobleDb();
    await guardarPlantilla(db, { tenantId: 't1', actor: { uid: 'u', rol: 'adm' }, plantilla: { negocio: { nombre: 'Uno' } } });
    await manejarVentaConfirmada(db, eventoVenta('t2', 'v1'), AHORA);
    expect(recibo(db, 't2', 'v1').plantilla.negocio.nombre).toBe('');
  });

  it('la anulación de un tenant no toca el comprobante del mismo ventaId en otro', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    await manejarVentaConfirmada(db, eventoVenta('t2', 'v1'), AHORA);
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    expect(recibo(db, 't1', 'v1').estado).toBe('ANULADO');
    expect(recibo(db, 't2', 'v1').estado).toBe('EMITIDO');
  });

  it('el archivo descarta documentos de otro tenant que devuelva la lectura', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t2', 'v1'), AHORA);
    const fuga = { consultar: () => Promise.resolve([recibo(db, 't2', 'v1')]) };
    expect(await buscarComprobantes(fuga, 't1', {})).toEqual([]);
  });

  it('rechaza tenantId con caracteres de ruta', () => {
    expect(() => rutaRecibo('t1/../t2', 'recibo-v1')).toThrow();
  });
});

describe('anulación', () => {
  it('marca ANULADO sin borrar ni renumerar', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const antes = recibo(db, 't1', 'v1');
    expect(await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA)).toBe(true);
    const r = recibo(db, 't1', 'v1');
    expect(r).toMatchObject({ estado: 'ANULADO', numero: antes.numero, total: antes.total, anulacion: { motivo: 'Error de digitación', aprobadoPor: 'u-sup' } });
    expect(db.coleccion('tenants/t1/auditoria').map((a) => a['accion'])).toContain('recibos.anular');
  });

  it('es idempotente', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    expect(await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA)).toBe(false);
  });

  it('anulación antes de la venta: no falla, queda pendiente y el recibo se emite ANULADO con el número del POS', async () => {
    const db = new DobleDb();
    expect(await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA)).toBe(true);
    expect(db.dato(rutaRecibo('t1', 'recibo-v1'))).toBeUndefined();
    expect(db.dato(rutaAnulacionPendiente('t1', 'v1'))).toMatchObject({ ventaId: 'v1', motivo: 'Error de digitación', aprobadoPor: 'u-sup' });
    expect(await manejarVentaConfirmada(db, eventoVenta('t1', 'v1', { numeroRecibo: 'A-000007' }), AHORA)).toBe(true);
    const r = recibo(db, 't1', 'v1');
    expect(r).toMatchObject({ estado: 'ANULADO', numero: 'A-000007', total: 125000, anulacion: { motivo: 'Error de digitación', anuladaPor: 'u-caj', aprobadoPor: 'u-sup' } });
    const ev = db.dato('tenants/t1/eventos/recibo-emitido-v1');
    expect(validarEvento(ev).ok).toBe(true);
    // Una anulación repetida después ya no hace nada.
    expect(await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA)).toBe(false);
    expect(recibo(db, 't1', 'v1').estado).toBe('ANULADO');
  });

  it('anulación duplicada antes de la venta (mismo id o id distinto): una sola pendiente y un solo recibo', async () => {
    const db = new DobleDb();
    const a = eventoAnulada('t1', 'v1');
    expect(await manejarVentaAnulada(db, a, AHORA)).toBe(true);
    expect(await manejarVentaAnulada(db, a, AHORA)).toBe(false);
    const otra = { ...a, id: 'an-otro', claveIdempotencia: 'anul-otro' };
    expect(await manejarVentaAnulada(db, otra, AHORA)).toBe(true);
    expect(db.coleccion('tenants/t1/anulaciones_pendientes_recibo')).toHaveLength(1);
    const v = eventoVenta('t1', 'v1');
    await manejarVentaConfirmada(db, v, AHORA);
    expect(await manejarVentaConfirmada(db, v, AHORA)).toBe(false);
    expect(db.coleccion('tenants/t1/recibos')).toHaveLength(1);
    expect(recibo(db, 't1', 'v1').estado).toBe('ANULADO');
  });

  it('orden normal (venta y luego anulación) sigue marcando ANULADO y no deja pendientes', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    expect(recibo(db, 't1', 'v1').estado).toBe('ANULADO');
    expect(db.coleccion('tenants/t1/anulaciones_pendientes_recibo')).toHaveLength(0);
  });

  it('la anulación pendiente de un tenant no afecta la venta del mismo ventaId en otro', async () => {
    const db = new DobleDb();
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    await manejarVentaConfirmada(db, eventoVenta('t2', 'v1'), AHORA);
    expect(recibo(db, 't2', 'v1').estado).toBe('EMITIDO');
  });

  it('el manifiesto declara la colección de anulaciones pendientes solo para el servidor', () => {
    expect(manifiestoRecibos.colecciones).toContainEqual({ ruta: 'anulaciones_pendientes_recibo', lectura: [], escritura: 'servidor' });
    // Lectura solo por callables: ninguna colección de recibos se abre al navegador.
    for (const c of manifiestoRecibos.colecciones) expect(c.lectura, c.ruta).toEqual([]);
    expect(manifiestoRecibos.colecciones.some((c) => c.ruta === 'contadores_recibo')).toBe(false);
  });

  it('la vista del anulado muestra ANULADO', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    expect(renderizarReciboHtml(recibo(db, 't1', 'v1'))).toContain('ANULADO');
  });
});

describe('vista y PDF', () => {
  const MALO = '<script>alert(1)</script>"\'&`';

  it('escapa los cinco caracteres peligrosos', () => {
    expect(escaparHtml(MALO)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;&#96;');
  });

  it('todo texto variable sale escapado en el HTML', async () => {
    const db = new DobleDb();
    await guardarPlantilla(db, {
      tenantId: 't1', actor: { uid: 'u', rol: 'adm' },
      plantilla: { negocio: { nombre: MALO, direccion: MALO }, pie: MALO, politicaGarantia: MALO, politicaCambios: MALO, logoUrl: 'https://x.test/l.png' },
    });
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1', { cliente: { nombre: MALO }, lineas: [{ productoId: 'p1', nombre: 'Prod <b>x</b>', cantidad: 1, precioUnitario: 125000, almacenId: 'tienda', series: [] }] }), AHORA);
    const html = renderizarReciboHtml(recibo(db, 't1', 'v1'));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Prod &lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('<img src="https://x.test/l.png"');
  });

  it('el HTML y el PDF muestran el nombre del producto', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const r = recibo(db, 't1', 'v1');
    expect(renderizarReciboHtml(r)).toContain('Lavarropas 8 kg');
    expect(new TextDecoder('latin1').decode(generarPdfRecibo(r))).toContain('Lavarropas 8 kg');
  });

  it('no incluye datos de pago sensibles ni el teléfono del cliente', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const r = recibo(db, 't1', 'v1');
    for (const salida of [renderizarReciboHtml(r), new TextDecoder('latin1').decode(generarPdfRecibo(r))]) {
      expect(salida).not.toContain('REF-SECRETA');
      expect(salida).not.toContain('70000000');
    }
  });

  it('rechaza logo que no sea https y el PDF escapa paréntesis y barras', async () => {
    expect(() => validarPlantilla({ negocio: { nombre: 'x' }, logoUrl: 'javascript:alert(1)' })).toThrow();
    const db = new DobleDb();
    await guardarPlantilla(db, { tenantId: 't1', actor: { uid: 'u', rol: 'sup' }, plantilla: { negocio: { nombre: 'A) Tj (EVIL \\ ñ' } } });
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const pdf = new TextDecoder('latin1').decode(generarPdfRecibo(recibo(db, 't1', 'v1')));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('(A\\) Tj \\(EVIL \\\\ \\361) Tj');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('un caj no edita la plantilla', async () => {
    await expect(guardarPlantilla(new DobleDb(), { tenantId: 't1', actor: { uid: 'u', rol: 'caj' }, plantilla: { negocio: { nombre: 'x' } } })).rejects.toBeInstanceOf(AccionNoPermitida);
  });

  it('guardar la plantilla audita solo los campos cambiados', async () => {
    const db = new DobleDb();
    await guardarPlantilla(db, { tenantId: 't1', actor: { uid: 'u', rol: 'adm' }, plantilla: { negocio: { nombre: 'Secreto' }, pie: 'Hola' } });
    const aud = db.coleccion('tenants/t1/auditoria');
    expect(aud[0]).toMatchObject({ accion: 'recibos.plantilla.guardar', resumenDespues: { camposCambiados: ['negocio', 'pie'] } });
    expect(JSON.stringify(aud)).not.toContain('Secreto');
    expect(db.dato(rutaPlantilla('t1'))).toBeDefined();
  });
});

describe('archivo de comprobantes', () => {
  async function poblar(): Promise<{ db: DobleDb; lectura: { consultar: () => Promise<Recibo[]> } }> {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, { ...eventoVenta('t1', 'v1', { cliente: { nombre: 'Ana Pérez' } }), ocurridoEn: '2026-11-01T15:00:00Z' });
    await manejarVentaConfirmada(db, { ...eventoVenta('t1', 'v2', { cliente: { nombre: 'Luis Gómez' } }), ocurridoEn: '2026-11-03T15:00:00Z' });
    await manejarVentaConfirmada(db, { ...eventoVenta('t1', 'v3', { cliente: undefined }), ocurridoEn: '2026-11-04T15:00:00Z' });
    const todos = db.coleccion('tenants/t1/recibos') as unknown as Recibo[];
    return { db, lectura: { consultar: () => Promise.resolve(todos) } };
  }

  it('busca por número, fecha y cliente (sin tildes ni mayúsculas) y ordena del más reciente', async () => {
    const { lectura } = await poblar();
    expect((await buscarComprobantes(lectura, 't1', {})).map((r) => r.numero)).toEqual(['A-000003', 'A-000002', 'A-000001']);
    expect((await buscarComprobantes(lectura, 't1', { numero: 'a-000002' })).map((r) => r.ventaId)).toEqual(['v2']);
    expect((await buscarComprobantes(lectura, 't1', { desde: '2026-11-02', hasta: '2026-11-03' })).map((r) => r.ventaId)).toEqual(['v2']);
    expect((await buscarComprobantes(lectura, 't1', { cliente: 'PEREZ' })).map((r) => r.ventaId)).toEqual(['v1']);
  });

  it('valida fechas y límite, y respeta el límite', async () => {
    const { lectura } = await poblar();
    await expect(buscarComprobantes(lectura, 't1', { desde: '03/11/2026' })).rejects.toThrow();
    await expect(buscarComprobantes(lectura, 't1', { limite: 0 })).rejects.toThrow();
    expect(await buscarComprobantes(lectura, 't1', { limite: 2 })).toHaveLength(2);
  });
});

describe('envío por WhatsApp', () => {
  const actor = { uid: 'u-caj', rol: 'caj' } as const;
  const enlacePdf = 'https://archivos.test/r/v1.pdf';

  it('wa.me: genera el enlace con texto y PDF y deja el estado enlace_generado (no «enviado»)', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const res = await enviarRecibo(db, new EnviadorWaMe('591'), { tenantId: 't1', reciboId: 'recibo-v1', actor, enlacePdf, ...AHORA });
    expect(res).toMatchObject({ estado: 'enlace_generado' });
    const enlace = (res as { enlace: string }).enlace;
    expect(enlace.startsWith('https://wa.me/59170000000?text=')).toBe(true);
    expect(decodeURIComponent(enlace)).toContain(enlacePdf);
    expect(recibo(db, 't1', 'v1').envioWhatsapp).toMatchObject({ estado: 'enlace_generado' });
    expect(JSON.stringify(recibo(db, 't1', 'v1'))).not.toContain('wa.me');
    expect(db.coleccion('tenants/t1/auditoria').map((a) => a['accion'])).toContain('recibos.enviar');
  });

  it('sin teléfono: estado sin_telefono y no se llama al enviador', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1', { cliente: undefined }), AHORA);
    const sim = new EnviadorSimulado();
    expect(await enviarRecibo(db, sim, { tenantId: 't1', reciboId: 'recibo-v1', actor, enlacePdf })).toEqual({ estado: 'sin_telefono' });
    expect(sim.solicitudes).toHaveLength(0);
    expect(recibo(db, 't1', 'v1').envioWhatsapp.estado).toBe('sin_telefono');
  });

  it('el enviador simulado registra la solicitud; si el puerto lanza, queda fallido', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const sim = new EnviadorSimulado();
    await enviarRecibo(db, sim, { tenantId: 't1', reciboId: 'recibo-v1', actor, enlacePdf });
    expect(sim.solicitudes[0]).toMatchObject({ numero: 'A-000001', telefono: '70000000' });
    expect(recibo(db, 't1', 'v1').envioWhatsapp.estado).toBe('enviado');
    const roto = { enviar: () => Promise.reject(new Error('caído')) };
    await enviarRecibo(db, roto, { tenantId: 't1', reciboId: 'recibo-v1', actor, enlacePdf });
    expect(recibo(db, 't1', 'v1').envioWhatsapp.estado).toBe('fallido');
  });

  it('wa.me rechaza enlaces no https y teléfonos absurdos; no envía anulados ni de otro tenant', async () => {
    const e = new EnviadorWaMe();
    const base = { tenantId: 't1', reciboId: 'r', numero: 'A-1', nombreNegocio: '', total: '1.00 BOB', telefono: '70000000', enlacePdf };
    expect((await e.enviar({ ...base, enlacePdf: 'http://x.test/a.pdf' })).estado).toBe('fallido');
    expect((await e.enviar({ ...base, telefono: '12' })).estado).toBe('fallido');
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    await expect(enviarRecibo(db, e, { tenantId: 't2', reciboId: 'recibo-v1', actor, enlacePdf })).rejects.toBeInstanceOf(ReciboNoEncontrado);
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    await expect(enviarRecibo(db, e, { tenantId: 't1', reciboId: 'recibo-v1', actor, enlacePdf })).rejects.toBeInstanceOf(AccionNoPermitida);
  });
});

describe('factura SUMA referencial', () => {
  it('la referencia solo sup/adm, se valida, se audita y no aplica a anulados', async () => {
    const db = new DobleDb();
    await manejarVentaConfirmada(db, eventoVenta('t1', 'v1'), AHORA);
    const p = { tenantId: 't1', reciboId: 'recibo-v1', facturaSuma: 'F-2026-0045' };
    await expect(referenciarFacturaSuma(db, { ...p, actor: { uid: 'u', rol: 'caj' } })).rejects.toBeInstanceOf(AccionNoPermitida);
    await expect(referenciarFacturaSuma(db, { ...p, facturaSuma: '<b>', actor: { uid: 'u', rol: 'adm' } })).rejects.toThrow();
    await referenciarFacturaSuma(db, { ...p, actor: { uid: 'u', rol: 'adm' } });
    expect(recibo(db, 't1', 'v1').facturaSuma).toBe('F-2026-0045');
    expect(db.coleccion('tenants/t1/auditoria').map((a) => a['accion'])).toContain('recibos.factura-suma');
    await manejarVentaAnulada(db, eventoAnulada('t1', 'v1'), AHORA);
    await expect(referenciarFacturaSuma(db, { ...p, actor: { uid: 'u', rol: 'adm' } })).rejects.toBeInstanceOf(AccionNoPermitida);
  });
});

describe('manifiesto', () => {
  it('declara colecciones de un segmento, escritas solo por el servidor', () => {
    expect(manifiestoRecibos.colecciones.length).toBeGreaterThan(0);
    for (const c of manifiestoRecibos.colecciones) {
      expect(c.ruta).not.toContain('/');
      expect(c.escritura).toBe('servidor');
    }
    expect(manifiestoRecibos.emite).toEqual(['recibo.emitido']);
  });
});

describe('almacenamiento de recibos', () => {
  it('declara solo la ruta privada de PDF, de servidor', () => {
    expect(manifiestoRecibos.almacenamiento).toEqual([{ ruta: 'privado/recibos/{ruta=**}', lectura: 'servidor', escritura: 'servidor' }]);
  });
});
