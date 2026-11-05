import { registrarAuditoria } from '@novutienda/nucleo';
import { AccionNoPermitida, ErrorRecibo, ReciboNoEncontrado } from './errores.js';
import { rutaRecibo } from './rutas.js';
import type { ActorAuditado, EjecutorRecibos } from './tipos.js';

const FACTURA = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;

/**
 * Referencia la factura fiscal externa (SUMA) en el comprobante. Es solo una referencia
 * textual: el módulo no factura. Solo `sup` o `adm`; no sobre comprobantes anulados; auditada.
 */
export async function referenciarFacturaSuma(
  ejecutor: EjecutorRecibos,
  p: { tenantId: string; reciboId: string; facturaSuma: string; actor: ActorAuditado },
): Promise<void> {
  if (p.actor.rol === 'caj') throw new AccionNoPermitida('Solo supervisión o administración referencian la factura');
  if (!FACTURA.test(p.facturaSuma)) throw new ErrorRecibo('facturaSuma inválida (hasta 40 caracteres: letras, números y . _ / - espacio)');
  const ruta = rutaRecibo(p.tenantId, p.reciboId);
  await ejecutor.transaccion(async (tx) => {
    const actual = await tx.leer(ruta);
    if (actual === undefined || actual['tenantId'] !== p.tenantId) throw new ReciboNoEncontrado('Comprobante inexistente');
    if (actual['estado'] === 'ANULADO') throw new AccionNoPermitida('El comprobante está anulado');
    tx.actualizar(ruta, { facturaSuma: p.facturaSuma });
    registrarAuditoria(tx, {
      tenantId: p.tenantId, uid: p.actor.uid, rol: p.actor.rol, accion: 'recibos.factura-suma', ruta,
      resumenAntes: { facturaSuma: typeof actual['facturaSuma'] === 'string' ? actual['facturaSuma'] : null },
      resumenDespues: { facturaSuma: p.facturaSuma },
    });
  });
}
