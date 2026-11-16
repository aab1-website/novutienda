import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import type { ProductoPanel } from '../../api/tipos.js';
import type { MercadoDeclarado } from '../../api/tipos.js';
import { mercadosDePrecio } from './nombres.js';
import { aEntrada, cambiosDeEdicion, errorDeServidor, avisoDeSku, errorDeSku, esProductoYaExiste, formInicial, leerBorrador, listaEnTexto, revisarProducto, type FormProducto } from './producto-revision.js';

const EXISTENTES = [{ id: 'cable-hdmi', sku: 'CABLE-HDMI' }];
const REF: readonly MercadoDeclarado[] = [
  { id: 'BO', nombre: 'Bolivia', monedaVenta: 'BOB', monedaBase: 'USD', tieneTipoCambio: true },
  { id: 'AR', nombre: 'Argentina', monedaVenta: 'ARS', monedaBase: 'USD', tieneTipoCambio: true },
];
const UNO: readonly MercadoDeclarado[] = [{ id: 'PE', nombre: 'Perú', monedaVenta: 'PEN', monedaBase: 'PEN', tieneTipoCambio: false }];
const M = mercadosDePrecio(REF);
const M1 = mercadosDePrecio(UNO);
const errSrv = (e: unknown): ReturnType<typeof errorDeServidor> => errorDeServidor(e, M);
const CTX = { nuevo: true, existentes: EXISTENTES, mercados: M, monedaCosto: 'USD' };
const valido = (): FormProducto => ({ ...formInicial(null, M), nombre: 'Teclado', categoria: 'Accesorios', sku: 'TEC-1', precios: { bo: '15', ar: '16' } });
const producto = (extra: Partial<ProductoPanel> = {}): ProductoPanel => ({
  id: 'cable-hdmi', nombre: 'Cable HDMI 2 m', categoria: 'Accesorios', marca: 'Cabletec', sku: 'CABLE-HDMI', activo: true, publicado: true, conSerie: false, garantiaMeses: 6, minimo: 10,
  precioUSD: { bo: 800, ar: 900 }, costoUSD: 300, stockTotal: 35, existencias: { tienda: 25, 'deposito-1': 10, 'deposito-2': 0 }, bajoMinimo: false, disponible: true, ...extra,
});

describe('revisión del producto', () => {
  it('un alta completa no tiene errores', () => {
    expect(revisarProducto(valido(), CTX)).toEqual({});
  });
  it('marca un error por campo, con el mensaje de cada uno', () => {
    const e = revisarProducto({ ...formInicial(null, M) }, CTX);
    expect(Object.keys(e).sort()).toEqual(['categoria', 'nombre', 'precio.ar', 'precio.bo', 'sku']);
    expect(e['precio.ar']).toMatch(/Falta el precio de Argentina/);
    expect(e['precio.bo']).toMatch(/Falta el precio de Bolivia/);
  });
  it('recorre los mercados del núcleo y no pide nada de más en una edición', () => {
    const e = revisarProducto({ ...formInicial(producto(), M), precios: { bo: '', ar: 'x' } }, { ...CTX, nuevo: false });
    expect(e['precio.bo']).toBeTruthy();
    expect(e['precio.ar']).toMatch(/monto en dólares/);
    expect(e['sku']).toBeUndefined();
  });
  it('rechaza un SKU repetido o con formato inválido; no hay campo de identificador', () => {
    expect(revisarProducto({ ...valido(), sku: 'x' }, CTX)).not.toHaveProperty('id');
    expect(revisarProducto({ ...valido(), sku: 'CABLE-HDMI' }, CTX)['sku']).toMatch(/ya lo usa/);
    expect(revisarProducto({ ...valido(), sku: 'a b' }, CTX)['sku']).toMatch(/letras, números/);
  });
  it('un SKU que solo difiere en mayúsculas no es error: es un aviso', () => {
    expect(revisarProducto({ ...valido(), sku: 'cable-hdmi' }, CTX)['sku']).toBeUndefined();
    expect(avisoDeSku('cable-hdmi', EXISTENTES)).toBe('Se parece al SKU de otro producto (difiere solo en mayúsculas)');
    expect(avisoDeSku('CABLE-HDMI', EXISTENTES)).toBeNull();
    expect(avisoDeSku('otro', EXISTENTES)).toBeNull();
  });
  it('el error de SKU repetido sale al salir del campo, sin esperar a Guardar, y no dice nada de un campo vacío', () => {
    expect(errorDeSku('CABLE-HDMI', EXISTENTES)).toMatch(/ya lo usa/);
    expect(errorDeSku('', EXISTENTES)).toBeNull();
    expect(errorDeSku('a b', EXISTENTES)).toMatch(/letras, números/);
  });
  it('un borrador viejo con id e idEditado se lee sin marcarse como modificado', () => {
    const inicial = formInicial(null, M);
    const viejo = { ...inicial, id: 'algo', idEditado: true } as unknown as FormProducto;
    expect(leerBorrador(viejo)).toEqual(inicial);
    expect(JSON.stringify(leerBorrador(viejo))).toBe(JSON.stringify(inicial));
    expect(leerBorrador(null)).toBeNull();
  });
  it('garantía, mínimo y costo son opcionales, pero si se escriben deben ser válidos', () => {
    expect(revisarProducto({ ...valido(), garantia: '', minimo: '', costo: '' }, CTX)).toEqual({});
    const e = revisarProducto({ ...valido(), garantia: '121', minimo: '1,5', costo: 'abc' }, CTX);
    expect(e['garantia']).toBeTruthy();
    expect(e['minimo']).toBeTruthy();
    expect(e['costo']).toBeTruthy();
  });
  it('cantidad y precio mal escritos no pasan', () => {
    expect(revisarProducto({ ...valido(), minimo: '-1' }, CTX)['minimo']).toBeTruthy();
    expect(revisarProducto({ ...valido(), precios: { bo: '15', ar: '99999999999' } }, CTX)['precio.ar']).toMatch(/demasiado alto/);
  });
});

describe('alta y edición hacia el servidor', () => {
  it('arma la entrada de alta en centavos, sin los opcionales vacíos', () => {
    expect(aEntrada(valido(), M, 'teclado-1')).toEqual({ id: 'teclado-1', nombre: 'Teclado', categoria: 'Accesorios', sku: 'TEC-1', activo: true, conSerie: false, precioUSD: { bo: 1500, ar: 1600 } });
  });
  it('en una edición sin tocar nada no hay cambios', () => {
    const r = cambiosDeEdicion(formInicial(producto(), M), producto(), true, M);
    expect(r.cambios).toEqual({});
    expect(r.vaciados).toEqual([]);
    expect(r.desactiva).toBe(false);
  });
  it('vaciar un dato independiente envía null y lo declara para advertir', () => {
    const f = { ...formInicial(producto(), M), marca: '  ', garantia: '', minimo: '', costo: '' };
    const r = cambiosDeEdicion(f, producto(), true, M);
    expect(r.cambios).toEqual({ marca: null, garantiaMeses: null, minimo: null, costoUSD: null });
    expect(r.vaciados).toEqual(['la marca', 'la garantía', 'el mínimo de existencias', 'el costo']);
  });
  it('un dato que ya estaba vacío no cuenta como vaciado; sin permiso de costo no se toca el costo', () => {
    const p = producto({ marca: undefined as never });
    expect(cambiosDeEdicion(formInicial(p, M), p, true, M).vaciados).toEqual([]);
    expect(cambiosDeEdicion({ ...formInicial(producto(), M), costo: '' }, producto(), false, M).cambios).toEqual({});
  });
  it('el precio va dentro de los cambios (una sola llamada) y desactivar se declara', () => {
    const r = cambiosDeEdicion({ ...formInicial(producto(), M), precios: { bo: '10,50', ar: '9' }, activo: false }, producto(), true, M);
    expect(r.cambios).toEqual({ activo: false, precioUSD: { bo: 1050, ar: 900 } });
    expect(r.desactiva).toBe(true);
  });
  it('lista los datos en texto corrido', () => {
    expect(listaEnTexto(['la marca'])).toBe('la marca');
    expect(listaEnTexto(['la marca', 'el costo'])).toBe('la marca y el costo');
    expect(listaEnTexto(['a', 'b', 'c'])).toBe('a, b y c');
  });
});

describe('errores del servidor a su campo', () => {
  it('SKU en uso; «el producto ya existe» ya no es de un campo (se reintenta con otra clave)', () => {
    expect(errSrv(new ErrorApi('failed-precondition', 'El sku TEC-1 ya está en uso', { codigo: 'estado-invalido' }))?.campo).toBe('sku');
    const yaExiste = new ErrorApi('failed-precondition', 'El producto teclado-1 ya existe', { codigo: 'estado-invalido' });
    expect(errSrv(yaExiste)).toBeNull();
    expect(esProductoYaExiste(yaExiste)).toBe(true);
    expect(esProductoYaExiste(new ErrorApi('failed-precondition', 'El producto sku-1 ya existe', { codigo: 'estado-invalido' }))).toBe(true);
    expect(esProductoYaExiste(new ErrorApi('failed-precondition', 'El sku TEC-1 ya está en uso', { codigo: 'estado-invalido' }))).toBe(false);
  });
  it('el rechazo de conSerie por movimientos va a su casilla', () => {
    expect(errSrv(new ErrorApi('failed-precondition', 'No se puede cambiar si el producto se controla por número de serie: ya tiene movimientos de inventario.', { codigo: 'estado-invalido' }))?.campo).toBe('conSerie');
    expect(errSrv(new ErrorApi('failed-precondition', 'conSerie no cambia tras el primer movimiento', { codigo: 'estado-invalido' }))?.campo).toBe('conSerie');
  });
  it('rutas de campos inválidos, incluido el precio de un mercado', () => {
    expect(errSrv(new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', campos: ['cambios.garantiaMeses'] }))?.campo).toBe('garantia');
    expect(errSrv(new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', campos: ['producto.precioUSD.ar'] }))?.campo).toBe('precio.ar');
  });
  it('lo que no es de un campo queda como error general', () => {
    expect(errSrv(new ErrorApi('resource-exhausted', 'tope', { codigo: 'limite-del-plan' }))).toBeNull();
    expect(errSrv(new Error('x'))).toBeNull();
  });
});

describe('un comercio con un solo mercado y una sola moneda', () => {
  const ctx1 = { nuevo: true, existentes: EXISTENTES, mercados: M1, monedaCosto: 'PEN' };
  const base1 = (): FormProducto => ({ ...formInicial(null, M1), nombre: 'Lápiz', categoria: 'Útiles', sku: 'LAP-1', precios: { pe: '2,50' } });
  it('solo pide y envía el precio de su mercado, con la clave derivada del id', () => {
    expect(Object.keys(formInicial(null, M1).precios)).toEqual(['pe']);
    expect(revisarProducto(base1(), ctx1)).toEqual({});
    expect(Object.keys(revisarProducto(formInicial(null, M1), ctx1))).toContain('precio.pe');
    expect(aEntrada(base1(), M1, 'lapiz')?.precioUSD).toEqual({ pe: 250 });
  });
  it('nombra la moneda del comercio en el error de un monto, no dólares fijos', () => {
    expect(revisarProducto({ ...base1(), precios: { pe: 'x' } }, ctx1)['precio.pe']).toBe('Escriba un monto en PEN, por ejemplo 12,50.');
    expect(revisarProducto({ ...base1(), costo: 'x' }, ctx1)['costo']).toBe('Escriba un monto en PEN, por ejemplo 12,50.');
  });
  it('sin moneda de costo conocida el error no nombra ninguna', () => {
    expect(revisarProducto({ ...base1(), costo: 'x' }, { ...ctx1, monedaCosto: undefined })['costo']).toBe('Escriba un monto, por ejemplo 12,50.');
  });
  it('el servidor ubica el error en el precio del mercado declarado', () => {
    expect(errorDeServidor(new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', campos: ['producto.precioUSD.pe'] }), M1)?.campo).toBe('precio.pe');
  });
});

describe('producto sin precio en un mercado', () => {
  const sinAr = producto({ precioUSD: { bo: 800 } as never, sinPrecio: ['AR'] });
  it('el formulario queda vacío ahí y editar otro dato no obliga a ponerlo', () => {
    const f = formInicial(sinAr, M);
    expect(f.precios).toEqual({ bo: '8,00', ar: '' });
    expect(revisarProducto(f, { ...CTX, nuevo: false, sinPrecio: ['ar'] })).toEqual({});
    expect(cambiosDeEdicion({ ...f, categoria: 'Otra' }, sinAr, true, M).cambios).toEqual({ categoria: 'Otra' });
  });
  it('quitar un precio existente sigue siendo un error y el alta exige todos', () => {
    expect(revisarProducto({ ...formInicial(sinAr, M), precios: { bo: '', ar: '' } }, { ...CTX, nuevo: false, sinPrecio: ['ar'] })['precio.bo']).toBeTruthy();
    expect(revisarProducto({ ...valido(), precios: { bo: '1', ar: '' } }, { ...CTX, sinPrecio: ['ar'] })['precio.ar']).toBeTruthy();
  });
  it('ponerle precio lo envía; el mercado vacío no se envía', () => {
    expect(cambiosDeEdicion({ ...formInicial(sinAr, M), precios: { bo: '8', ar: '12' } }, sinAr, true, M).cambios).toEqual({ precioUSD: { bo: 800, ar: 1200 } });
  });
});
