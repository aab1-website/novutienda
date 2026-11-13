// Precio vivo de extremo a extremo con el doble en memoria: Inventarios cambia el precio (el evento sale en la misma transacción),
// el bus lo entrega y la consola corrige la copia `publicado/producto__<id>` sin volver a publicar y agenda UNA reconstrucción.
import { publicarSitio } from '@novutienda/consola';
import { actualizarProducto } from '@novutienda/inventarios';
import type { Actor } from '@novutienda/nucleo';
import { beforeEach, describe, expect, it } from 'vitest';
import { ADM, T, altaProducto, doc, entornoListo, op, producto, type Entorno } from './entorno.js';

const adm: Actor = { uid: 'u-adm', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: { [T]: 'adm' }, v: 1 } } };
let e: Entorno;

const cambiar = (productoId: string, cambios: Parameters<typeof actualizarProducto>[1]['cambios']): Promise<unknown> =>
  e.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('cambio'), por: ADM, productoId, cambios }));
const cambiarPrecio = (productoId: string, bo: number): Promise<unknown> => cambiar(productoId, { precioUSD: { bo, ar: bo } });
const entregar = async (): Promise<void> => {
  const r = await e.bandeja.entregar(T);
  expect(r.fallidas).toEqual([]);
};
const copia = (): Record<string, unknown> | undefined => doc(e, T, 'publicado/producto__tele');
const estadoPub = (): Record<string, unknown> | undefined => doc(e, T, 'publicado/estado');

beforeEach(async () => {
  e = await entornoListo();
  await altaProducto(e, T, producto('tele', { nombre: 'Tele', marca: 'Aurora', precioUSD: { bo: 10000, ar: 10000 } }));
  e.db.poner(`tenants/${T}/sitio/config`, { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {} });
  e.db.poner(`tenants/${T}/sitio/indice`, { secciones: [] });
  e.db.poner(`tenants/${T}/medios/medio-tele-1`, {
    id: 'medio-tele-1', productoId: 'tele', tipo: 'foto', formatoOriginal: 'jpeg', bytesOriginal: 1000, rutaOriginal: 'x', ancho: 1600, alto: 900, creadoEn: 1, por: 'u',
    versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: `tenants/${T}/publico/medios/tele/m1-imagen960.webp`, bytes: 100 }],
  });
  e.db.poner(`tenants/${T}/fichasWeb/tele`, {
    productoId: 'tele', slug: 'tele', descripcion: 'Descripción.', garantia: '12 meses', medios: [{ medioId: 'medio-tele-1', alt: 'Foto' }],
    seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado',
  });
  await entregar(); // asienta los eventos del sembrado
  await publicarSitio(
    { db: e.db, catalogo: e.catalogoConsola, reloj: { ahora: () => e.reloj.ahora }, disparador: e.disparador },
    { tenantId: T, actor: adm },
  );
  expect(e.disparador.programadas).toHaveLength(1); // la publicación agenda su reconstrucción (ventana de 10 minutos)
  e.reloj.ahora += 60_000; // los cambios posteriores ocurren después del corte de la publicación
});

/** Simula que el temporizador ya reconstruyó: no queda hora agendada. */
const sinReconstruccionAgendada = (): void => {
  const est = estadoPub() as { reconstruccion?: Record<string, unknown> };
  e.db.poner(`tenants/${T}/publicado/estado`, { ...est, reconstruccion: { ...est.reconstruccion, programadaPara: null } });
  e.disparador.programadas.length = 0;
};

describe('precio vivo: Inventarios → evento → copia publicada', () => {
  it('con la reconstrucción de la publicación ya agendada, el cambio de precio se agrupa en ella (no agenda otra)', async () => {
    const hora = (estadoPub()?.['reconstruccion'] as { programadaPara: number }).programadaPara;
    await cambiarPrecio('tele', 15000);
    await entregar();
    expect(copia()?.['precioUSD']).toEqual({ bo: 150, ar: 150 });
    expect(e.disparador.programadas).toHaveLength(1); // solo la de la publicación
    expect((estadoPub()?.['reconstruccion'] as { programadaPara: number }).programadaPara).toBe(hora);
  });

  it('un cambio de precio actualiza la copia, sube la versión, agenda la reconstrucción y no cuenta como cambio sin publicar', async () => {
    sinReconstruccionAgendada();
    const versionAntes = estadoPub()?.['version'] as number;
    const cambiosAntes = (doc(e, T, 'sitio/estado')?.['cambios'] as number | undefined) ?? 0;
    await cambiarPrecio('tele', 15000);
    await entregar();
    expect(copia()?.['precioUSD']).toEqual({ bo: 150, ar: 150 });
    expect(estadoPub()?.['version']).toBe(versionAntes + 1);
    expect(doc(e, T, 'publicado/sitio')?.['version']).toBe(versionAntes + 1);
    expect(estadoPub()?.['precioVivoEn']).toBeDefined();
    expect(e.disparador.programadas).toHaveLength(1);
    expect(((doc(e, T, 'sitio/estado')?.['cambios'] as number | undefined) ?? 0)).toBe(cambiosAntes);
  });

  it('tres cambios seguidos programan la reconstrucción una sola vez y la copia queda con el último precio', async () => {
    sinReconstruccionAgendada();
    const versionAntes = estadoPub()?.['version'] as number;
    for (const bo of [11000, 12000, 13000]) {
      await cambiarPrecio('tele', bo);
      await entregar();
    }
    expect(e.disparador.programadas).toHaveLength(1);
    expect(copia()?.['precioUSD']).toEqual({ bo: 130, ar: 130 });
    expect(estadoPub()?.['version']).toBe(versionAntes + 3);
    expect(e.disparador.reconstrucciones).toEqual([]); // la reconstrucción la toma el temporizador, no el consumidor
  });

  it('la reentrega duplicada del evento no vuelve a subir la versión ni a programar', async () => {
    sinReconstruccionAgendada();
    await cambiarPrecio('tele', 15000);
    await entregar();
    const version = estadoPub()?.['version'];
    const r = await e.bandeja.entregar(T, { duplicados: 3 });
    expect(r.fallidas).toEqual([]);
    expect(estadoPub()?.['version']).toBe(version);
    expect(e.disparador.programadas).toHaveLength(1);
  });

  it('desactivar el producto retira la copia y el id de estado.productos', async () => {
    sinReconstruccionAgendada();
    await cambiar('tele', { activo: false });
    await entregar();
    expect(copia()).toBeUndefined();
    expect(estadoPub()?.['productos']).toEqual([]);
    expect((doc(e, T, 'sitio/estado')?.['avisoSitio'] as { motivo?: string } | undefined)?.motivo).toBe('sin_productos');
    expect(e.disparador.programadas).toHaveLength(1);
  });

  it('un cambio de nombre no toca la copia y cuenta como cambio sin publicar', async () => {
    const versionAntes = estadoPub()?.['version'];
    const cambiosAntes = (doc(e, T, 'sitio/estado')?.['cambios'] as number | undefined) ?? 0;
    await cambiar('tele', { nombre: 'Tele 2' });
    await entregar();
    expect(copia()?.['nombre']).toBe('Tele');
    expect(estadoPub()?.['version']).toBe(versionAntes);
    expect(doc(e, T, 'sitio/estado')?.['cambios']).toBe(cambiosAntes + 1);
    expect(e.disparador.programadas).toHaveLength(1); // solo la de la publicación
  });
});
