// Callable `medios`: reserva de subida, finalización (valida bytes, procesa y publica versiones con hash),
// borrado y listado. Va aparte del callable de la consola porque procesar fotos y videos pide más memoria y
// tiempo. Normalmente la finaliza el disparador de Storage; la acción `finalizarSubida` es el camino explícito
// (idempotente) para que el panel espere el resultado.
import { z } from 'zod';
import { borrarMedio, finalizarSubida, reservarSubida, type DepsMedios } from '@novutienda/consola';
import { accion, type Contexto, type TablaAcciones } from './marco.js';
import { ID_PRODUCTO, LIMITE, objeto } from './comunes.js';

const SUPERVISION = ['sup', 'adm'] as const;
const SUBIDA_ID = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, 'identificador de subida inválido');

export const depsMedios = (c: Pick<Contexto, 'e'>): DepsMedios => ({
  db: c.e.db, almacen: c.e.almacenMedios, procesador: c.e.procesador, catalogo: c.e.catalogo, reloj: { ahora: c.e.ahora },
});

export const accionesMedios: TablaAcciones = {
  reservarSubida: accion({
    roles: SUPERVISION,
    esquema: objeto({ subidaId: SUBIDA_ID, productoId: ID_PRODUCTO, tipo: z.enum(['foto', 'video']), bytes: z.number().int().positive().max(200 * 1024 * 1024) }),
    ejecutar: (c, d) => reservarSubida(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, subidaId: d.subidaId, productoId: d.productoId, tipo: d.tipo, bytes: d.bytes }),
  }),
  finalizarSubida: accion({
    roles: SUPERVISION,
    esquema: objeto({ subidaId: SUBIDA_ID }),
    ejecutar: async (c, d) => ({ medio: await finalizarSubida(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, subidaId: d.subidaId }) }),
  }),
  borrarMedio: accion({
    roles: SUPERVISION,
    esquema: objeto({ medioId: SUBIDA_ID }),
    ejecutar: async (c, d) => {
      await borrarMedio(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, medioId: d.medioId });
      return { ok: true };
    },
  }),
  listarMedios: accion({
    roles: SUPERVISION,
    esquema: objeto({ productoId: ID_PRODUCTO, limite: LIMITE.optional() }),
    ejecutar: async (c, d) => ({
      medios: (await c.e.firestore.collection(`tenants/${c.tenantId}/medios`).where('productoId', '==', d.productoId).limit(d.limite ?? 20).get()).docs.map((m) => ({ id: m.id, ...m.data() })),
    }),
  }),
};

