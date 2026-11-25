import { describe, expect, it } from 'vitest';
import { COMERCIAL_LEGADO_TRES_MONEDAS, redondeoPorMoneda, validarEvento, type SobreEvento } from '@novutienda/nucleo';
import { fijarRedondeoDe, rutaRedondeo, type TransaccionRedondeo } from '../../plataforma/funciones/servidor/redondeo.js';

const C = COMERCIAL_LEGADO_TRES_MONEDAS;
const BOB0 = { tipo: 'decimales', decimales: 0, modo: 'cercano' } as const;
const ARS1000 = { tipo: 'multiplo', multiplo: 1000, modo: 'cercano' } as const;
const BOB2 = { tipo: 'decimales', decimales: 2, modo: 'cercano' } as const;
const ARS100 = { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } as const;
const RUTA = rutaRedondeo('t1');

function crearTx(inicial?: Record<string, unknown>) {
  const docs = new Map<string, Record<string, unknown>>();
  if (inicial !== undefined) docs.set(RUTA, inicial);
  const escrituras: { op: string; ruta: string; datos: Record<string, unknown> }[] = [];
  const tx: TransaccionRedondeo = {
    get: async (ruta) => ({ existe: docs.has(ruta), data: () => docs.get(ruta) }),
    set: (ruta, datos) => void escrituras.push({ op: 'set', ruta, datos: { ...datos } }),
    create: (ruta, datos) => void escrituras.push({ op: 'create', ruta, datos: { ...datos } }),
    existe: async (ruta) => docs.has(ruta),
    nuevoId: () => 'id1',
    marcaTiempoServidor: () => 'MARCA',
  };
  return { tx, escrituras };
}
const base = { tenantId: 't1', comercial: C, uid: 'op1', ahora: () => Date.UTC(2026, 10, 25, 12) };
const vigentes = redondeoPorMoneda(C);

describe('fijarRedondeoDe', () => {
  it('escribe el documento, audita con el actor propietario y publica el evento con solo las monedas', async () => {
    const { tx, escrituras } = crearTx();
    const r = await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB2, ARS: ARS100 }, esperadas: vigentes, motivo: 'decisión del cliente' });
    expect(r).toMatchObject({ tipo: 'fijado', cambiadas: ['BOB', 'ARS'] });
    expect(escrituras.map((x) => x.op)).toEqual(['set', 'create', 'create']);
    expect(escrituras[0]).toMatchObject({ ruta: RUTA, datos: { BOB: BOB2, ARS: ARS100 } });
    expect(escrituras[1]?.ruta).toBe('tenants/t1/auditoria/id1');
    expect(escrituras[1]?.datos).toMatchObject({
      rol: 'propietario', uid: 'op1', accion: 'redondeo.fijar', ruta: RUTA, motivo: 'decisión del cliente',
      resumenAntes: vigentes, resumenDespues: { BOB: BOB2, ARS: ARS100 },
    });
    expect(escrituras[2]?.ruta).toBe('tenants/t1/eventos/id1');
    const sobre = escrituras[2]?.datos as unknown as SobreEvento;
    expect(sobre).toMatchObject({ tipo: 'redondeo.cambiado', version: 1, origen: 'nucleo', datos: { monedas: ['BOB', 'ARS'] } });
    expect(JSON.stringify(sobre.datos)).not.toContain('decimales');
    expect(validarEvento(sobre).ok).toBe(true);
  });

  it('el evento lleva solo la moneda que cambió', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0, ARS: ARS100 });
    const r = await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB0, ARS: ARS1000 }, esperadas: { BOB: BOB0, ARS: ARS100 } });
    expect(r).toMatchObject({ tipo: 'fijado', cambiadas: ['ARS'] });
    expect((escrituras[2]?.datos as unknown as SobreEvento).datos).toEqual({ monedas: ['ARS'] });
    expect(escrituras[1]?.datos).not.toHaveProperty('motivo');
  });

  it('sin cambios no escribe nada', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0, ARS: ARS1000 });
    expect(await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB0, ARS: ARS1000 }, esperadas: { BOB: BOB0, ARS: ARS1000 } })).toEqual({ tipo: 'sin-cambios' });
    expect(escrituras).toEqual([]);
  });

  it('sin documento, fijar la regla que ya rige no escribe nada', async () => {
    const { tx, escrituras } = crearTx();
    expect((await fijarRedondeoDe(tx, { ...base, reglas: vigentes, esperadas: vigentes })).tipo).toBe('sin-cambios');
    expect(escrituras).toEqual([]);
  });

  it('conflicto si lo esperado ya no es lo vigente: no escribe y devuelve lo vigente', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0, ARS: ARS100 });
    const r = await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB0, ARS: ARS1000 }, esperadas: vigentes });
    expect(r).toEqual({ tipo: 'conflicto', actuales: { BOB: BOB0, ARS: ARS100 } });
    expect(escrituras).toEqual([]);
  });

  it('conflicto si esperadas no trae exactamente las monedas', async () => {
    const { tx, escrituras } = crearTx();
    expect((await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB0, ARS: ARS1000 }, esperadas: { BOB: BOB2 } })).tipo).toBe('conflicto');
    expect(escrituras).toEqual([]);
  });

  it.each([
    ['moneda de menos', { BOB: BOB0 }],
    ['moneda de más', { BOB: BOB0, ARS: ARS1000, USD: BOB0 }],
    ['moneda que no es de venta', { BOB: BOB0, EUR: ARS1000 }],
    ['regla inválida', { BOB: { tipo: 'decimales', decimales: 3, modo: 'cercano' }, ARS: ARS1000 }],
    ['modo desconocido', { BOB: BOB0, ARS: { tipo: 'multiplo', multiplo: 5, modo: 'raro' } }],
    ['campo sobrante', { BOB: { ...BOB0, extra: 1 }, ARS: ARS1000 }],
    ['sin regla', { BOB: BOB0, ARS: undefined }],
  ])('rechaza: %s', async (_n, reglas) => {
    const { tx, escrituras } = crearTx();
    expect((await fijarRedondeoDe(tx, { ...base, reglas, esperadas: vigentes })).tipo).toBe('invalido');
    expect(escrituras).toEqual([]);
  });

  it('un documento vigente inválido se repara con esperadas null y se anota en la auditoría', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0 });
    const r = await fijarRedondeoDe(tx, { ...base, reglas: { BOB: BOB2, ARS: ARS100 }, esperadas: null });
    expect(r).toMatchObject({ tipo: 'fijado' });
    expect(escrituras[0]).toMatchObject({ op: 'set', ruta: RUTA, datos: { BOB: BOB2, ARS: ARS100 } });
    expect(escrituras[1]?.datos).toMatchObject({ resumenAntes: { invalido: true } });
  });

  it('un documento inválido se repara aunque la regla nueva sea la de por defecto', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0 });
    expect((await fijarRedondeoDe(tx, { ...base, reglas: vigentes, esperadas: null })).tipo).toBe('fijado');
    expect(escrituras[0]?.ruta).toBe(RUTA);
  });

  it('con documento válido, esperadas null es conflicto', async () => {
    const { tx, escrituras } = crearTx({ BOB: BOB0, ARS: ARS100 });
    expect((await fijarRedondeoDe(tx, { ...base, reglas: vigentes, esperadas: null })).tipo).toBe('conflicto');
    expect(escrituras).toEqual([]);
  });
});
