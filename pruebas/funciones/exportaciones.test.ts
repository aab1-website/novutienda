// Lo que exporta `servidor/index.ts` (lo que Firebase despliega) frente al registro: los nombres siguen estáticos en el código,
// pero deben coincidir con lo que declaran los manifiestos. Se lee el texto de index.ts (importarlo arrancaría la app de Firebase).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { horarioDe, tablaDeCallable } from '../../plataforma/coordinador/encendido.js';
import { accion } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { VACIO } from '../../plataforma/funciones/servidor/llamadas/comunes.js';
import { registroPlataforma } from '../../plataforma/registro.js';
import { IMPLEMENTACIONES, tablasCompuestas } from './tablas.js';

const codigo = readFileSync(fileURLToPath(new URL('../../plataforma/funciones/servidor/index.ts', import.meta.url)), 'utf8');
const exportadas = (disparador: string): string[] => [...codigo.matchAll(new RegExp(`export const (\\w+) = ${disparador}\\(`, 'g'))].map((x) => x[1] as string).sort();
const ordenados = (l: readonly string[]): string[] => [...new Set(l)].sort();

describe('exportaciones de las Functions frente al registro', () => {
  it('los callables exportados son exactamente los `callable` del registro', () => {
    expect(exportadas('onCall')).toEqual(ordenados(registroPlataforma.acciones().map((a) => a.callable)));
  });

  it('las programadas exportadas son exactamente las del registro, y toman su horario de él', () => {
    expect(exportadas('onSchedule')).toEqual(ordenados(registroPlataforma.programadas().map((p) => p.id)));
    for (const id of exportadas('onSchedule')) expect(codigo, id).toContain(`horarioDe('${id}')`);
    for (const p of registroPlataforma.programadas()) expect(horarioDe(p.id)).toEqual({ schedule: p.horario, timeZone: p.zonaHoraria });
  });

  it('api, eventos y subidaFinalizada son infraestructura fija y no salen del registro', () => {
    expect(exportadas('onRequest')).toEqual(['api']);
    expect(exportadas('onDocumentCreated')).toEqual(['eventos']);
    expect(exportadas('onObjectFinalized')).toEqual(['subidaFinalizada']);
  });

  it('no hay otras exportaciones de disparadores', () => {
    const todas = [...codigo.matchAll(/^export const (\w+) = (on\w+)\(/gm)].map((x) => x[1] as string).sort();
    expect(todas).toEqual(ordenados([...exportadas('onCall'), ...exportadas('onSchedule'), 'api', 'eventos', 'subidaFinalizada']));
  });

  it('los bordes reales y el registro coinciden: cada callable compone sin sobrar ni faltar acciones', () => {
    const tablas = tablasCompuestas();
    expect(Object.keys(tablas).sort()).toEqual(Object.keys(IMPLEMENTACIONES).sort());
    for (const [callable, t] of Object.entries(tablas)) {
      const declaradas = registroPlataforma.acciones().filter((a) => a.callable === callable).map((a) => a.nombre).sort();
      expect(Object.keys(t).sort(), callable).toEqual(declaradas);
    }
  });
});

describe('tablaDeCallable', () => {
  const impl = (): ReturnType<typeof accion> => accion({ esquema: VACIO, ejecutar: async () => ({}) });
  const fuente = (acciones: { nombre: string; roles: ('caj' | 'sup' | 'adm')[]; propietario?: boolean }[]) => ({
    acciones: () => acciones.map((a) => ({ callable: 'x', modulo: 'm', ...a })),
    programadas: () => [],
  }) as unknown as Parameters<typeof tablaDeCallable>[2];

  it('une roles y propietario del registro con la implementación', () => {
    const t = tablaDeCallable('x', { a: impl(), b: impl() }, fuente([{ nombre: 'a', roles: ['adm'], propietario: true }, { nombre: 'b', roles: ['sup', 'adm'] }]));
    expect(t['a']).toMatchObject({ roles: ['adm'], propietario: true });
    expect(t['b']).toMatchObject({ roles: ['sup', 'adm'], propietario: false });
  });

  it('lanza si el registro declara una acción sin implementación', () => {
    expect(() => tablaDeCallable('x', { a: impl() }, fuente([{ nombre: 'a', roles: ['adm'] }, { nombre: 'b', roles: ['adm'] }]))).toThrow(/sin implementación: b/);
  });

  it('lanza si hay una implementación que ningún manifiesto declara (sin permisos no hay acción)', () => {
    expect(() => tablaDeCallable('x', { a: impl(), z: impl() }, fuente([{ nombre: 'a', roles: ['adm'] }]))).toThrow(/sin declarar en el manifiesto: z/);
  });

  it('un callable sin acciones declaradas ni implementaciones queda vacío', () => {
    expect(tablaDeCallable('y', {}, fuente([]))).toEqual({});
  });

  it('horarioDe lanza si la programada no está declarada', () => {
    expect(() => horarioDe('inexistente')).toThrow(/no está declarada/);
  });
});
