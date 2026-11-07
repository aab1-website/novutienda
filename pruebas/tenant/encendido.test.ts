import { describe, expect, it } from 'vitest';
import { crearRegistro, modulosEfectivos, NO_ENCENDIBLES, validarEncendido } from '@novutienda/nucleo';
import { registroPlataforma } from '../../plataforma/registro.js';
import type { ManifiestoModulo } from '@novutienda/nucleo';

const m = (id: string, extra: Partial<ManifiestoModulo> = {}): ManifiestoModulo => ({
  id,
  version: '1.0.0',
  dependeDe: [],
  submodulos: [],
  colecciones: [],
  emite: [],
  consume: [],
  ...extra,
});

const manifiestos = [
  m('nucleo', { zona: 'nucleo' }),
  m('recibos'),
  m('inventarios'),
  m('pos', { dependeDe: ['recibos'], requiere: ['inventarios'] }),
  m('a'),
  m('b', { dependeDe: ['a'] }),
  m('c', { requiere: ['b'] }),
];

describe('modulosEfectivos', () => {
  it('con todo encendido, todo es efectivo', () => {
    expect(modulosEfectivos(manifiestos, ['recibos', 'inventarios', 'pos'])).toEqual(['recibos', 'inventarios', 'pos']);
  });
  it('pos sin recibos (dependeDe) no es efectivo', () => {
    expect(modulosEfectivos(manifiestos, ['inventarios', 'pos'])).toEqual(['inventarios']);
  });
  it('pos sin inventarios (requiere) no es efectivo', () => {
    expect(modulosEfectivos(manifiestos, ['recibos', 'pos'])).toEqual(['recibos']);
  });
  it('cadena transitiva: sin a, ni b ni c', () => {
    expect(modulosEfectivos(manifiestos, ['b', 'c'])).toEqual([]);
    expect(modulosEfectivos(manifiestos, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it.each(NO_ENCENDIBLES)('%s nunca es efectivo', (id) => {
    expect(modulosEfectivos([...manifiestos.filter((x) => x.id !== id), m(id)], [id, 'recibos'])).toEqual(['recibos']);
  });
  it('depender de un no encendible no impide ser efectivo (siempre satisfecho)', () => {
    const ms = [m('nucleo'), m('x', { dependeDe: ['nucleo'], requiere: ['nucleo'] })];
    expect(modulosEfectivos(ms, ['x'])).toEqual(['x']);
    expect(validarEncendido(ms, ['x'])).toEqual({ ok: true });
    expect(validarEncendido(ms, ['nucleo', 'x']).ok).toBe(false);
  });
  it('registro real: recibos y pos efectivos; inventarios solo también', () => {
    const ms = registroPlataforma.listar();
    expect(modulosEfectivos(ms, ['recibos', 'pos'])).toEqual(['recibos', 'pos']);
    expect(validarEncendido(ms, ['recibos', 'pos'])).toEqual({ ok: true });
    expect(modulosEfectivos(ms, ['inventarios'])).toEqual(['inventarios']);
  });
  it('ignora ids desconocidos', () => {
    expect(modulosEfectivos(manifiestos, ['fantasma'])).toEqual([]);
  });
});

describe('validarEncendido', () => {
  it('acepta un encendido completo', () => {
    expect(validarEncendido(manifiestos, ['recibos', 'inventarios', 'pos'])).toEqual({ ok: true });
  });
  it('un error por cada falta', () => {
    const r = validarEncendido(manifiestos, ['pos']);
    expect(r).toEqual({
      ok: false,
      errores: ['pos requiere recibos, que no está encendido', 'pos requiere inventarios, que no está encendido'],
    });
  });
  it.each(NO_ENCENDIBLES)('rechaza %s', (id) => {
    const r = validarEncendido([...manifiestos.filter((x) => x.id !== id), m(id)], [id]);
    expect(r.ok).toBe(false);
  });
  it('rechaza ids desconocidos', () => {
    const r = validarEncendido(manifiestos, ['fantasma']);
    expect(r.ok).toBe(false);
  });
});

describe('contrato L2 del manifiesto', () => {
  const rechaza = (x: ManifiestoModulo) => () => crearRegistro<ManifiestoModulo>().registrar(x);
  const pant = { id: 'ventas', titulo: 'Ventas', roles: ['caj'] as const, orden: 1 };
  const acc = { callable: 'ventas', nombre: 'anular', roles: ['sup'] as const };

  it('acepta un manifiesto completo y agrega con el módulo dueño', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(
      m('pos', {
        zona: 'modulo',
        pantallas: [{ ...pant, tituloPorRol: { caj: 'Mis ventas' } }],
        acciones: [{ ...acc, propietario: true }],
        programadas: [{ id: 'cierre', horario: '0 3 * * *', zonaHoraria: 'America/La_Paz', porTenant: true }],
        requiere: ['inventarios'],
      }),
    );
    expect(r.pantallas()[0]).toMatchObject({ id: 'ventas', modulo: 'pos' });
    expect(r.acciones()[0]).toMatchObject({ callable: 'ventas', nombre: 'anular', modulo: 'pos' });
    expect(r.programadas()[0]).toMatchObject({ id: 'cierre', modulo: 'pos' });
    expect(r.rutas()).toEqual([]);
    expect(r.rutasAlmacenamiento()).toEqual([]);
  });
  it('rechaza zona inválida', () => {
    expect(rechaza(m('x', { zona: 'otra' as never }))).toThrow(/Zona inválida/);
  });
  it('rechaza nombres con guion', () => {
    expect(rechaza(m('x', { acciones: [{ ...acc, nombre: 'a-b' }] }))).toThrow(/nombre inválido/);
    expect(rechaza(m('x', { acciones: [{ ...acc, callable: 'a-b' }] }))).toThrow(/callable inválido/);
    expect(rechaza(m('x', { pantallas: [{ ...pant, id: 'a-b' }] }))).toThrow(/id inválido/);
    expect(rechaza(m('x', { programadas: [{ id: 'a-b', horario: 'x', zonaHoraria: 'UTC', porTenant: false }] }))).toThrow(/id inválido/);
  });
  it('rechaza rol desconocido, orden negativo y horario vacío', () => {
    expect(rechaza(m('x', { pantallas: [{ ...pant, roles: ['zz' as never] }] }))).toThrow(/rol inválido/);
    expect(rechaza(m('x', { pantallas: [{ ...pant, orden: -1 }] }))).toThrow(/orden/);
    expect(rechaza(m('x', { pantallas: [{ ...pant, orden: 1.5 }] }))).toThrow(/orden/);
    expect(rechaza(m('x', { programadas: [{ id: 'p', horario: ' ', zonaHoraria: 'UTC', porTenant: false }] }))).toThrow(/horario/);
  });
  it('rechaza duplicados dentro y entre módulos', () => {
    expect(rechaza(m('x', { pantallas: [pant, pant] }))).toThrow(/duplicado/);
    expect(rechaza(m('x', { acciones: [acc, acc] }))).toThrow(/duplicada/);
    const r = crearRegistro<ManifiestoModulo>();
    const prog = { id: 'p', horario: '* * * * *', zonaHoraria: 'UTC', porTenant: false };
    r.registrar(m('x', { pantallas: [pant], acciones: [acc], programadas: [prog] }));
    r.registrar(m('y', { pantallas: [pant], acciones: [acc], programadas: [prog] }));
    expect(() => r.pantallas()).toThrow(/pantalla duplicado/);
    expect(() => r.acciones()).toThrow(/callable, nombre\) duplicado/);
    expect(() => r.programadas()).toThrow(/programada duplicado/);
  });
  it('rechaza requiere a sí mismo o repetido', () => {
    expect(rechaza(m('x', { requiere: ['x'] }))).toThrow(/a sí mismo/);
    expect(rechaza(m('x', { requiere: ['y', 'y'] }))).toThrow(/repite/);
  });
  it('rechaza pantallas o acciones en zona nucleo', () => {
    expect(rechaza(m('nucleo', { zona: 'nucleo', pantallas: [pant] }))).toThrow(/nucleo/);
    expect(rechaza(m('nucleo', { zona: 'nucleo', acciones: [acc] }))).toThrow(/nucleo/);
  });
});
