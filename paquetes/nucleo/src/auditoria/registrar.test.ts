import { describe, expect, it } from 'vitest';
import { registrarAuditoria, type EntradaAuditoria, type TransaccionAuditoria } from './registrar.js';

function crearTx() {
  const creados: { ruta: string; datos: Record<string, unknown> }[] = [];
  const tx: TransaccionAuditoria = {
    create: (ruta, datos) => void creados.push({ ruta, datos: { ...datos } }),
    nuevoId: () => 'aud1',
    marcaTiempoServidor: () => 'MARCA_SERVIDOR',
  };
  return { tx, creados };
}

const base: EntradaAuditoria = { tenantId: 't1', uid: 'u1', rol: 'adm', accion: 'producto.precio', ruta: 'tenants/t1/productos/p1' };

describe('registrarAuditoria', () => {
  it('escribe con create en la ruta del tenant y marca de tiempo del servidor', () => {
    const { tx, creados } = crearTx();
    const id = registrarAuditoria(tx, { ...base, resumenAntes: { precio: 100 }, resumenDespues: { precio: 120 }, motivo: 'ajuste' });
    expect(id).toBe('aud1');
    expect(creados).toHaveLength(1);
    expect(creados[0]?.ruta).toBe('tenants/t1/auditoria/aud1');
    expect(creados[0]?.datos).toMatchObject({ uid: 'u1', rol: 'adm', en: 'MARCA_SERVIDOR', resumenDespues: { precio: 120 }, motivo: 'ajuste' });
  });

  it('omite los campos opcionales ausentes', () => {
    const { tx, creados } = crearTx();
    registrarAuditoria(tx, base);
    expect(Object.keys(creados[0]?.datos ?? {})).not.toContain('motivo');
    expect(Object.keys(creados[0]?.datos ?? {})).not.toContain('resumenAntes');
  });

  it('la interfaz de transacción no ofrece update ni delete (inmutable)', () => {
    const { tx } = crearTx();
    // @ts-expect-error la interfaz no expone update
    expect(tx.update).toBeUndefined();
    // @ts-expect-error la interfaz no expone delete
    expect(tx.delete).toBeUndefined();
    // @ts-expect-error la interfaz no expone set
    expect(tx.set).toBeUndefined();
  });

  it('solo invoca create sobre la transacción', () => {
    const llamadas: string[] = [];
    const tx = new Proxy({} as TransaccionAuditoria, {
      get: (_o, p) => {
        llamadas.push(String(p));
        return p === 'nuevoId' ? () => 'x1' : p === 'marcaTiempoServidor' ? () => 'm' : () => undefined;
      },
    });
    registrarAuditoria(tx, base);
    expect(new Set(llamadas)).toEqual(new Set(['nuevoId', 'marcaTiempoServidor', 'create']));
  });

  it.each(['pin', 'password', 'token', 'accessToken', 'API_KEY', 'contraseña', 'email', 'telefono'])('rechaza la clave prohibida %s', (clave) => {
    const { tx, creados } = crearTx();
    expect(() => registrarAuditoria(tx, { ...base, resumenDespues: { [clave]: 'x' } })).toThrow(/prohibida/);
    expect(creados).toHaveLength(0);
  });

  it('rechaza claves prohibidas anidadas y en arreglos', () => {
    const { tx } = crearTx();
    expect(() => registrarAuditoria(tx, { ...base, resumenAntes: { a: { b: [{ Password: 'x' }] } } })).toThrow(/prohibida/);
  });

  it('no confunde claves legítimas que contienen "pin"', () => {
    const { tx, creados } = crearTx();
    registrarAuditoria(tx, { ...base, resumenAntes: { mapping: 1, stock: 3 } });
    expect(creados).toHaveLength(1);
  });

  it('rechaza profundidad excesiva', () => {
    const { tx } = crearTx();
    const hondo = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(() => registrarAuditoria(tx, { ...base, resumenAntes: hondo })).toThrow(/profundidad/);
  });

  it('rechaza entradas inválidas', () => {
    const { tx, creados } = crearTx();
    expect(() => registrarAuditoria(tx, { ...base, tenantId: 't1/../x' })).toThrow(/tenantId/);
    expect(() => registrarAuditoria(tx, { ...base, uid: '' })).toThrow(/uid/);
    expect(() => registrarAuditoria(tx, { ...base, rol: 'root' as never })).toThrow(/rol/);
    expect(() => registrarAuditoria(tx, { ...base, motivo: ' ' })).toThrow(/motivo/);
    expect(creados).toHaveLength(0);
  });

  it('rechaza un id de documento inseguro', () => {
    const tx: TransaccionAuditoria = { create: () => undefined, nuevoId: () => 'a/b', marcaTiempoServidor: () => 1 };
    expect(() => registrarAuditoria(tx, base)).toThrow(/id/);
  });
});
