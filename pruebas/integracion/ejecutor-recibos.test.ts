// `ejecutorRecibosDesde` sobre el doble de base que impone las reglas de Firestore (lecturas antes de escribir):
// `enviarRecibo` actualiza el comprobante en una transacción NUEVA, sin leerlo antes, y no debe fallar.
import { describe, expect, it } from 'vitest';
import { enviarRecibo, referenciarFacturaSuma, rutaRecibo, type EnviadorRecibo, type Recibo } from '@novutienda/recibos';
import { ejecutorRecibosDesde } from '../../plataforma/adaptadores/index.js';
import { DobleDb } from './doble-db.js';

const T = 'casa-bermejo';
const RECIBO: Partial<Recibo> & Record<string, unknown> = {
  reciboId: 'recibo-v1', tenantId: T, ventaId: 'v1', numero: 'A-000001', estado: 'EMITIDO', fecha: '2026-11-04', emitidoEn: '2026-11-04T15:00:00.000Z',
  moneda: 'BOB', total: 5568, cotizacion: null, lineas: [], pagos: [], cliente: { nombre: 'Ana', telefono: '70012345' },
  plantilla: { negocio: { nombre: 'Negocio' } }, envioWhatsapp: { estado: 'no_enviado' },
};
const enviador: EnviadorRecibo = { enviar: () => Promise.resolve({ estado: 'enlace_generado', enlace: 'https://wa.me/59170012345' }) };
const actor = { uid: 'u1', rol: 'caj' } as const;

describe('ejecutorRecibosDesde', () => {
  it('enviarRecibo actualiza el envío sin leer antes en esa transacción y deja la auditoría', async () => {
    const db = new DobleDb();
    db.poner(rutaRecibo(T, 'recibo-v1'), RECIBO as never);
    const r = await enviarRecibo(ejecutorRecibosDesde(db), enviador, { tenantId: T, reciboId: 'recibo-v1', actor, enlacePdf: 'https://x.test/a.pdf', ahora: () => '2026-11-04T16:00:00.000Z' });
    expect(r.estado).toBe('enlace_generado');
    const guardado = db.dato(rutaRecibo(T, 'recibo-v1')) as unknown as Recibo;
    expect(guardado.envioWhatsapp).toEqual({ estado: 'enlace_generado', actualizadoEn: '2026-11-04T16:00:00.000Z' });
    expect(guardado.numero).toBe('A-000001');
    expect(db.coleccion(`tenants/${T}/auditoria`).length).toBeGreaterThan(0);
  });
  it('referenciarFacturaSuma mezcla sobre el documento sin perder campos', async () => {
    const db = new DobleDb();
    db.poner(rutaRecibo(T, 'recibo-v1'), RECIBO as never);
    await referenciarFacturaSuma(ejecutorRecibosDesde(db), { tenantId: T, reciboId: 'recibo-v1', facturaSuma: 'F-123', actor: { uid: 'u2', rol: 'sup' } });
    const guardado = db.dato(rutaRecibo(T, 'recibo-v1')) as unknown as Recibo;
    expect(guardado.facturaSuma).toBe('F-123');
    expect(guardado.cliente?.nombre).toBe('Ana');
  });
  it('actualizar un documento inexistente falla y no escribe nada', async () => {
    const db = new DobleDb();
    await expect(
      ejecutorRecibosDesde(db).transaccion((tx) => {
        tx.actualizar(rutaRecibo(T, 'no-existe'), { a: 1 });
        return Promise.resolve();
      }),
    ).rejects.toThrow(/existente/);
    expect(db.docs.size).toBe(0);
  });
  it('varias actualizaciones del mismo documento se componen en orden', async () => {
    const db = new DobleDb();
    db.poner(rutaRecibo(T, 'recibo-v1'), { a: 1, b: 1 });
    await ejecutorRecibosDesde(db).transaccion((tx) => {
      tx.actualizar(rutaRecibo(T, 'recibo-v1'), { b: 2 });
      tx.actualizar(rutaRecibo(T, 'recibo-v1'), { c: 3 });
      return Promise.resolve();
    });
    expect(db.dato(rutaRecibo(T, 'recibo-v1'))).toEqual({ a: 1, b: 2, c: 3 });
  });
});
