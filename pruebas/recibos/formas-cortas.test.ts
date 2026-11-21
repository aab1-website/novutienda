import { describe, expect, it } from 'vitest';
import { buscarComprobantes, type LecturaRecibos, type Recibo } from '@novutienda/recibos';

const recibo = (numero: string, emitidoEn: string): Recibo =>
  ({ tenantId: 't1', reciboId: numero, numero, fecha: emitidoEn.slice(0, 10), emitidoEn }) as unknown as Recibo;

const todos = [recibo('A-000006', '2026-11-06T10:00:00Z'), recibo('A-000060', '2026-11-07T10:00:00Z'), recibo('B-000006', '2026-11-08T10:00:00Z')];
const lectura: LecturaRecibos = { consultar: () => Promise.resolve(todos) };
const buscar = async (numero: string): Promise<string[]> => (await buscarComprobantes(lectura, 't1', { numero })).map((r) => r.numero);

describe('búsqueda por formas cortas del número de recibo', () => {
  it.each(['A6', 'A-6', 'a-6', 'A-000006'])('«%s» encuentra A-000006 y solo ese', async (t) => {
    expect(await buscar(t)).toEqual(['A-000006']);
  });
  it('«6» encuentra el 6 de cualquier serie', async () => {
    expect(await buscar('6')).toEqual(['B-000006', 'A-000006']);
  });
  it('un texto que no es número se compara por fragmento', async () => {
    expect(await buscar('A-0000')).toEqual(['A-000060', 'A-000006']);
  });
});
