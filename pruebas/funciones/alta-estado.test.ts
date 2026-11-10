// Alta de tenant y estado (`plataforma/operador/alta.ts`): nuevo -> activo; existente conserva; baja y fantasma rechazados.
import { describe, expect, it } from 'vitest';
import type { Tenant } from '@novutienda/nucleo';
import { aplicarAlta, construirTenant, diferenciasTenant, type AlmacenTenant } from '../../plataforma/operador/alta.js';
import { manifiestosEnOrden } from '../../plataforma/registro.js';
import { aplicarPersonal, operadorDe, type AuthOperador } from '../../plataforma/operador/personal.js';
import { DobleDb } from '../limites/doble-db.js';

const manifiestos = manifiestosEnOrden();
const config = { version: 2, plan: 'base', zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'], modulos: ['inventarios', 'pos', 'recibos', 'consola', 'website'] };
const base = (): Tenant => {
  const r = construirTenant(config, manifiestos);
  if (!r.ok) throw new Error(r.error);
  return r.valor;
};

function almacen(actual: unknown, subcolecciones = false) {
  const escritos: Tenant[] = [];
  let consultas = 0;
  const a: AlmacenTenant = {
    leer: () => Promise.resolve(actual),
    escribir: (_id, doc) => {
      escritos.push(doc);
      return Promise.resolve();
    },
    tieneSubcolecciones: () => {
      consultas += 1;
      return Promise.resolve(subcolecciones);
    },
  };
  return { a, escritos, consultas: () => consultas };
}
const alta = (a: AlmacenTenant, aplicar = true) => aplicarAlta({ tenantId: 'demo-x', config, manifiestos, almacen: a, aplicar });

describe('alta y estado', () => {
  it('una suspensión concurrente entre la lectura y la escritura no se pisa: el alta aborta y entrega lo leído como precondición', async () => {
    let doc: Record<string, unknown> = { ...base(), estado: 'activo', plan: 'otro' };
    const previos: unknown[] = [];
    const a: AlmacenTenant = {
      // Tras la lectura, otro proceso suspende el tenant.
      leer: () => {
        const leido = structuredClone(doc);
        doc = { ...doc, estado: 'suspendido' };
        return Promise.resolve(leido);
      },
      // Doble de la transacción de producción: compara el documento actual con la precondición.
      escribir: (_id, nuevo, previo) => {
        previos.push(previo);
        if (JSON.stringify(doc) !== JSON.stringify(previo)) return Promise.reject(new Error('el documento cambió durante el alta: reintente'));
        doc = { ...nuevo };
        return Promise.resolve();
      },
      tieneSubcolecciones: () => Promise.resolve(false),
    };
    await expect(alta(a)).rejects.toThrow(/cambió durante el alta/);
    expect(doc['estado']).toBe('suspendido');
    expect(previos[0]).toMatchObject({ estado: 'activo', plan: 'otro' });
  });

  it('documento nuevo: se crea con estado activo', async () => {
    const m = almacen(null);
    const r = await alta(m.a);
    expect(r.aplicado).toBe(true);
    expect(m.escritos[0]?.estado).toBe('activo');
    expect(m.consultas()).toBe(1);
  });

  it('documento existente: conserva su estado (suspendido) aunque cambie lo demás', async () => {
    const m = almacen({ ...base(), estado: 'suspendido', plan: 'otro' });
    const r = await alta(m.a);
    expect(r.diferencias.some((d) => d.startsWith('estado'))).toBe(false);
    expect(m.escritos[0]?.estado).toBe('suspendido');
    expect(m.consultas()).toBe(0);
  });

  it('documento previo sin estado: se normaliza a activo y lo muestra el diff', async () => {
    const sinEstado: Record<string, unknown> = { ...base() };
    delete sinEstado['estado'];
    const m = almacen(sinEstado);
    const r = await alta(m.a);
    expect(r.diferencias).toEqual(['estado: ausente -> "activo"']);
    expect(m.escritos[0]?.estado).toBe('activo');
  });

  it('documento igual y activo: sin diferencias ni escritura', async () => {
    const m = almacen(base());
    expect(await alta(m.a)).toEqual({ diferencias: [], aplicado: false });
    expect(diferenciasTenant(base(), base())).toEqual([]);
  });

  it('id dado de baja: error, también en verificación, y no escribe', async () => {
    for (const aplicar of [true, false]) {
      const m = almacen({ ...base(), estado: 'baja' });
      await expect(alta(m.a, aplicar)).rejects.toThrow('id dado de baja, no se reutiliza');
      expect(m.escritos).toEqual([]);
    }
  });

  it('estado desconocido en el documento: error', async () => {
    await expect(alta(almacen({ ...base(), estado: 'raro' }).a)).rejects.toThrow(/estado desconocido/);
  });

  it('fantasma (sin documento pero con subcolecciones): error y no escribe', async () => {
    const m = almacen(null, true);
    await expect(alta(m.a)).rejects.toThrow('id con datos previos');
    expect(m.escritos).toEqual([]);
  });

  it('si tieneSubcolecciones falla, el alta falla cerrado', async () => {
    const m = almacen(null);
    const a: AlmacenTenant = { ...m.a, tieneSubcolecciones: () => Promise.reject(new Error('sin red')) };
    await expect(alta(a)).rejects.toThrow('sin red');
    expect(m.escritos).toEqual([]);
  });
});

describe('personal en tenant no activo', () => {
  const auth = { buscarPorCorreo: () => Promise.resolve(null), listarUsuarios: () => Promise.resolve([]) } as unknown as AuthOperador;
  const correr = (db: DobleDb) =>
    aplicarPersonal({
      tenantId: 'demo-x',
      entrada: { cuentas: [{ correo: 'a@example.com', rol: 'adm' }] },
      auth,
      db,
      credenciales: { leer: () => Promise.resolve([]), guardar: () => Promise.reject(new Error('no debe guardar')) },
      aleatorios: (n) => new Uint8Array(n),
      operador: operadorDe('x'),
      aplicar: true,
    });

  it('rechaza suspendido, baja, sin estado y ausente, antes de guardar credenciales', async () => {
    for (const datos of [{ estado: 'suspendido' }, { estado: 'baja' }, {}]) {
      const db = new DobleDb();
      db.poner('tenants/demo-x', datos);
      await expect(correr(db)).rejects.toThrow(/no está activo/);
    }
    await expect(correr(new DobleDb())).rejects.toThrow(/no existe/);
  });
});
