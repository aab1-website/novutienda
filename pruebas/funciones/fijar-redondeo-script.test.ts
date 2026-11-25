// scripts/fijar-redondeo.mjs con dobles: sin nube ni emulador. Cubre argumentos, entorno, --seco y el armado de la llamada a fijarRedondeoDe.
import { describe, expect, it, vi } from 'vitest';
import { OPERADOR_SCRIPT, ejecutar, leerArgumentos, parsearRegla, type DependenciasFijar, type ReglaScript } from '../../scripts/fijar-redondeo.mjs';

const ENV = { GOOGLE_CLOUD_PROJECT: 'demo-prueba', NOVUTIENDA_AMBIENTE: 'emulador', FIRESTORE_EMULATOR_HOST: 'localhost:8080' };
const BASE = ['--tenant', 'tienda-a', '--proyecto', 'demo-prueba'];
const VIGENTES: Record<string, ReglaScript> = { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' } };

function deps(sobre: Partial<DependenciasFijar> = {}) {
  const tx = { marca: 'tx' };
  const fijar = vi.fn(async () => ({ tipo: 'fijado', cambiadas: ['ARS'] }));
  const d: DependenciasFijar = {
    comercialDe: async () => ({ mercados: [{ monedaVenta: 'BOB' }, { monedaVenta: 'ARS' }, { monedaVenta: 'BOB' }] }),
    documentoRedondeo: async () => undefined,
    transaccion: async (fn) => fn(tx),
    fijarRedondeoDe: fijar,
    interpretarRedondeoDe: () => VIGENTES,
    redondear: (m, r) => (r.tipo === 'multiplo' ? Math.round(m / (r.multiplo ?? 1)) * (r.multiplo ?? 1) : Math.round(m * 100) / 100),
    motivoReglaRedondeoInvalida: (r) => ((r as { multiplo?: number }).multiplo === 0 ? 'múltiplo inválido' : null),
    ...sobre,
  };
  return { d, fijar, tx };
}

describe('argumentos', () => {
  it('parsea reglas con modo cercano por omisión y --modo', () => {
    expect(parsearRegla('decimales:1')).toEqual({ tipo: 'decimales', decimales: 1, modo: 'cercano' });
    expect(parsearRegla('multiplo:0,5', 'arriba')).toEqual({ tipo: 'multiplo', multiplo: 0.5, modo: 'arriba' });
    const o = leerArgumentos([...BASE, '--ars', 'multiplo:50', '--modo', 'abajo']);
    expect(o.reglas).toEqual({ ARS: { tipo: 'multiplo', multiplo: 50, modo: 'abajo' } });
    expect(o).toMatchObject({ aplicar: false, uid: OPERADOR_SCRIPT });
  });
  it.each([
    [['--proyecto', 'demo-prueba', '--bob', 'decimales:2']],
    [[...BASE]],
    [[...BASE, '--bob', 'mucho']],
    [[...BASE, '--bob', 'decimales:2', '--modo', 'redondo']],
    [[...BASE, '--bob', 'decimales:2', '--seco', '--aplicar']],
    [[...BASE, '--bob', 'decimales:2', '--otra']],
    [[...BASE, '--bob']],
    [[...BASE, '--bob', 'decimales:2', '--uid', 'con espacio']],
  ])('rechaza %j con código 2', async (args) => {
    const { d, fijar } = deps();
    const r = await ejecutar(args, ENV, d);
    expect(r.codigo).toBe(2);
    expect(fijar).not.toHaveBeenCalled();
  });
  it('rechaza un entorno que no coincide o producción sin confirmar', async () => {
    const { d } = deps();
    expect((await ejecutar(['--tenant', 'a', '--proyecto', 'otro', '--bob', 'decimales:2'], ENV, d)).codigo).toBe(2);
    const prod = { GOOGLE_CLOUD_PROJECT: 'proyecto-produccion', GCP_PROJECT_ID_PROD: 'proyecto-produccion', NOVUTIENDA_AMBIENTE: 'produccion' };
    const r = await ejecutar(['--tenant', 'a', '--proyecto', 'proyecto-produccion', '--bob', 'decimales:2'], prod, d);
    expect(r).toMatchObject({ codigo: 2 });
    expect(r.error).toContain('--confirmar-produccion');
  });
});

describe('--seco (por omisión)', () => {
  it('muestra vigente, nueva y ejemplo, y no escribe', async () => {
    const { d, fijar } = deps();
    const r = await ejecutar([...BASE, '--ars', 'multiplo:50'], ENV, d);
    expect(r.codigo).toBe(0);
    const t = r.salida.join('\n');
    expect(t).toContain('ARS: vigente multiplo:100 (cercano) -> nueva multiplo:50 (cercano)');
    expect(t).toContain('BOB: vigente decimales:2 (cercano) -> nueva decimales:2 (cercano) (sin cambio)');
    expect(t).toContain('ejemplo 1234.567: 1200 -> 1250');
    expect(t).toContain('seco');
    expect(fijar).not.toHaveBeenCalled();
  });
  it('no deja pasar una regla inválida ni una moneda ajena al tenant', async () => {
    const { d } = deps();
    expect((await ejecutar([...BASE, '--ars', 'multiplo:0'], ENV, d)).codigo).toBe(1);
    const solo = deps({ comercialDe: async () => ({ mercados: [{ monedaVenta: 'BOB' }] }) });
    const r = await ejecutar([...BASE, '--ars', 'multiplo:50'], ENV, solo.d);
    expect(r.codigo).toBe(1);
    expect(r.error).toContain('ARS');
  });
});

describe('--aplicar', () => {
  it('arma la llamada: reglas completas, esperadas vigentes, uid y motivo', async () => {
    const { d, fijar, tx } = deps();
    const r = await ejecutar([...BASE, '--ars', 'multiplo:50', '--aplicar', '--uid', 'yo', '--motivo', 'pedido del cliente'], ENV, d);
    expect(r.codigo).toBe(0);
    expect(fijar).toHaveBeenCalledWith(tx, {
      tenantId: 'tienda-a',
      comercial: expect.objectContaining({ mercados: expect.any(Array) }),
      reglas: { BOB: VIGENTES.BOB, ARS: { tipo: 'multiplo', multiplo: 50, modo: 'cercano' } },
      esperadas: VIGENTES,
      uid: 'yo',
      motivo: 'pedido del cliente',
    });
    expect(r.salida.join('\n')).toContain('aplicado en ARS');
  });
  it('usa el uid del operador-script y omite el motivo si no se pasa', async () => {
    const { d, fijar } = deps();
    await ejecutar([...BASE, '--bob', 'decimales:0', '--aplicar'], ENV, d);
    const entrada = (fijar.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(entrada['uid']).toBe('operador-script');
    expect('motivo' in entrada).toBe(false);
  });
  it.each([
    [{ tipo: 'conflicto' }, 1, 'cambiaron'],
    [{ tipo: 'invalido', motivo: 'mal' }, 1, 'mal'],
    [{ tipo: 'sin-cambios' }, 0, 'no se escribió'],
  ])('traduce el resultado %j', async (resultado, codigo, texto) => {
    const { d } = deps({ fijarRedondeoDe: async () => resultado });
    const r = await ejecutar([...BASE, '--bob', 'decimales:1', '--aplicar'], ENV, d);
    expect(r.codigo).toBe(codigo);
    expect(`${r.salida.join('\n')}${r.error ?? ''}`).toContain(texto);
  });
  it('no filtra el id del proyecto de un error de Firebase', async () => {
    const { d } = deps({ transaccion: async () => { throw Object.assign(new Error('proyecto demo-prueba'), { code: 'unavailable' }); } });
    const r = await ejecutar([...BASE, '--bob', 'decimales:1', '--aplicar'], ENV, d);
    expect(r).toMatchObject({ codigo: 3, error: 'error de Firebase (unavailable)' });
  });
});
