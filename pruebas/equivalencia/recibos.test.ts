// (f) Recibo de cada venta de la jornada fija (BOB, USD, ARS): el documento que emite Recibos desde el evento de la venta
// y su vista (HTML imprimible del comprobante), con la función real de `@novutienda/recibos`.
import { renderizarReciboHtml, type Recibo } from '@novutienda/recibos';
import { describe, expect, it } from 'vitest';
import { T, UUID, doc } from '../integracion/entorno.js';
import { compararConFoto, compararConFotoJson } from './foto.js';
import { jornada } from './jornada.js';

describe('recibos de Casa Bermejo', () => {
  it('documento y vista de un recibo por moneda, con totales, pagos y vuelto', async () => {
    const { e } = await jornada();
    const entrega = await e.bandeja.entregar(T);
    expect(entrega.fallidas).toEqual([]);
    const recibos = [1, 2, 3, 4].map((n) => doc(e, T, `recibos/recibo-${UUID(n)}`) as unknown as Recibo);
    expect(recibos.map((r) => [r.moneda, r.total])).toEqual([['BOB', 141035], ['USD', 708], ['ARS', 2290000], ['BOB', 10448]]);
    compararConFotoJson('recibos-documentos.json', recibos);
    for (const r of recibos) compararConFoto(`recibo-${r.numero}-${r.moneda}.html`, `${renderizarReciboHtml(r)}\n`);
  });
});
