// «Categorías» del panel: sus topes e íconos coinciden con los del servidor y lo que arma es lo que el servidor acepta.
import { describe, expect, it } from 'vitest';
import { IDS_ICONO_NEGOCIO, LIMITES_NEGOCIO, validarNegocioSitio } from '@novutienda/consola/negocio';
import {
  aplicarCategoria, claveDesdeNombre, ICONOS_CATEGORIA, leerCategorias, moverCategoria, revisarCategoria, TOPES_CATEGORIAS, unirCategorias,
} from '@novutienda/panel/consola';

const negocio = {
  nombre: 'Tienda Ejemplo', lema: 'Lema', telefono: '22223333', correo: 'hola@ejemplo.test', direccion: 'Calle 1', horario: null,
  enlacesPermitidos: ['ejemplo.test'],
  portada: { insignia: 'Nuevo', titulo: ['Uno', 'Dos', 'Tres'], texto: 'Texto', textoBotonCatalogo: 'Ver', textoBotonConsulta: 'Consultar' },
  beneficios: [],
  identidad: { etiqueta: 'N', titulo: 'T', texto: 'X', foto: null, cifra: null, valores: [], sello: { texto: 'S', confirmada: false } },
  textoPrivacidad: ['P'],
  categorias: { 'linea-blanca': { nombre: 'Línea blanca', icono: 'lavadora', orden: 0 }, tv: { nombre: 'Televisores', icono: 'televisor', oculta: true, orden: 1 } },
  destacados: [],
};
const valido = (n: unknown): boolean => { try { validarNegocioSitio(n, { nivel: 'estricto' }); return true; } catch { return false; } };

describe('categorías del panel', () => {
  it('los topes y los íconos son los del servidor', () => {
    expect(TOPES_CATEGORIAS.nombre).toEqual(LIMITES_NEGOCIO.categorias.nombre);
    expect(TOPES_CATEGORIAS.max).toBe(LIMITES_NEGOCIO.categorias.max);
    expect(TOPES_CATEGORIAS.orden).toEqual(LIMITES_NEGOCIO.categorias.orden);
    expect(ICONOS_CATEGORIA.map((i) => i.id)).toEqual([...IDS_ICONO_NEGOCIO]);
  });
  it('la clave que se arma desde el nombre cumple la regla del servidor', () => {
    expect(claveDesdeNombre('Línea blanca')).toBe('linea-blanca');
    expect(claveDesdeNombre('  Cámaras & Lentes (2) ')).toBe('camaras-lentes-2');
    expect(claveDesdeNombre('¡¡¡')).toBe('');
    for (const n of ['Línea blanca', 'Ñandú', 'A'.repeat(200)]) {
      const clave = claveDesdeNombre(n);
      expect(valido({ ...negocio, categorias: { [clave]: { nombre: 'X', icono: 'pin' } } }), n).toBe(true);
    }
  });
  it('une las categorías del negocio con las claves de los productos y cuenta', () => {
    const v = unirCategorias(negocio, ['linea-blanca', 'linea-blanca', 'nueva', 'tv', '']);
    expect(v.map((c) => [c.clave, c.productos, c.definida, c.oculta])).toEqual([['linea-blanca', 2, true, false], ['tv', 1, true, true], ['nueva', 1, false, false]]);
    expect(unirCategorias(null, [])).toEqual([]);
  });
  it('aplicar una categoría conserva el resto del documento y su orden; el servidor lo acepta', () => {
    const n = aplicarCategoria(negocio, 'tv', { nombre: ' Pantallas ', icono: 'pin', oculta: false });
    expect(n['categorias']).toEqual({ ...negocio.categorias, tv: { nombre: 'Pantallas', icono: 'pin', orden: 1 } });
    expect({ ...n, categorias: undefined }).toEqual({ ...negocio, categorias: undefined });
    expect(valido(n)).toBe(true);
    const nueva = aplicarCategoria(negocio, 'radios', { nombre: 'Radios', icono: 'parlante', oculta: true });
    expect(leerCategorias(nueva)['radios']).toEqual({ nombre: 'Radios', icono: 'parlante', oculta: true });
    expect(valido(nueva)).toBe(true);
  });
  it('mover numera las categorías definidas y el servidor lo acepta', () => {
    const v = unirCategorias(negocio, ['nueva']);
    const n = moverCategoria(negocio, v, 'tv', -1);
    expect(leerCategorias(n)['tv']?.orden).toBe(0);
    expect(leerCategorias(n)['linea-blanca']?.orden).toBe(1);
    expect(valido(n)).toBe(true);
    expect(moverCategoria(negocio, v, 'linea-blanca', -1)['categorias']).toEqual(negocio.categorias);
  });
  it('los errores del panel son los que el servidor rechazaría', () => {
    expect(revisarCategoria({ nombre: '', icono: 'pin' }, null).nombre).toBeDefined();
    expect(revisarCategoria({ nombre: 'a'.repeat(81), icono: 'pin' }, null).nombre).toBeDefined();
    expect(valido({ ...negocio, categorias: { x: { nombre: 'a'.repeat(81), icono: 'pin' } } })).toBe(false);
    expect(revisarCategoria({ nombre: '<b>x</b>', icono: 'pin' }, null).nombre).toBeDefined();
    expect(revisarCategoria({ nombre: 'Línea blanca', icono: 'pin' }, { negocio, claves: ['linea-blanca'] }).nombre).toBe('Ya existe una categoría con ese nombre.');
    expect(revisarCategoria({ nombre: 'Radios', icono: 'pin' }, { negocio, claves: ['linea-blanca'] })).toEqual({});
    const lleno = { ...negocio, categorias: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c-${String(i)}`, { nombre: 'C', icono: 'pin' }])) };
    expect(revisarCategoria({ nombre: 'Otra', icono: 'pin' }, { negocio: lleno, claves: [] }).categorias).toBeDefined();
  });
});
