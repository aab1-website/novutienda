// Callable `recibos`: plantilla, archivo de comprobantes, referencia de la factura SUMA, vista, PDF y envío por
// WhatsApp (enlace `wa.me` que la persona envía; el envío automático se cotiza aparte). El vendedor solo ve y
// envía los comprobantes de SUS ventas: el comprobante no guarda quién vendió, así que se cruza con la venta.
import { HttpsError } from 'firebase-functions/v2/https';
import { z } from 'zod';
import {
  buscarComprobantes, EnviadorWaMe, enviarRecibo, generarPdfRecibo, guardarPlantilla, plantillaVigente, referenciarFacturaSuma,
  renderizarReciboHtml, rutaPlantilla, rutaRecibo, type Recibo,
} from '@plataforma/recibos';
import { accion, actorPos, type Contexto, type TablaAcciones } from './marco.js';
import { ID, LIMITE, OBJETO, VACIO, objeto } from './comunes.js';

const TODOS = ['caj', 'sup', 'adm'] as const;
const SUPERVISION = ['sup', 'adm'] as const;
const RECIBO_ID = ID;
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function leerRecibo(c: Contexto, reciboId: string): Promise<Recibo> {
  const doc = (await c.e.firestore.doc(rutaRecibo(c.tenantId, reciboId)).get()).data();
  if (doc === undefined || doc['tenantId'] !== c.tenantId) throw new HttpsError('not-found', 'El comprobante no existe.');
  const recibo = doc as unknown as Recibo;
  if (c.rol === 'caj') {
    const venta = (await c.e.firestore.doc(`tenants/${c.tenantId}/ventas/${recibo.ventaId}`).get()).data();
    if (venta?.['cajeroUid'] !== c.sesion.uid) throw new HttpsError('permission-denied', 'Solo puede ver los comprobantes de sus ventas.');
  }
  return recibo;
}

export const accionesRecibos: TablaAcciones = {
  leerPlantilla: accion({
    roles: TODOS,
    esquema: VACIO,
    ejecutar: async (c) => ({ plantilla: plantillaVigente((await c.e.firestore.doc(rutaPlantilla(c.tenantId)).get()).data()) }),
  }),
  guardarPlantilla: accion({
    roles: SUPERVISION,
    esquema: objeto({ plantilla: OBJETO }),
    ejecutar: async (c, d) => {
      await guardarPlantilla(c.e.ejecutorRecibos, { tenantId: c.tenantId, actor: actorPos(c), plantilla: d.plantilla });
      return { ok: true };
    },
  }),
  buscarComprobantes: accion({
    roles: TODOS,
    esquema: objeto({ numero: z.string().min(1).max(30).optional(), desde: FECHA.optional(), hasta: FECHA.optional(), cliente: z.string().min(1).max(100).optional(), limite: LIMITE.optional() }),
    ejecutar: async (c, d) => {
      const consulta = {
        ...(d.numero !== undefined ? { numero: d.numero } : {}), ...(d.desde !== undefined ? { desde: d.desde } : {}),
        ...(d.hasta !== undefined ? { hasta: d.hasta } : {}), ...(d.cliente !== undefined ? { cliente: d.cliente } : {}),
        limite: d.limite ?? 50,
      };
      const recibos = await buscarComprobantes(c.e.lecturaRecibos, c.tenantId, consulta);
      if (c.rol !== 'caj') return { recibos };
      // Vendedor: solo los comprobantes de sus ventas.
      if (recibos.length === 0) return { recibos };
      const ventas = await c.e.firestore.getAll(...recibos.map((r) => c.e.firestore.doc(`tenants/${c.tenantId}/ventas/${r.ventaId}`)), { fieldMask: ['cajeroUid'] });
      const mias = new Set(ventas.filter((v) => v.get('cajeroUid') === c.sesion.uid).map((v) => v.id));
      return { recibos: recibos.filter((r) => mias.has(r.ventaId)) };
    },
  }),
  leerRecibo: accion({
    roles: TODOS,
    esquema: objeto({ reciboId: RECIBO_ID }),
    ejecutar: async (c, d) => ({ recibo: await leerRecibo(c, d.reciboId) }),
  }),
  referenciarFacturaSuma: accion({
    roles: SUPERVISION,
    esquema: objeto({ reciboId: RECIBO_ID, facturaSuma: z.string().min(1).max(40) }),
    ejecutar: async (c, d) => {
      await referenciarFacturaSuma(c.e.ejecutorRecibos, { tenantId: c.tenantId, reciboId: d.reciboId, facturaSuma: d.facturaSuma, actor: actorPos(c) });
      return { ok: true };
    },
  }),
  htmlRecibo: accion({
    roles: TODOS,
    esquema: objeto({ reciboId: RECIBO_ID }),
    ejecutar: async (c, d) => ({ html: renderizarReciboHtml(await leerRecibo(c, d.reciboId)) }),
  }),
  /** PDF generado en el servidor (texto escapado), en base64. */
  pdfRecibo: accion({
    roles: TODOS,
    esquema: objeto({ reciboId: RECIBO_ID }),
    ejecutar: async (c, d) => ({ pdfBase64: Buffer.from(generarPdfRecibo(await leerRecibo(c, d.reciboId))).toString('base64') }),
  }),
  /** Genera el PDF, lo guarda en una ruta privada y devuelve el enlace `wa.me` para que la persona lo envíe. */
  enviarRecibo: accion({
    roles: TODOS,
    esquema: objeto({ reciboId: RECIBO_ID, codigoPais: z.string().regex(/^\d{1,3}$/).optional() }),
    ejecutar: async (c, d) => {
      const recibo = await leerRecibo(c, d.reciboId);
      const enlacePdf = await c.e.emisorEnlacePdf.publicar(c.tenantId, d.reciboId, generarPdfRecibo(recibo));
      return enviarRecibo(c.e.ejecutorRecibos, new EnviadorWaMe(d.codigoPais ?? '591'), {
        tenantId: c.tenantId, reciboId: d.reciboId, actor: actorPos(c), enlacePdf, ahora: () => new Date(c.e.ahora()).toISOString(),
      });
    },
  }),
};
