import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../../api/errores.js';
import type { ProductoPanel } from '../../api/tipos.js';
import { aEntrada, cambiosDeEdicion, errorDeServidor, formInicial, identificadorSugerido, listaEnTexto, revisarProducto, type FormProducto } from './producto-revision.js';

const EXISTENTES = [{ id: 'cable-hdmi', sku: 'CABLE-HDMI' }];
const CTX = { nuevo: true, existentes: EXISTENTES };
const valido = (): FormProducto => ({ ...formInicial(null), id: 'teclado-1', nombre: 'Teclado', categoria: 'Accesorios', sku: 'TEC-1', precios: { bo: '15', ar: '16' } });
const producto = (extra: Partial<ProductoPanel> = {}): ProductoPanel => ({
  id: 'cable-hdmi', nombre: 'Cable HDMI 2 m', categoria: 'Accesorios', marca: 'Cabletec', sku: 'CABLE-HDMI', activo: true, publicado: true, conSerie: false, garantiaMeses: 6, minimo: 10,
  precioUSD: { bo: 800, ar: 900 }, costoUSD: 300, stockTotal: 35, existencias: { tienda: 25, 'deposito-1': 10, 'deposito-2': 0 }, bajoMinimo: false, disponible: true, ...extra,
});

describe('identificador sugerido', () => {
  it('sale del nombre sin tildes, en minúsculas y con guiones', () => {
    expect(identificadorSugerido('Cable HDMI 2 m')).toBe('cable-hdmi-2-m');
    expect(identificadorSugerido('  Audífonos  inalámbricos! ')).toBe('audifonos-inalambricos');
  });
  it('queda vacío si no alcanza para un identificador válido y se acota a 56 caracteres', () => {
    expect(identificadorSugerido('!')).toBe('');
    expect(identificadorSugerido('a'.repeat(100)).length).toBe(56);
  });
  it('no repite uno existente: agrega -2, -3', () => {
    expect(identificadorSugerido('Cable HDMI', new Set(['cable-hdmi']))).toBe('cable-hdmi-2');
    expect(identificadorSugerido('Cable HDMI', new Set(['cable-hdmi', 'cable-hdmi-2']))).toBe('cable-hdmi-3');
  });
});

describe('revisión del producto', () => {
  it('un alta completa no tiene errores', () => {
    expect(revisarProducto(valido(), CTX)).toEqual({});
  });
  it('marca un error por campo, con el mensaje de cada uno', () => {
    const e = revisarProducto({ ...formInicial(null) }, CTX);
    expect(Object.keys(e).sort()).toEqual(['categoria', 'id', 'nombre', 'precio.ar', 'precio.bo', 'sku']);
    expect(e['precio.ar']).toMatch(/Falta el precio de Argentina/);
    expect(e['precio.bo']).toMatch(/Falta el precio de Bolivia/);
  });
  it('recorre los mercados del núcleo y no pide nada de más en una edición', () => {
    const e = revisarProducto({ ...formInicial(producto()), precios: { bo: '', ar: 'x' } }, { nuevo: false, existentes: EXISTENTES });
    expect(e['precio.bo']).toBeTruthy();
    expect(e['precio.ar']).toMatch(/monto en dólares/);
    expect(e['id']).toBeUndefined();
    expect(e['sku']).toBeUndefined();
  });
  it('rechaza identificador o SKU repetidos y con formato inválido', () => {
    expect(revisarProducto({ ...valido(), id: 'cable-hdmi' }, CTX)['id']).toMatch(/Ya existe/);
    expect(revisarProducto({ ...valido(), id: 'Mal Id' }, CTX)['id']).toMatch(/minúsculas/);
    expect(revisarProducto({ ...valido(), sku: 'CABLE-HDMI' }, CTX)['sku']).toMatch(/ya lo usa/);
    expect(revisarProducto({ ...valido(), sku: 'a b' }, CTX)['sku']).toMatch(/letras, números/);
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
    expect(aEntrada(valido())).toEqual({ id: 'teclado-1', nombre: 'Teclado', categoria: 'Accesorios', sku: 'TEC-1', activo: true, conSerie: false, precioUSD: { bo: 1500, ar: 1600 } });
  });
  it('en una edición sin tocar nada no hay cambios', () => {
    const r = cambiosDeEdicion(formInicial(producto()), producto(), true);
    expect(r.cambios).toEqual({});
    expect(r.precio).toBeNull();
    expect(r.vaciados).toEqual([]);
    expect(r.desactiva).toBe(false);
  });
  it('vaciar un dato independiente envía null y lo declara para advertir', () => {
    const f = { ...formInicial(producto()), marca: '  ', garantia: '', minimo: '', costo: '' };
    const r = cambiosDeEdicion(f, producto(), true);
    expect(r.cambios).toEqual({ marca: null, garantiaMeses: null, minimo: null, costoUSD: null });
    expect(r.vaciados).toEqual(['la marca', 'la garantía', 'el mínimo de existencias', 'el costo']);
  });
  it('un dato que ya estaba vacío no cuenta como vaciado; sin permiso de costo no se toca el costo', () => {
    const p = producto({ marca: undefined as never });
    expect(cambiosDeEdicion(formInicial(p), p, true).vaciados).toEqual([]);
    expect(cambiosDeEdicion({ ...formInicial(producto()), costo: '' }, producto(), false).cambios).toEqual({});
  });
  it('el precio va aparte y desactivar se declara', () => {
    const r = cambiosDeEdicion({ ...formInicial(producto()), precios: { bo: '10,50', ar: '9' }, activo: false }, producto(), true);
    expect(r.precio).toEqual({ bo: 1050, ar: 900 });
    expect(r.cambios).toEqual({ activo: false });
    expect(r.desactiva).toBe(true);
  });
  it('lista los datos en texto corrido', () => {
    expect(listaEnTexto(['la marca'])).toBe('la marca');
    expect(listaEnTexto(['la marca', 'el costo'])).toBe('la marca y el costo');
    expect(listaEnTexto(['a', 'b', 'c'])).toBe('a, b y c');
  });
});

describe('errores del servidor a su campo', () => {
  it('SKU en uso e identificador repetido', () => {
    expect(errorDeServidor(new ErrorApi('failed-precondition', 'El sku TEC-1 ya está en uso', { codigo: 'estado-invalido' }))?.campo).toBe('sku');
    expect(errorDeServidor(new ErrorApi('failed-precondition', 'El producto teclado-1 ya existe', { codigo: 'estado-invalido' }))?.campo).toBe('id');
  });
  it('rutas de campos inválidos, incluido el precio de un mercado', () => {
    expect(errorDeServidor(new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', campos: ['cambios.garantiaMeses'] }))?.campo).toBe('garantia');
    expect(errorDeServidor(new ErrorApi('invalid-argument', 'x', { codigo: 'entrada-invalida', campos: ['producto.precioUSD.ar'] }))?.campo).toBe('precio.ar');
  });
  it('lo que no es de un campo queda como error general', () => {
    expect(errorDeServidor(new ErrorApi('resource-exhausted', 'tope', { codigo: 'limite-del-plan' }))).toBeNull();
    expect(errorDeServidor(new Error('x'))).toBeNull();
  });
});
