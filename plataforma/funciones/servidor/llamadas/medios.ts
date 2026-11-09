// Callable `medios`: reserva de subida, finalización (valida bytes, procesa y publica versiones con hash),
// borrado y listado. Va aparte del callable de la consola porque procesar fotos y videos pide más memoria y
// tiempo. Normalmente la finaliza el disparador de Storage; la acción `finalizarSubida` es el camino explícito
// (idempotente) para que el panel espere el resultado.
import { z } from 'zod';
import { borrarMedio, ErrorConsola, finalizarSubida, reservarSubida, type DepsMedios } from '@novutienda/consola';
import { accion, type Contexto, type TablaImplementaciones } from './marco.js';
import { ID_PRODUCTO, LIMITE, objeto } from './comunes.js';

const SUBIDA_ID = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, 'identificador de subida inválido');

export const depsMedios = (c: Pick<Contexto, 'e'>): DepsMedios => ({
  db: c.e.db, almacen: c.e.almacenMedios, procesador: c.e.procesador, catalogo: c.e.catalogo, reloj: { ahora: c.e.ahora },
});

export const accionesMedios: TablaImplementaciones = {
  reservarSubida: accion({
    esquema: objeto({ subidaId: SUBIDA_ID, productoId: ID_PRODUCTO, tipo: z.enum(['foto', 'video']), bytes: z.number().int().positive().max(200 * 1024 * 1024) }),
    ejecutar: (c, d) => reservarSubida(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, subidaId: d.subidaId, productoId: d.productoId, tipo: d.tipo, bytes: d.bytes }),
  }),
  finalizarSubida: accion({
    esquema: objeto({ subidaId: SUBIDA_ID }),
    ejecutar: async (c, d) => ({ medio: await finalizarSubida(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, subidaId: d.subidaId }) }),
  }),
  // Consulta el estado de una subida sin procesarla (el panel la sondea tras subir el original). Lee la reserva con el mismo contrato que
  // `estadoSubida` de la consola (aún no está en este árbol: al integrar feat/fix-negocio puede sustituirse por esa función).
  estadoSubida: accion({
    esquema: objeto({ subidaId: SUBIDA_ID }),
    ejecutar: async (c, d) => {
      const s = (await c.e.firestore.doc(`tenants/${c.tenantId}/subidas/${d.subidaId}`).get()).data();
      if (s === undefined) throw new ErrorConsola('no-encontrado', 'La subida no existe');
      const estado = s['estado'];
      if (estado !== 'reservada' && estado !== 'procesando' && estado !== 'procesada' && estado !== 'borrando' && estado !== 'rechazada') throw new ErrorConsola('estado', 'Registro de subida dañado');
      const medio = estado === 'procesada' ? (await c.e.firestore.doc(`tenants/${c.tenantId}/medios/${d.subidaId}`).get()).data() : undefined;
      return {
        estado: estado === 'procesando' ? 'reservada' : estado, // `procesando` es interno: para el panel sigue siendo «falta procesar»
        ...(medio !== undefined ? { medio: { id: d.subidaId, ...medio } } : {}),
        ...(typeof s['motivo'] === 'string' ? { motivo: s['motivo'] } : {}),
      };
    },
  }),
  borrarMedio: accion({
    esquema: objeto({ medioId: SUBIDA_ID }),
    ejecutar: async (c, d) => {
      await borrarMedio(depsMedios(c), { tenantId: c.tenantId, actor: c.actor, medioId: d.medioId });
      return { ok: true };
    },
  }),
  listarMedios: accion({
    esquema: objeto({ productoId: ID_PRODUCTO, limite: LIMITE.optional() }),
    ejecutar: async (c, d) => ({
      medios: (await c.e.firestore.collection(`tenants/${c.tenantId}/medios`).where('productoId', '==', d.productoId).limit(d.limite ?? 20).get()).docs.map((m) => ({ id: m.id, ...m.data() })),
    }),
  }),
};
