import { describe, expect, it } from 'vitest';
import type { SobreEvento } from '../contratos/sobre-evento.js';
import { consumir, publicarEvento, type EjecutorTransacciones, type TransaccionBandeja } from './bandeja.js';
import { CONTRATOS_V1, validarEvento } from './contratos.js';
import { fixturesPedidoConfirmadoV1, validarPedidoConfirmadoV1 } from './pedido-confirmado.v1.js';
import { fixturesPedidoSolicitadoV1, validarPedidoSolicitadoV1 } from './pedido-solicitado.v1.js';
import { fixturesReciboEmitidoV1, validarReciboEmitidoV1 } from './recibo-emitido.v1.js';
import { fixturesStockBajoV1, validarStockBajoV1 } from './stock-bajo.v1.js';
import { fixturesStockCambiadoV1, validarStockCambiadoV1 } from './stock-cambiado.v1.js';
import { fixturesTurnoCerradoV1, validarTurnoCerradoV1 } from './turno-cerrado.v1.js';
import { fixturesVentaAnuladaV1, validarVentaAnuladaV1 } from './venta-anulada.v1.js';
import { fixturesVentaConfirmadaV1, validarVentaConfirmadaV1 } from './venta-confirmada.v1.js';

const contratos = [
  ['venta.confirmada', validarVentaConfirmadaV1, fixturesVentaConfirmadaV1],
  ['venta.anulada', validarVentaAnuladaV1, fixturesVentaAnuladaV1],
  ['turno.cerrado', validarTurnoCerradoV1, fixturesTurnoCerradoV1],
  ['stock.cambiado', validarStockCambiadoV1, fixturesStockCambiadoV1],
  ['stock.bajo', validarStockBajoV1, fixturesStockBajoV1],
  ['recibo.emitido', validarReciboEmitidoV1, fixturesReciboEmitidoV1],
  ['pedido.solicitado', validarPedidoSolicitadoV1, fixturesPedidoSolicitadoV1],
  ['pedido.confirmado', validarPedidoConfirmadoV1, fixturesPedidoConfirmadoV1],
] as const;

describe.each(contratos)('contrato %s v1', (tipo, validar, fixtures) => {
  it('está registrado', () => expect(CONTRATOS_V1[tipo]).toBe(validar));
  it.each(fixtures.validos.map((d, i) => [i, d] as const))('acepta el fixture válido %i', (_i, datos) => {
    expect(validar(datos).ok).toBe(true);
  });
  it.each(fixtures.invalidos.map((f) => [f.nombre, f.datos] as const))('rechaza el fixture inválido: %s', (_n, datos) => {
    expect(validar(datos).ok).toBe(false);
  });
  it('cada contrato tiene fixtures inválidos', () => expect(fixtures.invalidos.length).toBeGreaterThan(0));
});

const sobre = (parcial: Partial<SobreEvento> = {}): SobreEvento => ({
  id: 'e1',
  tipo: 'venta.anulada',
  version: 1,
  tenantId: 't1',
  origen: 'pos',
  ocurridoEn: '2026-11-04T12:00:00Z',
  claveIdempotencia: 'k1',
  datos: fixturesVentaAnuladaV1.validos[0],
  ...parcial,
});

describe('validarEvento', () => {
  it('acepta un evento completo válido', () => expect(validarEvento(sobre()).ok).toBe(true));
  it('rechaza una versión desconocida', () => {
    const r = validarEvento({ ...sobre(), version: 2 });
    expect(r).toEqual({ ok: false, error: 'Versión de evento desconocida' });
  });
  it('rechaza un tipo desconocido, incluso heredado del prototipo', () => {
    expect(validarEvento(sobre({ tipo: 'venta.inventada' })).ok).toBe(false);
    expect(validarEvento(sobre({ tipo: 'constructor' })).ok).toBe(false);
  });
  it('rechaza datos inválidos para el tipo', () => {
    expect(validarEvento(sobre({ datos: { ventaId: 'v1' } })).ok).toBe(false);
  });
  it('rechaza un sobre mal formado', () => {
    expect(validarEvento(null).ok).toBe(false);
    expect(validarEvento({ ...sobre(), id: '' }).ok).toBe(false);
  });
});

/** Base en memoria con semántica de create (falla si existe) y confirmación al terminar. */
function crearBase() {
  const docs = new Map<string, Record<string, unknown>>();
  const ejecutor: EjecutorTransacciones = {
    async transaccion(fn) {
      const pendientes = new Map<string, Record<string, unknown>>();
      const tx: TransaccionBandeja = {
        create(ruta, datos) {
          if (docs.has(ruta) || pendientes.has(ruta)) throw new Error('ya existe');
          pendientes.set(ruta, { ...datos });
        },
        existe: (ruta) => Promise.resolve(docs.has(ruta) || pendientes.has(ruta)),
        marcaTiempoServidor: () => 'MARCA',
      };
      const r = await fn(tx);
      for (const [k, v] of pendientes) docs.set(k, v);
      return r;
    },
  };
  return { docs, ejecutor };
}

describe('publicarEvento', () => {
  it('escribe en tenants/{t}/eventos/{id} dentro de la transacción', async () => {
    const { docs, ejecutor } = crearBase();
    await ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, sobre())));
    expect(docs.get('tenants/t1/eventos/e1')).toMatchObject({ tipo: 'venta.anulada', publicadoEn: 'MARCA' });
  });
  it('no escribe nada si el evento es inválido', async () => {
    const { docs, ejecutor } = crearBase();
    await expect(ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, sobre({ datos: {} }))))).rejects.toThrow();
    expect(docs.size).toBe(0);
  });
  it('rechaza una versión desconocida', async () => {
    const { ejecutor } = crearBase();
    const malo = { ...sobre(), version: 2 } as unknown as SobreEvento;
    await expect(ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, malo)))).rejects.toThrow(/Versión/);
  });
  it('rechaza ids con caracteres de ruta', async () => {
    const { ejecutor } = crearBase();
    await expect(ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, sobre({ id: 'a/b' }))))).rejects.toThrow(/id/);
  });
  it('un id duplicado falla (create)', async () => {
    const { ejecutor } = crearBase();
    await ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, sobre())));
    await expect(ejecutor.transaccion((tx) => Promise.resolve(publicarEvento(tx, sobre())))).rejects.toThrow('ya existe');
  });
});

describe('consumir', () => {
  it('procesa una entrega duplicada una sola vez', async () => {
    const { docs, ejecutor } = crearBase();
    let efectos = 0;
    const manejador = () => {
      efectos++;
      return Promise.resolve();
    };
    const primera = await consumir(ejecutor, { consumidor: 'recibos', evento: sobre(), manejador });
    const segunda = await consumir(ejecutor, { consumidor: 'recibos', evento: sobre(), manejador });
    expect([primera, segunda]).toEqual([true, false]);
    expect(efectos).toBe(1);
    expect(docs.get('tenants/t1/procesados/recibos_e1')).toMatchObject({ consumidor: 'recibos', eventoId: 'e1' });
  });
  it('cada consumidor procesa el mismo evento una vez', async () => {
    const { ejecutor } = crearBase();
    let efectos = 0;
    const manejador = () => {
      efectos++;
      return Promise.resolve();
    };
    await consumir(ejecutor, { consumidor: 'a', evento: sobre(), manejador });
    await consumir(ejecutor, { consumidor: 'b', evento: sobre(), manejador });
    expect(efectos).toBe(2);
  });
  it('si el manejador falla no se registra el procesado y puede reintentarse', async () => {
    const { docs, ejecutor } = crearBase();
    await expect(
      consumir(ejecutor, { consumidor: 'a', evento: sobre(), manejador: () => Promise.reject(new Error('falla')) }),
    ).rejects.toThrow('falla');
    expect(docs.size).toBe(0);
    expect(await consumir(ejecutor, { consumidor: 'a', evento: sobre(), manejador: () => Promise.resolve() })).toBe(true);
  });
  it('rechaza una versión desconocida sin abrir transacción', async () => {
    const { ejecutor } = crearBase();
    const malo = { ...sobre(), version: 2 } as unknown as SobreEvento;
    await expect(consumir(ejecutor, { consumidor: 'a', evento: malo, manejador: () => Promise.resolve() })).rejects.toThrow(/Versión/);
  });
});
