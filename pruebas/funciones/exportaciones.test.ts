// Lo que exporta `servidor/index.ts` (lo que Firebase despliega) frente al registro: los nombres siguen estáticos en el código,
// pero deben coincidir con lo que declaran los manifiestos. Se lee el texto de index.ts (importarlo arrancaría la app de Firebase).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { PARAMETROS } from '../../plataforma/funciones/servidor/config.js';
import { constructorSitioEsGoogle, entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { avisoConstruccionSitio, construirSitio, INVOCADORES_TAREA_SITIO } from '../../plataforma/funciones/servidor/funciones-sitio.js';
import { horarioDe, tablaDeCallable } from '../../plataforma/coordinador/encendido.js';
import { accion } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { VACIO } from '../../plataforma/funciones/servidor/llamadas/comunes.js';
import { registroPlataforma } from '../../plataforma/registro.js';
import { IMPLEMENTACIONES, tablasCompuestas } from './tablas.js';

vi.mock('../../plataforma/funciones/servidor/entorno.js', async (original) => ({ ...(await original<object>()), entorno: vi.fn(() => { throw new Error('no debe usarse en modo github'); }) }));

const codigo = readFileSync(fileURLToPath(new URL('../../plataforma/funciones/servidor/index.ts', import.meta.url)), 'utf8');
const entornoFuente = readFileSync(fileURLToPath(new URL('../../plataforma/funciones/servidor/entorno.ts', import.meta.url)), 'utf8');
const funcionesSitio = readFileSync(fileURLToPath(new URL('../../plataforma/funciones/servidor/funciones-sitio.ts', import.meta.url)), 'utf8');
const exportadas = (disparador: string): string[] => [...codigo.matchAll(new RegExp(`export const (\\w+) = ${disparador}\\(`, 'g'))].map((x) => x[1] as string).sort();
const ordenados = (l: readonly string[]): string[] => [...new Set(l)].sort();

describe('exportaciones de las Functions frente al registro', () => {
  it('los callables exportados son los `callable` del registro más `activarInvitaciones`', () => {
    // `activarInvitaciones` es un callable propio sin tenant ni rol (la persona aún no tiene rol): no es una acción del registro.
    // Su manejador exige App Check, token vigente y correo verificado, y tiene límite por uid.
    expect(exportadas('onCall')).toEqual(ordenados([...registroPlataforma.acciones().map((a) => a.callable), 'activarInvitaciones']));
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

  it('la construcción del sitio (DR-CB) se exporta desde index.ts, con cuenta propia y el invocador de las dos cuentas', () => {
    expect(exportadas('onTaskDispatched')).toEqual([]); // las dos salen por re-exportación, no por `export const` en index.ts
    expect(codigo).toMatch(/^export \{ avisoConstruccionSitio, construirSitio \} from '\.\/funciones-sitio\.js';$/m);
    expect(funcionesSitio).toMatch(/export const construirSitio = onTaskDispatched\(/);
    expect(funcionesSitio).toMatch(/export const avisoConstruccionSitio = onMessagePublished\(/);
    expect(funcionesSitio).toContain("topic: 'cloud-builds'");
    // Ambas con la cuenta de CUENTA_FN_CONSTRUCTOR_SITIO.
    expect(funcionesSitio.match(/serviceAccount: PARAMETROS\.cuentaFnConstructor/g)).toHaveLength(2);
    expect(PARAMETROS.cuentaFnConstructor.name).toBe('CUENTA_FN_CONSTRUCTOR_SITIO');
    // Invocador: exactamente la cuenta general y la del constructor, en formato `nombre@`, y ya no `private`.
    expect(INVOCADORES_TAREA_SITIO).toEqual(['novutienda-funciones@', 'fn-constructor-sitio@']);
    expect(funcionesSitio).toContain('invoker: INVOCADORES_TAREA_SITIO');
    expect(funcionesSitio).not.toContain("invoker: 'private'");
    expect(entornoFuente).toContain("export const FUNCION_TAREA_SITIO = 'construirSitio'");
  });

  it('en modo github las dos funciones salen antes de hacer nada: no tocan el entorno', async () => {
    expect(constructorSitioEsGoogle()).toBe(false);
    const entornoMock = vi.mocked(entorno);
    await construirSitio.run({ data: { tenantId: 't', para: 1 } } as never);
    await avisoConstruccionSitio.run({ data: { message: { json: { buildId: 'x' } } } } as never);
    expect(entornoMock).not.toHaveBeenCalled();
  });

  it('el temporizador, con la cuenta general, no lanza builds: delega en la cola de construirSitio', () => {
    expect(codigo).toContain('construccionDeLaInstancia(e, true)');
    expect(entornoFuente).toContain('encolarLanzamiento:');
    expect(entornoFuente).not.toContain('ConstruccionEncolada');
    expect(codigo).not.toContain('ConstruccionEncolada');
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
