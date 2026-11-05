import { manifiestoNucleo, crearRegistro, type ManifiestoModulo } from '@novutienda/nucleo';
import { aCsv, celdaCsv, csvMovimientosCaja, csvVentas, etiquetaPago, formatoMonto, manifiestoPos, MAX_FILAS_CSV, recortarExportacion, type VentaPos } from '@novutienda/pos';
import { describe, expect, it } from 'vitest';

describe('CSV', () => {
  it.each(['=1+1', '+SUMA(A1)', '-2+3', '@cmd', '\tx', '\rx'])('neutraliza %j', (t) => {
    expect(celdaCsv(t).replace(/^"/, '').startsWith("'")).toBe(true);
  });
  it('no toca texto normal y entrecomilla separadores', () => {
    expect(celdaCsv('hola')).toBe('hola');
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv('=A,B')).toBe('"\'=A,B"');
    expect(celdaCsv(null)).toBe('');
    expect(celdaCsv(true)).toBe('true');
    expect(celdaCsv(5)).toBe('5');
  });
  it('los importes del sistema no se neutralizan y llevan dos decimales', () => {
    expect(celdaCsv({ centavos: -500 })).toBe('-5.00');
    expect(formatoMonto(12345)).toBe('123.45');
    expect(formatoMonto(5)).toBe('0.05');
  });
  it('las ventas y movimientos exportados neutralizan lo que escribe una persona', () => {
    const v = {
      ventaId: 'v', turnoId: 't', cajeroUid: 'u', estado: 'confirmada', moneda: 'BOB', subtotal: 1000, descuento: { monto: 100, motivo: '=HYPERLINK("x")' },
      total: 900, pagos: [{ medio: 'qr', moneda: 'BOB', monto: 900, referencia: '@x', registradoPor: 'u' }], cliente: { nombre: '-Ana' }, serie: 'A', receiptNo: 1, creadoEnMs: 0,
    } as unknown as VentaPos;
    const csv = csvVentas([v]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'-Ana");
    expect(csv).toContain('QR registrado por u 9.00 ref @x');
    expect(csv.split('\r\n')).toHaveLength(3);
    const m = csvMovimientosCaja([{ requestId: 'r', tipo: 'egreso', moneda: 'BOB', monto: 100, motivo: '+cmd', turnoId: 't', registradoPor: 'u', creadoEnMs: 0 }]);
    expect(m).toContain("'+cmd");
    expect(aCsv(['a'], [['=1']])).toBe("a\r\n'=1\r\n");
  });
  it('el QR se muestra «registrado por», nunca «verificado»', () => {
    expect(etiquetaPago({ medio: 'qr', moneda: 'BOB', monto: 1, registradoPor: 'ana' })).toBe('QR registrado por ana');
    expect(etiquetaPago({ medio: 'qr', moneda: 'BOB', monto: 1 })).not.toMatch(/verific/i);
    expect(etiquetaPago({ medio: 'efectivo', moneda: 'BOB', monto: 1 })).toBe('efectivo');
  });
});

describe('exportación acotada', () => {
  it('avisa cuando hay más filas que el tope y recorta; no avisa si caben', () => {
    const filas = Array.from({ length: MAX_FILAS_CSV + 1 }, (_, i) => i);
    const r = recortarExportacion(filas);
    expect(r.truncado).toBe(true);
    expect(r.filas).toHaveLength(MAX_FILAS_CSV);
    expect(r.filas[MAX_FILAS_CSV - 1]).toBe(MAX_FILAS_CSV - 1);
    expect(recortarExportacion(filas.slice(0, MAX_FILAS_CSV))).toMatchObject({ truncado: false });
    expect(recortarExportacion([1, 2, 3], 3).truncado).toBe(false);
    expect(recortarExportacion([1, 2, 3, 4], 3)).toEqual({ filas: [1, 2, 3], truncado: true });
  });
});

describe('manifiesto', () => {
  it('declara colecciones de un segmento, escritura del servidor y no choca con el núcleo', () => {
    for (const c of manifiestoPos.colecciones) {
      expect(c.ruta.includes('/')).toBe(false);
      expect(c.escritura).toBe('servidor');
    }
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(manifiestoNucleo);
    r.registrar(manifiestoPos);
    expect(r.rutas().length).toBe(manifiestoNucleo.colecciones.length + manifiestoPos.colecciones.length);
    expect(manifiestoPos.emite).toEqual(['venta.confirmada', 'venta.anulada', 'turno.cerrado']);
  });
  it('el vendedor no lee ventas ni turnos directamente', () => {
    const lee = (ruta: string) => manifiestoPos.colecciones.find((c) => c.ruta === ruta)?.lectura ?? [];
    expect(lee('ventas')).not.toContain('caj');
    expect(lee('turnos')).not.toContain('caj');
    expect(lee('pos_config')).toContain('caj');
  });
});
