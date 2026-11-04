// Endpoints firmados para la reconstrucción del sitio (los llamará GitHub Actions; la reconstrucción real en CI
// es de otra ola). Contrato en docs/produccion/reconstruccion-sitio.md.
//   GET  /api/sitio/v1/reconstrucciones?tenantId=T[&estado=pendiente]   → trabajos encolados
//   POST /api/sitio/v1/reconstrucciones/{id}/estado  {tenantId, estado}  → en_curso | completada | fallida
//   GET  /api/sitio/v1/publicado?tenantId=T                            → copia publicada (`publicado/`) y `redondeo`
//        (política de `tenants/T/config/redondeo`; la reconstrucción la inyecta en `config.redondeo` del contenido del sitio)
// Firma: `X-Marca-Tiempo` (ms Unix) y `X-Firma` = HMAC-SHA256 hex de `{marca}.{MÉTODO}\n{url con consulta}\n{cuerpo}`
// con el secreto SITIO_RECONSTRUCCION_SECRETO; ventana de 5 minutos.
import { verificarFirma } from '@novutienda/inventarios';
import { esTenantIdValido } from '@novutienda/nucleo';
import type { Entorno } from '../entorno.js';
import { json, type PeticionHttp, type RespuestaApi } from './tipos.js';

const ESTADOS = ['pendiente', 'en_curso', 'completada', 'fallida'] as const;
type Estado = (typeof ESTADOS)[number];
/** Transiciones permitidas: cada trabajo avanza una vez y no retrocede. */
const SIGUIENTE: Readonly<Record<Estado, readonly Estado[]>> = {
  pendiente: ['en_curso'], en_curso: ['completada', 'fallida'], completada: [], fallida: [],
};
const ID_TRABAJO = /^[A-Za-z0-9._-]{3,120}$/;

/** Texto exacto que se firma. */
export const textoFirmado = (metodo: string, url: string, cuerpo: string): string => `${metodo.toUpperCase()}\n${url}\n${cuerpo}`;

export function firmaValida(req: PeticionHttp, secreto: string, ahoraMs: number): boolean {
  return verificarFirma({
    secreto, marcaTiempo: req.cabeceras['x-marca-tiempo'] ?? '', firma: req.cabeceras['x-firma'] ?? '',
    cuerpo: textoFirmado(req.metodo, req.url, req.cuerpoCrudo), ahoraMs,
  }).ok;
}

export async function manejarSitio(e: Entorno, req: PeticionHttp, secreto: string): Promise<RespuestaApi> {
  if (secreto === '') return json(503, { error: 'no_configurado' });
  if (!firmaValida(req, secreto, e.ahora())) return json(401, { error: 'firma_invalida' });
  const tenantId = (req.metodo === 'GET' ? req.consulta['tenantId'] : (req.cuerpo as { tenantId?: unknown } | null)?.tenantId) as unknown;
  if (!esTenantIdValido(tenantId)) return json(400, { error: 'tenant_invalido' });
  const base = `tenants/${tenantId}`;

  if (req.ruta === '/api/sitio/v1/reconstrucciones' && req.metodo === 'GET') {
    const estado = req.consulta['estado'] ?? 'pendiente';
    if (!(ESTADOS as readonly string[]).includes(estado)) return json(400, { error: 'estado_invalido' });
    const snap = await e.firestore.collection(`${base}/reconstrucciones`).where('estado', '==', estado).orderBy('solicitadaEnMs', 'asc').limit(20).get();
    return json(200, { trabajos: snap.docs.map((d) => ({ id: d.id, estado: d.data()['estado'], version: d.data()['version'], motivo: d.data()['motivo'], solicitadaEnMs: d.data()['solicitadaEnMs'] })) });
  }

  const m = /^\/api\/sitio\/v1\/reconstrucciones\/([^/]+)\/estado$/.exec(req.ruta);
  if (m?.[1] !== undefined && req.metodo === 'POST') {
    const id = m[1];
    const nuevo = (req.cuerpo as { estado?: unknown } | null)?.estado;
    if (!ID_TRABAJO.test(id) || typeof nuevo !== 'string' || !(ESTADOS as readonly string[]).includes(nuevo)) return json(400, { error: 'entrada_invalida' });
    const ref = e.firestore.doc(`${base}/reconstrucciones/${id}`);
    return e.db.firestore.runTransaction(async (tx) => {
      const d = (await tx.get(ref)).data();
      if (d === undefined) return json(404, { error: 'no_encontrado' });
      const actual = d['estado'] as Estado;
      if (actual === nuevo) return json(200, { id, estado: actual, repetido: true });
      if (!(SIGUIENTE[actual] ?? []).includes(nuevo as Estado)) return json(409, { error: 'transicion_invalida', desde: actual, hacia: nuevo });
      tx.update(ref, { estado: nuevo, [`${nuevo}EnMs`]: e.ahora() });
      return json(200, { id, estado: nuevo });
    });
  }

  if (req.ruta === '/api/sitio/v1/publicado' && req.metodo === 'GET') {
    const snap = await e.firestore.collection(`${base}/publicado`).get();
    // La política de redondeo vive en la configuración del tenant (no en `publicado/`): se entrega aparte para que
    // la reconstrucción la inyecte en el contenido y el sitio redondee igual que el POS y la API de NovuChat.
    return json(200, { documentos: Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])), redondeo: await e.redondeo(tenantId) });
  }
  return json(404, { error: 'no_encontrado' });
}
