import { describe, expect, it } from 'vitest';
import { aBase64, formatoBytes } from './base64.js';
import { aCsv, celdaCsv } from './csv.js';
import { diferenciaPorMoneda, efectivoEsperado, proyectarTurno, sumarTotales, TOTALES_VACIOS } from '../pantallas/pos/arqueo.js';
import { centavosATexto, formatearMonto, textoACentavos } from './dinero.js';
import { ITEMS_MENU, menuPara, parsearRuta, puedeVer, rutaPorOmision } from './menu.js';
import { calcularPagos, type FilaPago } from '../pantallas/pos/pagos.js';
import { precioDeVenta, REDONDEO } from './precio.js';
import { leerClaimPanel } from '../sesion/claim.js';
import { PALETAS } from '../pantallas/consola/plantillas-vista.js';
import { PLANTILLAS_SITIO } from '../api/tipos.js';
import type { CotizacionVista } from '../api/tipos.js';

const cot = (par: CotizacionVista['par'], valor: number): CotizacionVista => ({ cotizacionId: 'c', par, valor, fecha: '2026-11-04', fuente: 'BCB', estado: 'vigente' });

describe('dinero', () => {
  it('formatea centavos con miles y coma decimal', () => {
    expect(formatearMonto(123450, 'BOB')).toBe('Bs 1.234,50');
    expect(formatearMonto(5, 'USD')).toBe('USD 0,05');
    expect(formatearMonto(-1000, 'ARS')).toBe('-ARS 10,00');
    expect(formatearMonto(100000000, 'ARS')).toBe('ARS 1.000.000,00');
  });
  it('lee montos escritos por la persona', () => {
    expect(textoACentavos('12')).toBe(1200);
    expect(textoACentavos('12,5')).toBe(1250);
    expect(textoACentavos('12.50')).toBe(1250);
    expect(textoACentavos('1.234,50')).toBe(123450);
    expect(textoACentavos(' 0 ')).toBe(0);
    expect(textoACentavos('12.345')).toBe(1234500); // el punto de tres cifras es separador de miles (convención es-BO)
  });
  it('rechaza lo que no es un monto', () => {
    for (const malo of ['', 'abc', '-5', '1,234', '12.3456', '1e3', '9'.repeat(30)]) expect(textoACentavos(malo)).toBeNull();
  });
  it('ida y vuelta de centavos a texto', () => {
    expect(centavosATexto(1250)).toBe('12,50');
    expect(centavosATexto(-5)).toBe('-0,05');
    expect(textoACentavos(centavosATexto(99999))).toBe(99999);
  });
});

describe('precio de venta', () => {
  it('BOB a dos decimales con la función del núcleo', () => {
    // 450 USD × 6,96 = 3132,00
    expect(precioDeVenta(45000, 'BO', 'BOB', cot('BOB/USD', 6.96))).toEqual({ tipo: 'precio', centavos: 313200, moneda: 'BOB' });
    // 12,34 USD × 6,96 = 85,8864 → 85,89
    expect(precioDeVenta(1234, 'BO', 'BOB', cot('BOB/USD', 6.96))).toEqual({ tipo: 'precio', centavos: 8589, moneda: 'BOB' });
  });
  it('ARS al múltiplo de 100 más cercano', () => {
    // 10,49 USD × 1033,3 = 10838,92 → 10800
    expect(precioDeVenta(1049, 'AR', 'ARS', cot('ARS/USD', 1033.3))).toEqual({ tipo: 'precio', centavos: 1080000, moneda: 'ARS' });
    // 10,51 USD × 1033,3 = 10859,98 → 10900
    expect(precioDeVenta(1051, 'AR', 'ARS', cot('ARS/USD', 1033.3))).toEqual({ tipo: 'precio', centavos: 1090000, moneda: 'ARS' });
    expect(REDONDEO.ARS).toEqual({ tipo: 'multiplo', multiplo: 100, modo: 'cercano' });
  });
  it('USD no usa cotización; precio 0 es a consultar; sin cotización avisa', () => {
    expect(precioDeVenta(800, 'BO', 'USD', null)).toEqual({ tipo: 'precio', centavos: 800, moneda: 'USD' });
    expect(precioDeVenta(0, 'BO', 'BOB', cot('BOB/USD', 7))).toEqual({ tipo: 'sin_precio' });
    expect(precioDeVenta(800, 'BO', 'BOB', null)).toEqual({ tipo: 'sin_cotizacion' });
    expect(precioDeVenta(800, 'BO', 'BOB', cot('ARS/USD', 7))).toEqual({ tipo: 'sin_cotizacion' });
  });
});

describe('arqueo', () => {
  const t = { apertura: { BOB: 10000 }, totales: { BOB: { ...TOTALES_VACIOS, efectivo: 5000, qr: 9000, transferencia: 1000, credito: 300, ingresos: 200, egresos: 700 } } } as const;
  it('el efectivo esperado ignora QR, transferencia y crédito', () => {
    expect(efectivoEsperado(10000, t.totales.BOB)).toBe(14500);
    expect(proyectarTurno(t).BOB?.efectivoEsperado).toBe(14500);
    expect(proyectarTurno(t).BOB?.qr).toBe(9000);
  });
  it('la diferencia puede ser negativa', () => {
    expect(diferenciaPorMoneda(t, { BOB: 14000 })).toEqual({ BOB: -500 });
    expect(diferenciaPorMoneda(t, { BOB: 15000 })).toEqual({ BOB: 500 });
    expect(diferenciaPorMoneda(t, {})).toEqual({});
  });
  it('suma totales sin mutar', () => {
    const a = sumarTotales({}, 'USD', { efectivo: 100 });
    const b = sumarTotales(a, 'USD', { efectivo: 50, egresos: 10 });
    expect(a.USD?.efectivo).toBe(100);
    expect(b.USD).toEqual({ ...TOTALES_VACIOS, efectivo: 150, egresos: 10 });
  });
});

describe('pagos', () => {
  const fila = (p: Partial<FilaPago>): FilaPago => ({ id: 'x', medio: 'efectivo', monto: '', recibido: '', referencia: '', ...p });
  it('efectivo con cambio: el monto enviado es lo recibido y el cambio se informa', () => {
    const r = calcularPagos([fila({ monto: '50', recibido: '100' })], 5000, 'BOB');
    expect(r.pagos).toEqual([{ medio: 'efectivo', moneda: 'BOB', monto: 10000, cambio: 5000 }]);
    expect(r.restante).toBe(0);
    expect(r.cambioTotal).toBe(5000);
    expect(r.errores).toEqual([]);
  });
  it('pago mixto en una moneda; calcula el restante', () => {
    const r = calcularPagos([fila({ monto: '30' }), fila({ medio: 'qr', monto: '20', referencia: 'R1' })], 8000, 'BOB');
    expect(r.restante).toBe(3000);
    expect(r.pagos[1]).toEqual({ medio: 'qr', moneda: 'BOB', monto: 2000, referencia: 'R1' });
  });
  it('errores de captura: monto vacío, QR sin referencia, recibido menor', () => {
    expect(calcularPagos([fila({})], 100, 'BOB').errores).toHaveLength(1);
    expect(calcularPagos([fila({ medio: 'qr', monto: '1' })], 100, 'BOB').errores[0]).toContain('referencia');
    expect(calcularPagos([fila({ monto: '10', recibido: '5' })], 1000, 'BOB').errores[0]).toContain('menor');
    expect(calcularPagos([fila({ medio: 'transferencia', monto: '1', referencia: 'T' })], 100, 'USD').pagos[0]?.referencia).toBe('T');
  });
});

describe('csv', () => {
  it('neutraliza fórmulas y entrecomilla', () => {
    expect(celdaCsv('=1+1')).toBe("'=1+1");
    expect(celdaCsv('+54')).toBe("'+54");
    expect(celdaCsv('-x')).toBe("'-x");
    expect(celdaCsv('@a')).toBe("'@a");
    expect(celdaCsv('\tx')).toBe("'\tx");
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(true)).toBe('true');
    expect(celdaCsv(null)).toBe('');
    expect(aCsv(['a', 'b'], [['=x', 1]])).toBe("a,b\r\n'=x,1\r\n");
  });
});

const TODOS = ['inventarios', 'pos', 'recibos', 'consola', 'website'] as const;

describe('menú por rol', () => {
  it('vendedor: Venta y Mis recibos', () => {
    expect(menuPara('caj', TODOS).map((i) => i.titulo)).toEqual(['Venta', 'Mis recibos']);
  });
  it('supervisor agrega inventario, mermas, aprobaciones y supervisión', () => {
    expect(menuPara('sup', TODOS).map((i) => i.id)).toEqual(['venta', 'recibos', 'inventario', 'mermas', 'aprobaciones', 'supervision', 'catalogo']);
  });
  it('administrador ve todo', () => {
    expect(menuPara('adm', TODOS)).toHaveLength(ITEMS_MENU.length);
    expect(menuPara('adm', TODOS).map((i) => i.id)).toContain('usuarios');
    expect(puedeVer('caj', 'inventario', TODOS)).toBe(false);
    expect(puedeVer('sup', 'usuarios', TODOS)).toBe(false);
    expect(puedeVer('adm', 'configuracion', TODOS)).toBe(true);
  });
  it('un módulo apagado quita sus pantallas del menú y de puedeVer; Central no depende de módulos', () => {
    const sinPos = TODOS.filter((m) => m !== 'pos');
    expect(menuPara('adm', sinPos).map((i) => i.id)).toEqual(['recibos', 'inventario', 'mermas', 'catalogo', 'usuarios', 'configuracion']);
    expect(puedeVer('adm', 'venta', sinPos)).toBe(false);
    expect(menuPara('adm', []).map((i) => i.id)).toEqual(['usuarios', 'configuracion']);
  });
  it('falla cerrado: sin módulos conocidos solo se ven las pantallas de Central', () => {
    expect(menuPara('adm', null).map((i) => i.id)).toEqual(['usuarios', 'configuracion']);
    expect(menuPara('caj', null)).toEqual([]);
    expect(puedeVer('adm', 'venta', null)).toBe(false);
    expect(puedeVer('adm', 'usuarios', null)).toBe(true);
  });
  it('la ruta por omisión es la primera pantalla visible', () => {
    expect(rutaPorOmision('caj', TODOS)).toBe('#/venta/terminal');
    expect(rutaPorOmision('caj', ['recibos'])).toBe('#/recibos');
    expect(rutaPorOmision('adm', ['inventarios'])).toBe('#/inventario');
    expect(rutaPorOmision('adm', null)).toBe('#/usuarios');
    expect(rutaPorOmision('caj', null)).toBeNull();
  });
  it('rutas', () => {
    expect(parsearRuta('#/venta/cobro')).toEqual({ seccion: 'venta', sub: 'cobro' });
    expect(parsearRuta('')).toEqual({ seccion: '', sub: '' });
    expect(parsearRuta('#/recibos')).toEqual({ seccion: 'recibos', sub: '' });
  });
});

describe('claim y utilidades', () => {
  it('lee tenant y rol del claim pl', () => {
    expect(leerClaimPanel({ pl: { t: { demo: 'sup' }, v: 1 } })).toEqual({ tenantId: 'demo', rol: 'sup' });
    expect(leerClaimPanel({ pl: { t: { b: 'caj', a: 'adm' }, v: 1 } })).toEqual({ tenantId: 'a', rol: 'adm' });
  });
  it('sin acceso si falta, es inválido o el rol no existe', () => {
    for (const malo of [null, {}, { pl: null }, { pl: { t: [] } }, { pl: { t: { demo: 'dir' } } }, { pl: { t: {} } }, { pl: { t: { '': 'adm' } } }, 'x']) {
      expect(leerClaimPanel(malo)).toBeNull();
    }
  });
  it('base64 y tamaños', () => {
    expect(aBase64(new TextEncoder().encode('hola'))).toBe('aG9sYQ==');
    expect(aBase64(new Uint8Array(70000)).length).toBeGreaterThan(90000);
    expect(formatoBytes(500)).toBe('500 B');
    expect(formatoBytes(2048)).toBe('2 KB');
    expect(formatoBytes(5 * 1024 ** 2)).toBe('5,0 MB');
    expect(formatoBytes(2 * 1024 ** 3)).toBe('2,0 GB');
  });
  it('las cinco plantillas tienen paleta', () => {
    expect(Object.keys(PALETAS).sort()).toEqual([...PLANTILLAS_SITIO].sort());
  });
});

describe('rango de exportación', () => {
  it('último mes en La Paz, con fin de mes y límite de 366 días', async () => {
    const { rangoUltimoMes, restarMeses, validarRango, diasDelRango } = await import('./rango.js');
    expect(rangoUltimoMes(Date.UTC(2026, 10, 4, 15, 0, 0))).toEqual({ desde: '2026-10-04', hasta: '2026-11-04' });
    // 02:00 UTC del 1 de marzo todavía es el 28 de febrero en La Paz.
    expect(rangoUltimoMes(Date.UTC(2026, 2, 1, 2, 0, 0))).toEqual({ desde: '2026-01-28', hasta: '2026-02-28' });
    expect(restarMeses('2026-03-31', 1)).toBe('2026-02-28');
    expect(restarMeses('2026-01-15', 1)).toBe('2025-12-15');
    expect(diasDelRango('2025-11-04', '2026-11-04')).toBe(366);
    expect(validarRango('2025-11-04', '2026-11-04')).toBeNull();
    expect(validarRango('2025-11-03', '2026-11-04')).toMatch(/366/);
    expect(validarRango('2026-11-05', '2026-11-04')).toMatch(/posterior/);
    expect(validarRango('', '2026-11-04')).toMatch(/fechas/);
  });
});
