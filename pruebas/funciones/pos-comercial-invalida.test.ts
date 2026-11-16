// `ComercialInvalida` lanzada desde `depsPos` en las acciones de la caja (sin emulador): el callable responde
// failed-precondition «comercial-invalida» con mensaje genérico, igual que en consola; nunca como error interno.
import { describe, expect, it } from 'vitest';
import { construirClaim } from '@novutienda/nucleo';
import { ComercialInvalida } from '../../plataforma/coordinador/comercial.js';
import { crearEntorno } from '../../plataforma/funciones/servidor/entorno.js';
import { crearManejador } from '../../plataforma/funciones/servidor/llamadas/marco.js';
import { tablasCompuestas } from './tablas.js';
import { TENANT_TODO_ENCENDIDO } from './ayudas.js';

const T = 'tienda-uno';
const UUID = '00000000-0000-4000-8000-000000000001';
const DATOS: Record<string, unknown> = {
  abrirTurno: { turnoId: UUID, apertura: { BOB: 0 } },
  confirmarVenta: { requestId: UUID, carrito: {}, pagos: [{}] },
  solicitarAprobacion: { aprobacionId: UUID, solicitud: {} },
};

function manejador(motivo: 'invalido' | 'inexistente') {
  const docs: Record<string, unknown> = { [`tenants/${T}`]: TENANT_TODO_ENCENDIDO };
  const f = { doc: (ruta: string) => ({ get: async () => ({ exists: Object.hasOwn(docs, ruta), data: () => docs[ruta] }) }), collection: () => ({ listDocuments: async () => [] }) };
  const claim = construirClaim({ [T]: 'caj' }, 1, false);
  if (!claim.ok) throw new Error(claim.error);
  const auth = { verifyIdToken: async () => ({ uid: 'u1', email_verified: true, firebase: { sign_in_provider: 'password' }, ...claim.valor }) };
  const e = crearEntorno({ firestore: f as never, auth: auth as never, bucket: {} as never, ahora: () => 1_000, env: {} });
  const entorno = { ...e, depsPos: async () => { throw new ComercialInvalida(motivo); } };
  return crearManejador({ modulo: 'pos', acciones: tablasCompuestas()['pos'] ?? {}, entorno: () => entorno, appCheckExigido: () => true });
}

describe('pos ante ComercialInvalida lanzada desde depsPos (sin emulador)', () => {
  it.each(['invalido', 'inexistente'] as const)('(%s) abrirTurno, confirmarVenta y solicitarAprobacion → failed-precondition comercial-invalida', async (motivo) => {
    for (const [nombre, datos] of Object.entries(DATOS)) {
      const peticion = { data: { accion: nombre, tenantId: T, datos }, rawRequest: { headers: { authorization: 'Bearer x' } }, app: {} } as never;
      const error = await manejador(motivo)(peticion).then(() => undefined, (x: unknown) => x as { code: string; message: string; details?: { codigo?: string } });
      expect(error, nombre).toMatchObject({ code: 'failed-precondition', details: { codigo: 'comercial-invalida' } });
      expect(error?.message).toMatch(/configuración comercial/i);
      expect(error?.message).not.toContain(T);
    }
  });
});
