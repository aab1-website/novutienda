import { describe, expect, it } from 'vitest';
import { registroPlataforma } from '../../plataforma/registro.js';
import { crearRegistro, modulosEfectivos, validarEncendido } from '@novutienda/nucleo';
import type { ManifiestoModulo } from '@novutienda/nucleo';

const m = (id: string, extra: Record<string, unknown> = {}): ManifiestoModulo =>
  ({ id, version: '1.0.0', dependeDe: [], submodulos: [], colecciones: [], emite: [], consume: [], ...extra }) as ManifiestoModulo;

const rechaza = (x: ManifiestoModulo) => () => crearRegistro<ManifiestoModulo>().registrar(x);
const pant = { id: 'ventas', titulo: 'Ventas', roles: ['caj'], orden: 1 };
const prog = { id: 'cierre', horario: '0 3 * * *', zonaHoraria: 'America/La_Paz', porTenant: true };

describe('zona coherente con NO_ENCENDIBLES', () => {
  it('rechaza panel con zona modulo y ventas con zona central', () => {
    expect(rechaza(m('panel', { zona: 'modulo' }))).toThrow(/incoherente/);
    expect(rechaza(m('ventas', { zona: 'central' }))).toThrow(/incoherente/);
    expect(rechaza(m('ventas', { zona: 'nucleo' }))).toThrow(/incoherente/);
  });
  it('acepta las coherentes', () => {
    expect(rechaza(m('panel', { zona: 'central' }))).not.toThrow();
    expect(rechaza(m('plataforma', { zona: 'plataforma' }))).not.toThrow();
    expect(rechaza(m('ventas', { zona: 'modulo' }))).not.toThrow();
  });
});

describe('requiere hostil', () => {
  it.each([
    ["x'); allow write: if true; //"],
    [[42, null]],
    ['b'],
    [[{}]],
  ])('rechaza %j', (v) => {
    const x = Array.isArray(v) && typeof v[0] === 'string' ? v : v;
    expect(rechaza(m('x', { requiere: x }))).toThrow(/requiere/);
  });
  it('requiere desconocido falla al ordenar; los no encendibles se aceptan', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(m('x', { requiere: ['fantasma'] }));
    expect(() => r.ordenTopologico()).toThrow(/Requiere ausente/);
    const ok = crearRegistro<ManifiestoModulo>();
    ok.registrar(m('x', { requiere: ['panel'] }));
    expect(ok.ordenTopologico()).toEqual(['x']);
  });
  it('detecta ciclos por requiere', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(m('a', { requiere: ['b'] }));
    r.registrar(m('b', { dependeDe: ['a'] }));
    expect(() => r.ordenTopologico()).toThrow(/Ciclo/);
  });
  it('requiere no altera el orden (solo dependeDe lo fija)', () => {
    const con = crearRegistro<ManifiestoModulo>();
    con.registrar(m('a', { requiere: ['b'] }));
    con.registrar(m('b'));
    const sin = crearRegistro<ManifiestoModulo>();
    sin.registrar(m('a'));
    sin.registrar(m('b'));
    expect(con.ordenTopologico()).toEqual(['a', 'b']);
    expect(con.ordenTopologico()).toEqual(sin.ordenTopologico());
  });
  it('el orden del registro real no cambia por los requiere declarados', () => {
    const ms = registroPlataforma.listar();
    const sin = crearRegistro<ManifiestoModulo>();
    for (const x of ms) sin.registrar({ ...x, requiere: [] });
    expect(registroPlataforma.ordenTopologico()).toEqual(sin.ordenTopologico());
    const o = registroPlataforma.ordenTopologico();
    // Fija que `requiere` no altera el orden (el orden alimenta las reglas generadas); no es una regla de negocio.
    expect(o.indexOf('website')).toBeLessThan(o.indexOf('consola'));
  });
});

describe('listas que no son listas', () => {
  it.each(['pantallas', 'acciones', 'programadas', 'requiere'])('%s no lista -> ErrorRegistro', (campo) => {
    for (const v of ['texto', 5, {}]) {
      expect(rechaza(m('x', { [campo]: v }))).toThrow(/debe ser una lista|inválido/);
    }
  });
});

describe('acciones.propietario', () => {
  it("rechaza 'false' texto", () => {
    expect(rechaza(m('x', { acciones: [{ callable: 'a', nombre: 'b', roles: ['adm'], propietario: 'false' }] }))).toThrow(/propietario/);
  });
});

describe('programadas hostiles', () => {
  const con = (o: Record<string, unknown>) => m('x', { programadas: [{ ...prog, ...o }] });
  it.each([
    ['horario', "0 3 * * *'; rm"],
    ['horario', 'every 0 minutes'],
    ['horario', 'every 5 days'],
    ['horario', ''],
    ['zonaHoraria', 'Mars/Olympus'],
    ['zonaHoraria', '../etc'],
    ['zonaHoraria', ''],
    ['porTenant', 'true'],
    ['porTenant', undefined],
  ])('rechaza %s = %j', (campo, valor) => {
    expect(rechaza(con({ [campo]: valor }))).toThrow(/inválid|booleano/);
  });
  it('acepta cron, every y UTC', () => {
    expect(rechaza(con({ horario: 'every 15 minutes' }))).not.toThrow();
    expect(rechaza(con({ horario: '*/5 0-3 * * 1,2', zonaHoraria: 'UTC' }))).not.toThrow();
  });
});

describe('textos visibles', () => {
  const con = (o: Record<string, unknown>) => m('x', { pantallas: [{ ...pant, ...o }] });
  it.each([
    ['vacío', { titulo: '  ' }],
    ['largo', { titulo: 'a'.repeat(61) }],
    ['control', { titulo: 'a\nb' }],
    ['nulo', { titulo: 'a\u0000b' }],
    ['no texto', { titulo: 5 }],
    ['por rol largo', { tituloPorRol: { caj: 'a'.repeat(61) } }],
    ['por rol control', { tituloPorRol: { caj: 'x\u001b[0m' } }],
    ['por rol vacío', { tituloPorRol: { caj: '' } }],
  ])('rechaza %s', (_n, o) => {
    expect(rechaza(con(o))).toThrow(/texto/);
  });
});

describe('encendido hostil', () => {
  it('rechaza manifiestos con id repetido', () => {
    const ms = [m('x', { requiere: ['y'] }), m('x'), m('y')];
    expect(() => modulosEfectivos(ms, ['x', 'y'])).toThrow(/repetido/);
    const r = validarEncendido(ms, ['x', 'y']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toMatch(/repetido/);
  });
  it('ciclo a<->b: con ambos encendidos ninguno es efectivo (nada los habilita), con uno tampoco', () => {
    const ms = [m('a', { requiere: ['b'] }), m('b', { dependeDe: ['a'] })];
    expect(modulosEfectivos(ms, ['a', 'b'])).toEqual(['a', 'b']);
    expect(modulosEfectivos(ms, ['a'])).toEqual([]);
    expect(modulosEfectivos(ms, ['b'])).toEqual([]);
  });
  it('__proto__ y valores no texto en encendidos', () => {
    const ms = [m('a')];
    expect(modulosEfectivos(ms, ['__proto__', 'constructor'])).toEqual([]);
    expect(modulosEfectivos(ms, [42, null, {}] as never)).toEqual([]);
    expect(validarEncendido(ms, ['__proto__']).ok).toBe(false);
    const r = validarEncendido(ms, [42, null] as never);
    expect(r.ok).toBe(false);
  });
});

describe('roles vacíos y fuera de lista', () => {
  const acc = (extra: Record<string, unknown>) => ({ callable: 'ventas', nombre: 'anular', roles: ['caj'], ...extra });
  it('rechaza una acción con roles vacíos y sin propietario', () => {
    expect(rechaza(m('x', { acciones: [acc({ roles: [] })] }))).toThrow(/vacío/);
    expect(rechaza(m('x', { acciones: [acc({ roles: [], propietario: false })] }))).toThrow(/vacío/);
  });
  it('acepta roles vacíos solo con propietario', () => {
    expect(rechaza(m('x', { acciones: [acc({ roles: [], propietario: true })] }))).not.toThrow();
  });
  it('rechaza una pantalla con roles vacíos', () => {
    expect(rechaza(m('x', { pantallas: [{ ...pant, roles: [] }] }))).toThrow(/vacío/);
  });
  it('un rol fuera de la lista sigue rechazado', () => {
    expect(rechaza(m('x', { acciones: [acc({ roles: ['otro'] })] }))).toThrow(/rol inválido/);
    expect(rechaza(m('x', { pantallas: [{ ...pant, roles: ['otro'] }] }))).toThrow(/rol inválido/);
  });
  it('los roles de una acción o pantalla tipada son Rol, no string', () => {
    const tipada: ManifiestoModulo = {
      ...m('x'),
      // @ts-expect-error 'otro' no es un Rol
      acciones: [{ callable: 'ventas', nombre: 'anular', roles: ['otro'] }],
    };
    expect(tipada.id).toBe('x');
  });
});
