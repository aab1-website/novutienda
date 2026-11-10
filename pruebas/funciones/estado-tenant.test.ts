// Ciclo de vida del tenant (`plataforma/operador/estado.ts`) con dobles en memoria: sin red ni emulador.
import { describe, expect, it } from 'vitest';
import type { EstadoTenant, TransaccionIdentidad } from '@novutienda/nucleo';
import { cambiarEstado, type BaseDatosEstado, type TransaccionEstado } from '../../plataforma/operador/estado.js';
import { DobleDb } from '../limites/doble-db.js';

const T = 'demo-x';
const RUTA = `tenants/${T}`;

function montaje(estado?: EstadoTenant | 'raro', opciones: { sinTenant?: boolean; fallaRevocar?: string } = {}) {
  const doble = new DobleDb();
  if (opciones.sinTenant !== true) doble.poner(RUTA, { plan: 'base', ...(estado === undefined ? {} : { estado }) });
  // Adaptador: DobleDb no tiene `update`; se resuelve como `set` conservando los campos previos.
  const db: BaseDatosEstado = {
    runTransaction: (fn) =>
      doble.runTransaction((tx: TransaccionIdentidad) =>
        fn({
          get: tx.get.bind(tx) as unknown as TransaccionEstado['get'],
          update: (ruta, datos) => tx.set(ruta, { ...(doble.dato(ruta) ?? {}), ...datos }),
          create: tx.create.bind(tx),
          nuevoId: tx.nuevoId.bind(tx),
          marcaTiempoServidor: tx.marcaTiempoServidor.bind(tx),
        }),
      ),
  };
  const revocados: string[] = [];
  const auth = {
    revokeRefreshTokens: (uid: string) => {
      if (uid === opciones.fallaRevocar) return Promise.reject(new Error('x'));
      revocados.push(uid);
      return Promise.resolve();
    },
  };
  const miembros = { listarMiembros: () => Promise.resolve(['u1', 'u2']) };
  const correr = (a: EstadoTenant, extra: Partial<Parameters<typeof cambiarEstado>[0]> = {}) =>
    cambiarEstado({ tenantId: T, a, db, miembros, auth, operador: 'script', aplicar: true, ...extra });
  return { doble, revocados, correr };
}

describe('cambiarEstado', () => {
  it('suspende: escribe el estado, audita y revoca las sesiones de los miembros', async () => {
    const m = montaje('activo');
    const r = await m.correr('suspendido');
    expect(r).toMatchObject({ de: 'activo', a: 'suspendido', aplicado: true, revocados: 2 });
    expect(m.doble.dato(RUTA)).toMatchObject({ estado: 'suspendido', plan: 'base' });
    expect(m.revocados).toEqual(['u1', 'u2']);
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([
      expect.objectContaining({ accion: 'tenant.estado', uid: 'operador:script', resumenAntes: { estado: 'activo' }, resumenDespues: { estado: 'suspendido' } }),
    ]);
  });

  it('reactiva sin revocar sesiones', async () => {
    const m = montaje('suspendido');
    const r = await m.correr('activo');
    expect(r).toMatchObject({ aplicado: true, revocados: 0 });
    expect(m.doble.dato(RUTA)).toMatchObject({ estado: 'activo' });
    expect(m.revocados).toEqual([]);
  });

  it('sin aplicar solo informa; no escribe ni revoca ni audita', async () => {
    const m = montaje('activo');
    const r = await m.correr('suspendido', { aplicar: false });
    expect(r).toMatchObject({ aplicado: false, diferencias: ['estado: activo -> suspendido'] });
    expect(m.doble.dato(RUTA)).toMatchObject({ estado: 'activo' });
    expect(m.revocados).toEqual([]);
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([]);
  });

  it('ya en ese estado: activo -> activo no hace nada; sin aplicar tampoco revoca', async () => {
    const m = montaje('activo');
    expect(await m.correr('activo')).toMatchObject({ aplicado: false, diferencias: [] });
    expect((await montaje('suspendido').correr('suspendido', { aplicar: false })).aplicado).toBe(false);
    expect(m.revocados).toEqual([]);
  });

  it('la baja exige confirmar el id textual, revoca y es terminal', async () => {
    const m = montaje('suspendido');
    await expect(m.correr('baja')).rejects.toThrow(/confirmar/);
    await expect(m.correr('baja', { confirmacion: 'otro' })).rejects.toThrow(/confirmar/);
    expect(m.doble.dato(RUTA)).toMatchObject({ estado: 'suspendido' });
    expect(await m.correr('baja', { confirmacion: T })).toMatchObject({ aplicado: true, revocados: 2 });
    await expect(m.correr('activo')).rejects.toThrow(/transición no permitida/);
    await expect(m.correr('suspendido')).rejects.toThrow(/transición no permitida/);
  });

  it('también puede darse de baja un tenant activo, y sin aplicar la confirmación igual se exige', async () => {
    const m = montaje('activo');
    await expect(m.correr('baja', { aplicar: false })).rejects.toThrow(/confirmar/);
    expect(await m.correr('baja', { confirmacion: T })).toMatchObject({ de: 'activo', a: 'baja' });
  });

  it('rechaza tenant inexistente, sin estado o con estado desconocido, y ids o destinos inválidos', async () => {
    await expect(montaje(undefined, { sinTenant: true }).correr('suspendido')).rejects.toThrow(/no existe/);
    await expect(montaje(undefined).correr('suspendido')).rejects.toThrow(/estado válido/);
    await expect(montaje('raro').correr('suspendido')).rejects.toThrow(/estado válido/);
    await expect(montaje('activo').correr('suspendido', { tenantId: 'a/b' })).rejects.toThrow(/identificador/);
    await expect(montaje('activo').correr('otro' as EstadoTenant)).rejects.toThrow(/desconocido/);
  });

  it('si falla la revocación de alguien, el estado ya quedó escrito y el error no nombra uids', async () => {
    const m = montaje('activo', { fallaRevocar: 'u1' });
    const e = await m.correr('suspendido').then(() => new Error('no falló'), (x: unknown) => x as Error);
    expect(e.message).toMatch(/1 de 2/);
    expect(e.message).not.toContain('u1');
    expect(m.doble.dato(RUTA)).toMatchObject({ estado: 'suspendido' });
    expect(m.revocados).toEqual(['u2']);
  });

  it('reintento tras fallo de revocación: con el estado ya escrito revoca de nuevo y devuelve el conteo', async () => {
    const fallida = montaje('suspendido', { fallaRevocar: 'u1' });
    await expect(fallida.correr('suspendido')).rejects.toThrow(/1 de 2/);
    const m = montaje('suspendido');
    expect(await m.correr('suspendido')).toMatchObject({ de: 'suspendido', a: 'suspendido', aplicado: true, revocados: 2 });
    expect(m.revocados).toEqual(['u1', 'u2']);
    expect(m.doble.coleccion(`${RUTA}/auditoria`)).toEqual([]);
    expect(await m.correr('suspendido', { aplicar: false })).toMatchObject({ aplicado: false, revocados: 0 });
  });

  it('los mensajes de error no incluyen el id del tenant', async () => {
    const e = await montaje('suspendido').correr('baja').then(() => new Error('no falló'), (x: unknown) => x as Error);
    expect(e.message).not.toContain(T);
  });
});
