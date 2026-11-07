import { describe, expect, it } from 'vitest';
import { ErrorGenerador, generarReglas } from '../../scripts/generar-reglas.mjs';
import { construirCasos, OPERACIONES, ROLES } from './matriz.js';
import { crearRegistro, ErrorRegistro, type ColeccionManifiesto, type ManifiestoModulo } from '@novutienda/nucleo';

const mod = (id: string, colecciones: ColeccionManifiesto[]): ManifiestoModulo => ({
  id,
  version: '1.0.0',
  dependeDe: [],
  submodulos: [],
  colecciones,
  emite: [],
  consume: [],
});
const raiz = (extra: Partial<ColeccionManifiesto> = {}): ColeccionManifiesto => ({
  ruta: 'global',
  ambito: 'raiz',
  lectura: [],
  escritura: 'servidor',
  ...extra,
});

describe('colecciones de raíz en el registro del núcleo', () => {
  it('acepta una raíz válida y devuelve su ruta como las demás', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('a', [raiz(), { ruta: 'otra', lectura: ['adm'], escritura: 'servidor' }]));
    expect(r.rutas()).toEqual(['global', 'otra']);
  });

  it('rechaza raíz con roles de lectura o de escritura', () => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() => r.registrar(mod('a', [raiz({ lectura: ['adm'] })]))).toThrow(ErrorRegistro);
    expect(() => r.registrar(mod('a', [raiz({ escritura: ['adm'] })]))).toThrow(/servidor/);
    expect(() => r.registrar(mod('a', [raiz({ escritura: [] })]))).toThrow(ErrorRegistro);
  });

  it('rechaza raíz con límite, de dos segmentos o llamada tenants', () => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() => r.registrar(mod('a', [raiz({ limite: 'usuarios' })]))).toThrow(/límite/);
    expect(() => r.registrar(mod('a', [raiz({ ruta: 'a/b' })]))).toThrow(/un solo segmento/);
    expect(() => r.registrar(mod('a', [raiz({ ruta: 'tenants' })]))).toThrow(/tenants/);
  });

  it('la raíz tenants solo la admite el manifiesto plataforma (registro y generador)', () => {
    const tenants = raiz({ ruta: 'tenants' });
    for (const id of ['a', 'nucleo', 'consola', 'plataforma2', 'plataforma-x']) {
      expect(() => crearRegistro<ManifiestoModulo>().registrar(mod(id, [tenants]))).toThrow(/tenants/);
      expect(() => generarReglas([{ id, colecciones: [tenants] }])).toThrow(/tenants/);
    }
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('plataforma', [tenants]));
    expect(r.rutas()).toEqual(['tenants']);
    const reglas = generarReglas([{ id: 'plataforma', colecciones: [tenants] }]);
    expect(reglas).toMatch(/match \/tenants\/\{id\} \{\n\s+allow read: if false;\n\s+allow write: if false;/);
  });

  it('en plataforma, tenants sigue exigiendo lectura [] y escritura servidor', () => {
    for (const mala of [raiz({ ruta: 'tenants', lectura: ['adm'] }), raiz({ ruta: 'tenants', escritura: ['adm'] })]) {
      expect(() => crearRegistro<ManifiestoModulo>().registrar(mod('plataforma', [mala]))).toThrow(ErrorRegistro);
      expect(() => generarReglas([{ id: 'plataforma', colecciones: [mala] }])).toThrow(ErrorGenerador);
    }
  });

  it('rechaza un ámbito desconocido', () => {
    const r = crearRegistro<ManifiestoModulo>();
    const rara = { ...raiz(), ambito: 'otro' } as unknown as ColeccionManifiesto;
    expect(() => r.registrar(mod('a', [rara]))).toThrow(/Ámbito/);
  });

  it('los nombres son únicos entre ámbitos, en el mismo módulo y entre módulos', () => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() =>
      r.registrar(mod('a', [raiz(), { ruta: 'global', lectura: ['adm'], escritura: 'servidor' }])),
    ).toThrow(/duplicada/);
    r.registrar(mod('b', [{ ruta: 'global', lectura: ['adm'], escritura: 'servidor' }]));
    expect(() => r.registrar(mod('c', [raiz()]))).toThrow(/duplicada/);
  });

  it('una colección sin ámbito se comporta como de tenant', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(mod('a', [{ ruta: 'x/y/z', lectura: ['adm'], escritura: ['adm'] }]));
    expect(r.rutas()).toEqual(['x/y/z']);
  });

  it.each(['x y', 'a{b}', '*', '..', '', 'x\n', '1a', 'a.b'])('rechaza raíz con caracteres no admitidos: %j', (ruta) => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() => r.registrar(mod('a', [raiz({ ruta })]))).toThrow(ErrorRegistro);
  });

  it.each(['x y', 'a{b}', '*', 'a/..', '', 'x\n', 'a/b c', 'a/{id}'])('rechaza ruta de tenant con caracteres no admitidos: %j', (ruta) => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() => r.registrar(mod('a', [{ ruta, lectura: ['adm'], escritura: 'servidor' }]))).toThrow(ErrorRegistro);
  });

  it('el mensaje de caracteres no admitidos nombra la ruta', () => {
    const r = crearRegistro<ManifiestoModulo>();
    expect(() => r.registrar(mod('a', [raiz({ ruta: 'x y' })]))).toThrow('Ruta con caracteres no admitidos: "x y"');
  });
});

// Paridad: el registro del núcleo y el generador aceptan y rechazan lo mismo.
describe('paridad de validación entre el registro y el generador', () => {
  const entradas: [string, ColeccionManifiesto][] = [];
  const rutas = ['ok', 'a-b_c', 'A1', 'a/b/c', 'x y', 'a{b}', '*', '..', 'a/..', '', 'x\n', '1a', 'a.b', '/a', 'a/', 'a//b', 'a/b', 'tenants', 'Tenants', 'tenants/x/y'];
  for (const ruta of rutas) {
    entradas.push([`tenant ${JSON.stringify(ruta)}`, { ruta, lectura: ['adm'], escritura: 'servidor' }]);
    entradas.push([`raíz ${JSON.stringify(ruta)}`, raiz({ ruta })]);
  }
  entradas.push(['raíz con lectura', raiz({ lectura: ['adm'] })]);
  entradas.push(['raíz con escritura por roles', raiz({ escritura: ['adm'] })]);
  entradas.push(['raíz con límite', raiz({ limite: 'usuarios' })]);

  it.each(entradas.flatMap(([n, c]) => [[n, c, 'a'] as const, [`${n} (plataforma)`, c, 'plataforma'] as const]))('%s', (_n, c, id) => {
    const enRegistro = (() => {
      try {
        crearRegistro<ManifiestoModulo>().registrar(mod(id, [c]));
        return true;
      } catch (e) {
        if (!(e instanceof ErrorRegistro)) throw e;
        return false;
      }
    })();
    const enGenerador = (() => {
      try {
        generarReglas([{ id, colecciones: [c] }]);
        return true;
      } catch (e) {
        if (!(e instanceof ErrorGenerador)) throw e;
        return false;
      }
    })();
    expect(enRegistro).toBe(enGenerador);
  });
});

describe('matriz del emulador con colecciones de raíz', () => {
  const m = {
    id: 'demo',
    colecciones: [
      { ruta: 'global', ambito: 'raiz' as const, lectura: [], escritura: 'servidor' as const },
      { ruta: 'productos', lectura: ['adm'], escritura: ['adm'] },
    ],
  };
  const casos = construirCasos([m]);
  const deRaiz = casos.filter((c) => c.ambito === 'raiz');

  it('emite casos de raíz solo para la colección de raíz, todos denegados', () => {
    expect(deRaiz.length).toBeGreaterThan(0);
    expect(deRaiz.every((c) => c.ruta === 'global' && !c.esperado)).toBe(true);
    expect(casos.filter((c) => c.ruta === 'global').length).toBe(deRaiz.length);
    expect(casos.filter((c) => c.ruta === 'productos').every((c) => c.ambito === undefined)).toBe(true);
  });

  it('cubre las tres personas de rol y las cinco operaciones', () => {
    for (const rol of ROLES) {
      for (const op of OPERACIONES) {
        expect(deRaiz.some((c) => c.sujeto.nombre === `${rol}@tenant-a` && c.operacion === op)).toBe(true);
      }
    }
    expect(new Set(deRaiz.map((c) => c.operacion))).toEqual(new Set(OPERACIONES));
  });

  it('incluye a los hostiles en las cinco operaciones', () => {
    const hostiles = new Set(deRaiz.map((c) => c.sujeto.nombre).filter((n) => !n.includes('@')));
    expect(hostiles.has('sin autenticar')).toBe(true);
    expect(hostiles.size).toBe(13);
    for (const n of hostiles) expect(deRaiz.filter((c) => c.sujeto.nombre === n).length).toBe(OPERACIONES.length);
  });
});
