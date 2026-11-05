// Bus de eventos, trabajos programados y piezas de apoyo, con el Entorno real sobre el emulador (en proceso).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { publicarSitio } from '@novutienda/consola';
import { rutaCotizacion, type FetchLike, type SobreEvento } from '@novutienda/nucleo';
import { entregarEvento, sobreDesdeDocumento } from '../../plataforma/funciones/servidor/bus.js';
import { crearEntorno, type Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { crearNotificador } from '../../plataforma/funciones/servidor/notificador.js';
import { crearDisparadorSitio } from '../../plataforma/funciones/servidor/disparador-sitio.js';
import { ejecutarCotizaciones, ejecutarLimpiezaSubidas, ejecutarTemporizadorSitio, horaEnLaPaz, listarTenants } from '../../plataforma/funciones/servidor/programadas.js';
import { procesarObjetoSubido } from '../../plataforma/funciones/servidor/trigger-medios.js';
import { crearUsuario, hayEmulador, herramientas, sembrarTenant, unico, BUCKET, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** 4/11/2026 07:30 en La Paz (11:30 UTC). */
const AHORA = Date.parse('2026-11-04T11:30:00Z');
const fixture = (n: string): string => readFileSync(fileURLToPath(new URL(`../tipo-cambio/fixtures/${n}`, import.meta.url)), 'utf8');

const flujo = (partes: readonly Uint8Array[]) => ({
  getReader: () => {
    let i = 0;
    return { read: () => Promise.resolve(i >= partes.length ? { done: true } : { done: false, value: partes[i++] as Uint8Array }), cancel: () => Promise.resolve() };
  },
});
const falso = (respuestas: Record<string, string>): FetchLike => (url) => {
  const cuerpo = respuestas[url];
  if (cuerpo === undefined) return Promise.reject(new Error('sin red'));
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, body: flujo([new TextEncoder().encode(cuerpo)]) });
};
const FUENTES = {
  'https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php': fixture('bcb-2026-11-04.html'),
  'https://www.bna.com.ar/Personas': fixture('bna-2026-11-04.html'),
  'https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/REF': fixture('bcra-ref-2026-11-03.json'),
};

describe.skipIf(!hayEmulador)('bus de eventos (Firestore del emulador)', () => {
  let h: Herramientas;
  let e: Entorno;
  beforeAll(() => {
    h = herramientas();
    e = crearEntorno({ firestore: h.firestore, auth: h.auth, bucket: h.bucket, ahora: () => AHORA, env: { PLATAFORMA_PRUEBAS: '1' } });
  });

  const evento = (tenantId: string, pedidoId: string, productoId: string, cantidad: number): SobreEvento => ({
    id: `pc-${pedidoId}`, tipo: 'pedido.confirmado', version: 1, tenantId, origen: 'pedidos', ocurridoEn: '2026-11-04T11:00:00Z', claveIdempotencia: `pc-${pedidoId}`,
    datos: {
      pedidoId, mercado: 'AR', moneda: 'ARS', total: 360_000,
      cotizacion: { cotizacionId: 'AR-2026-11-04-1', par: 'ARS/USD', valor: 1200, fecha: '2026-11-04', fuente: 'BNA', estado: 'vigente' },
      lineas: [{ productoId, cantidad }], confirmadoEn: '2026-11-04T11:00:00Z',
    },
  });
  // El documento se arma a mano (como lo dejaría `publicarEvento`) y NO se escribe en `eventos/`: el disparador
  // real del emulador entregaría el evento por su cuenta y volvería no determinista el conteo de la prueba.
  const documento = (ev: SobreEvento): Record<string, unknown> => ({ ...ev, publicadoEn: 'marca-del-servidor' });

  it('entrega a Inventarios una sola vez aunque el evento llegue repetido (al menos una vez)', async () => {
    const t = unico('bus').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'lapiz', nombre: 'Lápiz', precioUSD: { bo: 100, ar: 100 }, tienda: 10 }] });
    const ev = evento(t, 'P1', 'lapiz', 3);
    const doc = documento(ev);
    const a = await entregarEvento(e, t, ev.id, doc);
    expect(a).toEqual({ entregas: 1, aplicadas: 1, sinConsumidor: false });
    const b = await entregarEvento(e, t, ev.id, doc);
    expect(b).toEqual({ entregas: 1, aplicadas: 0, sinConsumidor: false });
    expect((await h.firestore.doc(`tenants/${t}/existencias/lapiz__tienda`).get()).data()?.['cantidad']).toBe(7);
  });

  it('un evento que siempre falla se descarta tras 5 intentos y deja de reintentarse', async () => {
    const t = unico('bus').toLowerCase();
    await sembrarTenant(h, t);
    const ev = evento(t, 'P2', 'no-existe', 1);
    const doc = documento(ev);
    for (let intento = 1; intento <= 4; intento++) await expect(entregarEvento(e, t, ev.id, doc)).rejects.toThrow();
    // El 5.º intento fallido registra el descarte y ya no relanza: Functions deja de reintentar.
    expect(await entregarEvento(e, t, ev.id, doc)).toMatchObject({ aplicadas: 0 });
    expect((await h.firestore.doc(`tenants/${t}/procesados/inventarios~descartado~${ev.id}`).get()).exists).toBe(true);
    expect(await entregarEvento(e, t, ev.id, doc)).toMatchObject({ aplicadas: 0 });
    // El registro de fallos guarda solo el nombre del error, nunca el mensaje ni los datos.
    const fallo = (await h.firestore.doc(`tenants/${t}/procesados/inventarios~fallo~${ev.id}~1`).get()).data();
    expect(fallo).toMatchObject({ error: 'ProductoInactivo' });
    expect(JSON.stringify(fallo)).not.toContain('no-existe');
  });

  it('ignora tipos sin consumidor y sobres inválidos o que no coinciden con su ruta', async () => {
    const t = unico('bus').toLowerCase();
    const sinConsumidor: SobreEvento = { ...evento(t, 'P3', 'x', 1), id: 'tc-1', tipo: 'turno.cerrado', claveIdempotencia: 'tc-1', origen: 'pos', datos: { turnoId: 't', cajaId: 'caja-1', cajeroUid: 'u', monedas: { BOB: { apertura: 0, esperado: 0, contado: 0, diferencia: 0, efectivo: 0, qr: 0, transferencia: 0, credito: 0 } } } };
    expect(await entregarEvento(e, t, 'tc-1', sinConsumidor as never)).toEqual({ entregas: 0, aplicadas: 0, sinConsumidor: true });
    expect(await entregarEvento(e, t, 'x', { basura: true })).toEqual({ entregas: 0, aplicadas: 0, sinConsumidor: false });
    expect(await entregarEvento(e, 'otro-tenant', 'pc-P4', evento(t, 'P4', 'x', 1) as never)).toEqual({ entregas: 0, aplicadas: 0, sinConsumidor: false });
    expect(sobreDesdeDocumento({ ...evento(t, 'P5', 'x', 1), publicadoEn: 'marca' })?.id).toBe('pc-P5');
  });

  it('un evento con datos fuera de contrato se descarta y se registra, sin relanzar ni llegar a los consumidores', async () => {
    const t = unico('bus').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'goma', nombre: 'Goma', precioUSD: { bo: 100, ar: 100 }, tienda: 10 }] });
    const bueno = evento(t, 'P6', 'goma', 2);
    const malo = documento({ ...bueno, datos: { ...(bueno.datos as object), lineas: 'no-es-una-lista' } });
    await expect(entregarEvento(e, t, bueno.id, malo)).resolves.toEqual({ entregas: 0, aplicadas: 0, sinConsumidor: false });
    expect(sobreDesdeDocumento(malo)).toBeUndefined();
    expect((await h.firestore.doc(`tenants/${t}/existencias/goma__tienda`).get()).data()?.['cantidad']).toBe(10);
    const tipoNuevo = documento({ ...bueno, tipo: 'venta.inventada' } as never);
    await expect(entregarEvento(e, t, bueno.id, tipoNuevo)).resolves.toMatchObject({ aplicadas: 0, sinConsumidor: false });
  });
});

describe.skipIf(!hayEmulador)('trabajos programados (Firestore del emulador)', () => {
  let h: Herramientas;
  let e: Entorno;
  beforeAll(() => {
    h = herramientas();
    e = crearEntorno({ firestore: h.firestore, auth: h.auth, bucket: h.bucket, ahora: () => AHORA, env: { PLATAFORMA_PRUEBAS: '1' } });
  });

  it('hora de La Paz y tenants válidos', async () => {
    expect(horaEnLaPaz(AHORA)).toBe(7);
    expect(horaEnLaPaz(Date.parse('2026-11-04T00:30:00Z'))).toBe(20);
    const t = unico('prog').toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set({ plan: 'base' });
    expect(await listarTenants(e)).toContain(t);
  });

  it('cotización: baja BO y AR de las fuentes, escribe por tenant y reconstruye el sitio a las 07:00', async () => {
    const t = unico('cot').toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set({ plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    // Con una publicación previa y sin reconstrucción agendada, la corrida de las 07:00 encola la diaria.
    await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ version: 2, publicadoEn: '2026-11-03T12:00:00.000Z', productos: [], secciones: [], carruseles: [], reconstruccion: { programadaPara: null, ultima: null } });
    const resumen = await ejecutarCotizaciones(e, { fetchFn: falso(FUENTES) });
    const mios = resumen.filter((r) => r.tenantId === t);
    expect(mios.map((r) => `${r.mercado}:${r.accion}`).sort()).toEqual(['AR:escribir', 'BO:escribir']);
    expect((await h.firestore.doc(rutaCotizacion(t, 'BO')).get()).data()).toMatchObject({ valor: 12.06, fuente: 'BCB' });
    expect((await h.firestore.doc(rutaCotizacion(t, 'AR')).get()).data()).toMatchObject({ valor: 1520, fuente: 'BNA' });
    const colas = await h.firestore.collection(`tenants/${t}/reconstrucciones`).get();
    expect(colas.docs.map((d) => d.data())).toEqual([expect.objectContaining({ estado: 'pendiente', motivo: 'diaria', version: 2 })]);
  });

  it('cotización: si las fuentes fallan avisa (documento de alerta + registro) y no inventa un valor', async () => {
    const t = unico('cotf').toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set({ plan: 'base', modulos: {}, zonaHoraria: 'America/La_Paz', monedas: ['BOB', 'USD', 'ARS'] });
    await ejecutarCotizaciones(e, { fetchFn: falso({}) });
    expect((await h.firestore.doc(rutaCotizacion(t, 'BO')).get()).exists).toBe(false);
    const alertas = await h.firestore.collection(`tenants/${t}/alertas`).get();
    const tipos = alertas.docs.map((d) => `${d.data()['tipo'] as string}:${d.data()['mercado'] as string}`).sort();
    expect(tipos).toEqual(['cotizacion_vieja:AR', 'cotizacion_vieja:BO', 'fallas_fuente:AR', 'fallas_fuente:BO']);
    // Una segunda corrida en la misma hora no multiplica los documentos.
    await ejecutarCotizaciones(e, { fetchFn: falso({}) });
    expect((await h.firestore.collection(`tenants/${t}/alertas`).get()).size).toBe(4);
  });

  it('notificador: registra la alerta con severidad de error y es idempotente por hora', async () => {
    const t = unico('not').toLowerCase();
    const n = crearNotificador(h.firestore, t, () => AHORA);
    await n.notificar({ tipo: 'fallas_fuente', mercado: 'BO', detalle: '1 fuente(s) con falla', fallas: ['BCB: red'] });
    await n.notificar({ tipo: 'fallas_fuente', mercado: 'BO', detalle: '1 fuente(s) con falla', fallas: ['BCB: red'] });
    const docs = await h.firestore.collection(`tenants/${t}/alertas`).get();
    expect(docs.size).toBe(1);
    expect(docs.docs[0]?.data()).toMatchObject({ tipo: 'fallas_fuente', mercado: 'BO', atendida: false, fallas: ['BCB: red'] });
  });

  it('disparador del sitio: encola sin duplicar', async () => {
    const t = unico('disp').toLowerCase();
    const d = crearDisparadorSitio(h.firestore, () => AHORA);
    await d.programar(t, AHORA + 600_000);
    await d.programar(t, AHORA + 600_000);
    await d.reconstruir(t, 4, 'publicacion');
    await d.reconstruir(t, 4, 'publicacion');
    const docs = (await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).docs.map((x) => ({ id: x.id, ...x.data() }));
    expect(docs).toHaveLength(2);
    expect(docs.find((x: Record<string, unknown>) => x['estado'] === 'programada')).toMatchObject({ para: AHORA + 600_000 });
    expect(docs.find((x: Record<string, unknown>) => x['estado'] === 'pendiente')).toMatchObject({ version: 4, motivo: 'publicacion', solicitadaEnMs: AHORA });
  });

  it('temporizador del sitio: reconstruye cuando llega la hora agendada y no antes', async () => {
    const t = unico('tmr').toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set({ plan: 'base' });
    await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ version: 5, reconstruccion: { programadaPara: AHORA + 60_000, ultima: null } });
    expect((await ejecutarTemporizadorSitio(e))[t]).toBe('esperar');
    expect((await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).size).toBe(0);
    await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ version: 5, reconstruccion: { programadaPara: AHORA - 1000, ultima: null } });
    expect((await ejecutarTemporizadorSitio(e))[t]).toBe('reconstruir');
    expect((await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).docs[0]?.data()).toMatchObject({ estado: 'pendiente', version: 5 });
  });

  it('limpieza: libera reservas vencidas, devuelve cuota y borra lo subido a medias', async () => {
    const t = unico('lim').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'camara', nombre: 'Cámara', precioUSD: { bo: 100, ar: 100 }, tienda: 0 }] });
    const ruta = `tenants/${t}/privado/originales/camara/subida-vieja-1`;
    await h.bucket.file(ruta).save(Buffer.from('a medias'), { resumable: false });
    await h.firestore.doc(`tenants/${t}/subidas/subida-vieja-1`).set({
      id: 'subida-vieja-1', productoId: 'camara', tipo: 'foto', bytes: 5000, estado: 'reservada', rutaOriginal: ruta, creadaEn: AHORA - 8 * 3_600_000, venceEn: AHORA - 2 * 3_600_000, por: 'u',
    });
    await h.firestore.doc(`tenants/${t}/uso/medios`).set({ bytes: 5000, productos: { camara: { fotos: 1, videos: 0 } } });
    const r = await ejecutarLimpiezaSubidas(e);
    expect(r[t]).toEqual({ vencidas: 1, reintentadas: 0 });
    expect((await h.bucket.file(ruta).exists())[0]).toBe(false);
    expect((await h.firestore.doc(`tenants/${t}/uso/medios`).get()).data()).toMatchObject({ bytes: 0 });
    expect((await h.firestore.doc(`tenants/${t}/subidas/subida-vieja-1`).get()).exists).toBe(false);
  });

  it('disparador de Storage: ignora rutas ajenas, reservas inexistentes y usuarios deshabilitados', async () => {
    const t = unico('trg').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'camara', nombre: 'Cámara', precioUSD: { bo: 100, ar: 100 }, tienda: 0 }] });
    expect(await procesarObjetoSubido(e, BUCKET, `tenants/${t}/publico/medios/camara/x.webp`)).toBe('ignorada');
    expect(await procesarObjetoSubido(e, 'otro-bucket', `tenants/${t}/privado/originales/camara/subida-0001`)).toBe('ignorada');
    expect(await procesarObjetoSubido(e, BUCKET, `tenants/${t}/privado/recibos/r.pdf`)).toBe('ignorada');
    expect(await procesarObjetoSubido(e, BUCKET, `tenants/${t}/privado/originales/camara/subida-0002`)).toBe('sin-reserva');
    const u = await crearUsuario(h, { rol: 'sup', tenant: t });
    await h.firestore.doc(`tenants/${t}/subidas/subida-0003`).set({ id: 'subida-0003', productoId: 'camara', tipo: 'foto', bytes: 10, estado: 'reservada', por: u.uid });
    await h.auth.updateUser(u.uid, { disabled: true });
    expect(await procesarObjetoSubido(e, BUCKET, `tenants/${t}/privado/originales/camara/subida-0003`)).toBe('sin-usuario');
    await h.firestore.doc(`tenants/${t}/subidas/subida-0004`).set({ id: 'subida-0004', productoId: 'camara', tipo: 'foto', bytes: 10, estado: 'reservada', por: 'uid-que-no-existe' });
    expect(await procesarObjetoSubido(e, BUCKET, `tenants/${t}/privado/originales/camara/subida-0004`)).toBe('sin-usuario');
  });

  it('publicar: el sitio agenda la reconstrucción en la cola real', async () => {
    const t = unico('pub').toLowerCase();
    await sembrarTenant(h, t, { productos: [{ id: 'lapiz', nombre: 'Lápiz', precioUSD: { bo: 100, ar: 100 }, tienda: 2 }] });
    await h.firestore.doc(`tenants/${t}/sitio/config`).set({ plantillaActiva: 'cielo', whatsappNovuchat: '59170000000', medicion: {} });
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const actor = { uid: adm.uid, claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [t]: 'adm' }, v: 1 } } };
    const r = await publicarSitio({ db: e.db, catalogo: e.catalogo, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, { tenantId: t, actor });
    expect(r.decision.accion).toBe('programar');
    const docs = (await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).docs.map((d) => d.data());
    expect(docs).toEqual([expect.objectContaining({ estado: 'programada', para: AHORA + 600_000 })]);
  });
});
