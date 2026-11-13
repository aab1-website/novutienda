// Contrato de punta a punta «la consola publica → GET /api/sitio/v1/publicado → contenidoDesdePublicado → contenido del sitio».
// Todo con la salida REAL de `publicarSitio` (sobre el catálogo real de Inventarios) y el endpoint firmado real del emulador;
// el mapeo se alcanza por `plataforma/registro.ts`. Tenant y datos sintéticos. Lo que hoy es una incoherencia entre lo que la
// consola acepta y lo que el sitio exige se afirma tal cual está HOY y se marca con `INCOHERENCIA S2`; lo ya corregido (S2-1, S7-1, S7-2)
// afirma el comportamiento nuevo con un comentario «S2-1: …» / «S7-1: …». Ya no quedan incoherencias S7: el precio y la baja de un producto
// publicado llegan a la copia por el evento `producto.cambiado`, entregado aquí por el bus real (`entregarEvento`).
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { publicarSitio } from '@novutienda/consola';
import { actualizarProducto, crearProducto, ingresar, type Autor } from '@novutienda/inventarios';
import { entregarEvento } from '../../plataforma/funciones/servidor/bus.js';
import { contenidoDesdePublicado } from '../../plataforma/registro.js';
import { crearEntorno, type Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { accion, crearUsuario, firmar, hayEmulador, herramientas, http, sembrarTenant, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const secretoSitio = process.env['SITIO_RECONSTRUCCION_SECRETO'] ?? '';
const ADM: Autor = { uid: 'sembrador', rol: 'adm' };
const AHORA = Date.parse('2026-11-04T11:30:00Z');
const MEDIOS = 'https://medios.ejemplo.invalid';
const ENTORNO_BASE = { origen: 'https://tienda.ejemplo.invalid', origenMedios: MEDIOS, appCheck: null, recaptchaSiteKey: null } as const;

/** Negocio sintético (en producción sale de `tenants/<t>`; aquí no hay cliente). */
const negocio = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nombre: 'Tienda de Prueba', lema: 'Lema de prueba', logo: null, whatsappTienda: null, telefono: null, correo: null,
  direccion: 'Calle Ficticia 123', horario: null, mercados: ['BO', 'AR'], mercadoInicial: 'BO', enlacesPermitidos: ['ejemplo.invalid'],
  portada: {
    insignia: 'PRUEBA', titulo: ['UNO', 'DOS ', 'TRES.'], texto: 'Texto de prueba.', textoBotonCatalogo: 'VER CATÁLOGO', textoBotonConsulta: 'CONSULTAR',
  },
  beneficios: [
    { icono: 'check', titulo: { texto: 'UNO', confirmada: true }, descripcion: 'Descripción uno.' },
    { icono: 'tendencia', titulo: { texto: 'DOS', confirmada: true }, descripcion: 'Descripción dos.' },
    { icono: 'usuario', titulo: { texto: 'TRES', confirmada: true }, descripcion: 'Descripción tres.' },
    { icono: 'mensaje', titulo: { texto: 'CUATRO', confirmada: true }, descripcion: 'Descripción cuatro.' },
  ],
  identidad: {
    etiqueta: 'IDENTIDAD', titulo: 'HISTORIA', texto: 'Texto de identidad de prueba.', foto: null,
    cifra: { valor: { texto: 'Más de 10', confirmada: true }, detalle: 'CLIENTES' },
    valores: [{ icono: 'escudo', titulo: 'Confianza', texto: 'Texto uno.' }, { icono: 'camion', titulo: 'Entregas', texto: 'Texto dos.' }],
    sello: { texto: 'SELLO DE PRUEBA.', confirmada: true },
  },
  textoPrivacidad: ['Texto de privacidad de prueba.'], categorias: {}, destacados: [],
  ...extra,
});

interface Spec {
  readonly id: string;
  readonly nombre?: string;
  readonly marca?: string | null;
  readonly categoria?: string;
  /** Centavos de USD, como los guarda Inventarios. */
  readonly precio?: { bo: number; ar: number };
  readonly garantiaMeses?: number;
  readonly activo?: boolean;
  readonly publicado?: boolean;
  /** `null` = sin ficha. */
  readonly ficha?: 'publicado' | 'borrador' | 'oculto' | null;
  /** Ids de medio de la ficha (se siembran como fotos procesadas). */
  readonly fotos?: readonly string[];
  readonly slug?: string;
  readonly seo?: { titulo: string; descripcion: string };
  readonly descripcion?: string;
  readonly garantia?: string;
}

const idMedio = (n: string): string => `med${n}`.padEnd(10, 'x');

describe.skipIf(!hayEmulador)('contrato consola → /publicado → contenido del sitio (emulador)', () => {
  let h: Herramientas;
  let e: Entorno;
  const token = randomBytes(24).toString('hex');
  const actor = { uid: 'adm-sintetico', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: {} as Record<string, string>, v: 1 } } };

  beforeAll(() => {
    h = herramientas();
    e = crearEntorno({ firestore: h.firestore, auth: h.auth, bucket: h.bucket, ahora: () => AHORA, env: { PLATAFORMA_PRUEBAS: '1' } });
  });

  const nuevoTenant = async (): Promise<string> => {
    const t = unico('contrato').toLowerCase();
    await sembrarTenant(h, t);
    await h.firestore.doc(`tenants/${t}/sitio/config`).set({ plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {} });
    await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: [] });
    return t;
  };

  /** Foto procesada con versiones 480/960 (webp) como las deja el procesador de medios. */
  const sembrarMedio = async (t: string, productoId: string, medioId: string): Promise<void> => {
    const ruta = (lado: number): string => `tenants/${t}/publico/medios/${productoId}/${medioId}-imagen${String(lado)}.webp`;
    await h.firestore.doc(`tenants/${t}/medios/${medioId}`).set({
      id: medioId, productoId, tipo: 'foto', formatoOriginal: 'jpeg', bytesOriginal: 1000, rutaOriginal: `tenants/${t}/privado/originales/${productoId}/s`,
      ancho: 1600, alto: 900, creadoEn: AHORA, por: 'u',
      versiones: [480, 960].map((lado) => ({ clase: 'imagen', lado, formato: 'webp', ruta: ruta(lado), bytes: 100 })),
    });
  };

  const sembrarProducto = async (t: string, s: Spec): Promise<void> => {
    await h.db.runTransaction((tx) =>
      crearProducto(tx, {
        tenantId: t, operacionId: unico('prod'), por: ADM,
        producto: {
          id: s.id, nombre: s.nombre ?? `Producto ${s.id}`, categoria: s.categoria ?? 'televisores', sku: `SKU-${s.id}`,
          ...(s.marca === null ? {} : { marca: s.marca ?? 'Marca de Prueba' }),
          precioUSD: s.precio ?? { bo: 12345, ar: 6789 },
          ...(s.garantiaMeses !== undefined ? { garantiaMeses: s.garantiaMeses } : {}),
          activo: s.activo ?? true, publicado: s.publicado ?? true,
        },
      }),
    );
    await h.db.runTransaction((tx) =>
      ingresar(tx, { tenantId: t, operacionId: unico('ing'), por: { uid: 'sembrador', rol: 'sup' }, ubicacionId: 'tienda', lineas: [{ productoId: s.id, cantidad: 3 }] }),
    );
    const fotos = s.fotos ?? [idMedio(`${s.id.slice(-4)}a`)];
    for (const m of fotos) await sembrarMedio(t, s.id, m);
    if (s.ficha !== null) {
      await h.firestore.doc(`tenants/${t}/fichasWeb/${s.id}`).set({
        productoId: s.id, slug: s.slug ?? `slug-${s.id}`, descripcion: s.descripcion ?? `Descripción de ${s.id}.`, garantia: s.garantia ?? '12 meses',
        medios: fotos.map((medioId, i) => ({ medioId, alt: `Foto ${String(i + 1)} de ${s.id}` })),
        seo: s.seo ?? { titulo: `SEO ${s.id}`, descripcion: `Descripción SEO de ${s.id}` }, estado: s.ficha ?? 'publicado',
      });
    }
  };

  const publicar = (t: string) =>
    publicarSitio({ db: e.db, catalogo: e.catalogo, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, {
      tenantId: t, actor: { ...actor, claims: { ...actor.claims, pl: { t: { [t]: 'adm' }, v: 1 } } },
    });

  /** Entrega por el bus real todos los `producto.cambiado` del tenant (idempotente: lo ya consumido no se repite). */
  const entregarCambios = async (t: string): Promise<void> => {
    const docs = (await h.firestore.collection(`tenants/${t}/eventos`).where('tipo', '==', 'producto.cambiado').get()).docs;
    for (const d of docs) await entregarEvento(e, t, d.id, d.data());
  };
  const cambiosSinPublicar = async (t: string): Promise<number> =>
    ((await h.firestore.doc(`tenants/${t}/sitio/estado`).get()).data()?.['cambios'] as number | undefined) ?? 0;

  const estadoPublicado = async (t: string): Promise<{ version: number; productos: string[]; reconstruccion?: { programadaPara?: number | null } }> =>
    (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number; productos: string[]; reconstruccion?: { programadaPara?: number | null } };
  const aviso = async (t: string): Promise<{ motivo: string; en: string } | undefined> =>
    (await h.firestore.doc(`tenants/${t}/sitio/estado`).get()).data()?.['avisoSitio'] as { motivo: string; en: string } | undefined;
  const desactivar = (t: string, id: string): Promise<unknown> =>
    h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: id, cambios: { activo: false } }));
  const reactivar = (t: string, id: string): Promise<unknown> =>
    h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: id, cambios: { activo: true } }));
  /** Tablero de la consola por su callable real (HTTP del emulador de Functions). */
  const tableroPorCallable = async (t: string): Promise<{ avisoSitio: { motivo: string; en: string } | null; cambiosSinPublicar: number }> => {
    const u = await crearUsuario(h, { rol: 'adm', tenant: t });
    const r = await accion('consola', 'tablero', {}, u.token, t);
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    return r.resultado as { avisoSitio: { motivo: string; en: string } | null; cambiosSinPublicar: number };
  };
  /** Simula que el temporizador ya reconstruyó: sin hora agendada y sin trabajos `prog-` pendientes. */
  const simularTemporizadorReconstruyo = async (t: string): Promise<void> => {
    const est = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { reconstruccion?: Record<string, unknown> };
    await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ ...est, reconstruccion: { ...est.reconstruccion, programadaPara: null } });
    for (const d of (await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).docs) if (d.id.startsWith('prog-')) await d.ref.delete();
  };
  const trabajosProg = async (t: string): Promise<string[]> =>
    (await h.firestore.collection(`tenants/${t}/reconstrucciones`).get()).docs.map((d) => d.id).filter((id) => id.startsWith('prog-'));

  const leerPublicado = async (t: string): Promise<{ documentos: Record<string, Record<string, unknown>>; redondeo: unknown }> => {
    const ruta = `/api/sitio/v1/publicado?tenantId=${t}`;
    const marca = String(Date.now());
    const r = await http(ruta, { headers: { 'x-marca-tiempo': marca, 'x-firma': firmar(secretoSitio, marca, `GET\n${ruta}\n`) } });
    expect(r.status, r.texto).toBe(200);
    return r.cuerpo as { documentos: Record<string, Record<string, unknown>>; redondeo: unknown };
  };

  const mapear = (resp: unknown, neg: unknown = negocio(), disponibilidad: Record<string, boolean> = {}) =>
    contenidoDesdePublicado(resp, neg, { ...ENTORNO_BASE, disponibilidad });
  const mensajeDeError = (fn: () => unknown): string => {
    try { fn(); } catch (err) { expect((err as Error).name).toBe('ErrorContenidoPublicado'); return (err as Error).message; }
    return '';
  };

  it('camino feliz: lo cargado en la consola llega íntegro al contenido del sitio, con precios en unidades y secciones en orden', async () => {
    const t = await nuevoTenant();
    await sembrarProducto(t, {
      id: 'tv-uno', nombre: 'Televisor Uno', marca: 'Aurora', categoria: 'televisores', precio: { bo: 12345, ar: 6789 }, garantiaMeses: 12,
      slug: 'televisor-uno', descripcion: 'Descripción del televisor uno.', garantia: '12 meses de garantía', seo: { titulo: 'SEO Uno', descripcion: 'Descripción SEO uno' },
      fotos: [idMedio('uno1'), idMedio('uno2')],
    });
    await sembrarProducto(t, { id: 'aire-dos', nombre: 'Aire Dos', marca: 'Lumina', categoria: 'aires', precio: { bo: 50000, ar: 51050 } });
    await sembrarMedio(t, 'secciones', idMedio('sec1'));
    await sembrarMedio(t, 'secciones', idMedio('sec2'));
    await h.firestore.doc(`tenants/${t}/secciones/segunda`).set({ id: 'segunda', titulo: 'Segunda', visible: true, bloques: [
      { tipo: 'texto', titulo: 'Título', parrafos: ['Párrafo uno', 'Párrafo dos'] },
      { tipo: 'enlaces', items: [{ texto: 'Ir', url: 'https://ejemplo.invalid/x' }] },
    ] });
    await h.firestore.doc(`tenants/${t}/secciones/primera`).set({ id: 'primera', titulo: 'Primera', visible: true, bloques: [
      { tipo: 'imagen', medioId: idMedio('sec1'), alt: 'Imagen de sección' },
      { tipo: 'carrusel', items: [{ medioId: idMedio('sec1'), alt: 'A' }, { medioId: idMedio('sec2'), alt: 'B' }] },
    ] });
    await h.firestore.doc(`tenants/${t}/secciones/oculta`).set({ id: 'oculta', titulo: 'Oculta', visible: false, bloques: [{ tipo: 'texto', parrafos: ['no se ve'] }] });
    await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: ['segunda', 'oculta', 'primera'] });

    const r = await publicar(t);
    expect(r).toMatchObject({ version: 1, productos: 2, advertencias: [] });
    const resp = await leerPublicado(t);
    // Unidad: Inventarios guarda centavos; lo publicado va en unidades de USD.
    expect(resp.documentos['producto__tv-uno']).toMatchObject({ precioUSD: { bo: 123.45, ar: 67.89 }, garantiaMeses: 12 });

    const c = mapear(resp, negocio(), { 'tv-uno': true });
    const tv = c.productos.find((p) => p.id === 'tv-uno')!;
    expect(tv).toMatchObject({
      nombre: 'Televisor Uno', marca: 'Aurora', categoria: 'televisores', slug: 'televisor-uno', descripcion: 'Descripción del televisor uno.',
      garantia: '12 meses de garantía', precioUsd: { BO: 123.45, AR: 67.89 }, disponible: true, seo: { titulo: 'SEO Uno', descripcion: 'Descripción SEO uno' },
    });
    expect(tv.fotos.map((f) => f.alt)).toEqual(['Foto 1 de tv-uno', 'Foto 2 de tv-uno']);
    expect(tv.fotos[0]!.url).toBe(`${MEDIOS}/tenants/${t}/publico/medios/tv-uno/${idMedio('uno1')}-imagen960.webp`);
    expect(tv.fotos[0]!.versiones?.map((v) => v.ancho)).toEqual([480, 960]);
    expect(c.productos.find((p) => p.id === 'aire-dos')).toMatchObject({ precioUsd: { BO: 500, AR: 510.5 }, disponible: false });
    expect(c.marcas).toEqual(['Aurora', 'Lumina']);
    expect(c.categorias.map((k) => k.id)).toEqual(['aires', 'televisores']);
    expect(c.config).toMatchObject({ plantilla: 'bosque', whatsappNovuchat: '59170000000', esEjemplo: false });
    // Orden del menú = orden del índice de la consola; la sección oculta no se publica.
    expect(c.secciones.map((s) => [s.slug, s.orden, s.titulo])).toEqual([['segunda', 0, 'Segunda'], ['primera', 1, 'Primera']]);
    expect(c.secciones[0]!.bloques).toEqual([
      { tipo: 'texto', titulo: 'Título', parrafos: ['Párrafo uno', 'Párrafo dos'] },
      { tipo: 'enlaces', items: [{ texto: 'Ir', url: 'https://ejemplo.invalid/x' }] },
    ]);
    expect(c.secciones[1]!.bloques[0]).toMatchObject({ tipo: 'imagen', foto: { alt: 'Imagen de sección' } });
    expect(c.secciones[1]!.bloques[1]).toMatchObject({ tipo: 'carrusel', fotos: [{ alt: 'A' }, { alt: 'B' }] });
    expect(resp.documentos['seccion__oculta']).toBeUndefined();
    // Sin carrusel cargado, el sitio usa las primeras fotos de los productos.
    expect(c.carruseles.bosque.length).toBeGreaterThan(0);
  });

  it('redondeo: sin documento rige la política vigente; con config/redondeo llega tal cual a config.redondeo', async () => {
    // El servidor guarda la política de cada tenant 60 s en memoria (servidor/redondeo.ts): por eso son dos tenants y el
    // documento se escribe ANTES de la primera lectura.
    const sinDoc = await nuevoTenant();
    await sembrarProducto(sinDoc, { id: 'red-uno' });
    await publicar(sinDoc);
    expect(mapear(await leerPublicado(sinDoc)).config.redondeo).toEqual({
      BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 100, modo: 'cercano' },
    });
    const conDoc = await nuevoTenant();
    const regla = { BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'abajo' } };
    await h.firestore.doc(`tenants/${conDoc}/config/redondeo`).set(regla);
    await sembrarProducto(conDoc, { id: 'red-dos' });
    await publicar(conDoc);
    expect(mapear(await leerPublicado(conDoc)).config.redondeo).toEqual(regla);
  });

  describe('casos límite: lo que la consola acepta y el sitio rechaza o acepta hoy', () => {
    it('producto sin marca: se excluye con advertencia y el resto se publica', async () => {
      // S2-1: la consola excluye el producto sin marca (con advertencia) en vez de publicar un documento que tumbaría la reconstrucción del sitio.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'con-marca' });
      await sembrarProducto(t, { id: 'sin-marca', marca: null });
      const r = await publicar(t);
      expect(r.productos).toBe(1);
      expect(r.advertencias).toEqual([expect.stringContaining('no tiene marca')]);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__sin-marca']).toBeUndefined();
      expect(resp.documentos['producto__con-marca']).toBeDefined();
      expect(mapear(resp).productos.map((p) => p.id)).toEqual(['con-marca']);
    });

    it('tras excluir un producto sin marca, el mapeo del resto funciona y el contenido es válido', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'ok-uno', marca: 'Aurora', categoria: 'televisores' });
      await sembrarProducto(t, { id: 'ok-dos', marca: 'Lumina', categoria: 'aires' });
      await sembrarProducto(t, { id: 'ok-sin', marca: null });
      const r = await publicar(t);
      expect(r).toMatchObject({ productos: 2, advertencias: [expect.stringContaining('no tiene marca')] });
      const c = mapear(await leerPublicado(t));
      expect(c.productos.map((p) => p.id)).toEqual(['ok-dos', 'ok-uno']);
      expect(c.marcas).toEqual(['Aurora', 'Lumina']);
      expect(c.categorias.map((k) => k.id)).toEqual(['aires', 'televisores']);
      expect(c.carruseles.bosque.length).toBeGreaterThan(0);
    });

    it('enlace https de una sección a un host no permitido: la consola lo guarda y publica, el sitio rechaza todo (INCOHERENCIA S2)', async () => {
      // INCOHERENCIA S2: `validarEnlace` de la consola (consola/src/enlaces.ts) solo mira el formato; la lista `enlacesPermitidos`
      // (website/src/contenido/validar.ts:271) vive en el negocio del sitio y la consola no la conoce.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'enl-uno' });
      await h.firestore.doc(`tenants/${t}/secciones/enlaces`).set({ id: 'enlaces', titulo: 'Enlaces', visible: true, bloques: [
        { tipo: 'enlaces', items: [{ texto: 'Ajeno', url: 'https://ajeno.example.org/x' }] },
      ] });
      await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: ['enlaces'] });
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(resp.documentos['seccion__enlaces']).toBeDefined();
      expect(mensajeDeError(() => mapear(resp))).toContain('secciones[0].bloques[0].items[0].url: enlace fuera de la lista blanca');
      // Con el host en la lista del negocio el mismo publicado pasa: la lista es la única diferencia.
      expect(mapear(resp, negocio({ enlacesPermitidos: ['ejemplo.invalid', 'ajeno.example.org'] })).secciones).toHaveLength(1);
    });

    it('bloque carrusel cuyos medios faltan: se omite con advertencia, la sección sin bloques también y el sitio se reconstruye', async () => {
      // S2-1: el bloque carrusel sin fotos y la sección que queda sin bloques no se publican (con advertencia), así que el sitio no falla.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'car-uno' });
      await h.firestore.doc(`tenants/${t}/secciones/galeria`).set({ id: 'galeria', titulo: 'Galería', visible: true, bloques: [
        { tipo: 'carrusel', items: [{ medioId: idMedio('nohay'), alt: 'No existe' }] },
      ] });
      await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: ['galeria'] });
      const r = await publicar(t);
      expect(r.advertencias).toEqual(expect.arrayContaining([
        expect.stringContaining('no existe y se omitió'), expect.stringContaining('carrusel sin fotos'), expect.stringContaining('no se publicó porque no tiene contenido'),
      ]));
      const resp = await leerPublicado(t);
      expect(resp.documentos['seccion__galeria']).toBeUndefined();
      expect(mapear(resp).secciones).toEqual([]);
    });

    it('cero productos publicables: publicar se rechaza y no se publica nada', async () => {
      // S2-1: sin ningún producto publicable (ficha en borrador, sin ficha) la consola rechaza la PUBLICACIÓN a mano. Lo que cambió es el mapeo del
      // sitio: ya admite cero productos (lo cubren los casos del retiro automático más abajo), pero publicar sigue exigiendo al menos uno.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'solo-borrador', ficha: 'borrador' });
      await sembrarProducto(t, { id: 'sin-ficha', ficha: null });
      await expect(publicar(t)).rejects.toMatchObject({ message: 'Publique al menos un producto activo' });
      expect((await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).exists).toBe(false);
    });

    it('precio 0 en un mercado: se publica y el sitio lo acepta como «precio a consultar»', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'p0-uno', precio: { bo: 0, ar: 5000 } });
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__p0-uno']).toMatchObject({ precioUSD: { bo: 0, ar: 50 } });
      expect(mapear(resp).productos[0]!.precioUsd).toEqual({ BO: 0, AR: 50 });
    });

    it('producto sin foto: si es el único se rechaza publicar; si otro producto aporta fotos, se publica', async () => {
      // S2-1: sin ninguna foto utilizable (y sin carrusel propio) la consola rechaza publicar; con la foto de otro producto el sitio arma sus carruseles.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'sf-uno', fotos: [] });
      await expect(publicar(t)).rejects.toMatchObject({ message: 'Agregue una foto a un producto publicado o cargue el carrusel' });
      await sembrarProducto(t, { id: 'cf-dos' });
      await publicar(t);
      const c = mapear(await leerPublicado(t));
      expect(c.productos.find((p) => p.id === 'sf-uno')!.fotos).toEqual([]);
      expect(c.productos.find((p) => p.id === 'cf-dos')!.fotos).toHaveLength(1);
    });

    it('producto desactivado después de publicar: al consumir el evento la copia se retira y el sitio ya no lo incluye (S7-1)', async () => {
      // S7-1: desactivar en Inventarios publica `producto.cambiado`; la consola retira la copia y el id de `estado.productos` sin volver a publicar.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'des-uno' });
      await sembrarProducto(t, { id: 'des-dos' });
      await entregarCambios(t);
      await publicar(t);
      const versionAntes = ((await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number }).version;
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'des-uno', cambios: { activo: false } }));
      await entregarCambios(t);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__des-uno']).toBeUndefined();
      expect(mapear(resp).productos.map((p) => p.id)).toEqual(['des-dos']);
      const estado = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { productos: string[]; version: number };
      expect(estado.productos).toEqual(['des-dos']);
      expect(estado.version).toBe(versionAntes + 1);
      // Una publicación posterior coincide con lo que ya muestra el sitio.
      expect((await publicar(t)).productos).toBe(1);
    });

    it('último producto desactivado: la copia se retira, el sitio queda válido con cero productos, el catálogo responde vacío y la consola avisa «sin_productos»', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'ult-uno' });
      await entregarCambios(t);
      await publicar(t);
      const versionAntes = (await estadoPublicado(t)).version;
      await desactivar(t, 'ult-uno');
      await entregarCambios(t);
      expect((await h.firestore.doc(`tenants/${t}/publicado/producto__ult-uno`).get()).exists).toBe(false);
      const estado = await estadoPublicado(t);
      expect(estado.productos).toEqual([]);
      expect(estado.version).toBe(versionAntes + 1);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__ult-uno']).toBeUndefined();
      const c = mapear(resp); // ya no lanza «no hay productos publicados»
      expect(c.productos).toEqual([]);
      expect(await catalogoDe(t)).toEqual([]);
      expect(await aviso(t)).toMatchObject({ motivo: 'sin_productos', en: expect.any(String) });
      expect(await tableroPorCallable(t)).toMatchObject({ avisoSitio: { motivo: 'sin_productos' } });
    });

    it('retirar el último producto con foto dejando otro sin foto: el contenido es válido (carruseles vacíos) y el aviso es «sin_fotos»', async () => {
      // Con las reglas de publicación no se puede publicar un producto sin foto si no hay otro con foto; se publica con ambos y luego
      // se siembra directamente la copia del producto sin foto (medios: []), como quedaría tras quitar sus fotos.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'fot-con' });
      await sembrarProducto(t, { id: 'fot-sin', fotos: [] });
      await entregarCambios(t);
      await publicar(t);
      expect((await estadoPublicado(t)).productos.sort()).toEqual(['fot-con', 'fot-sin']);
      expect((await h.firestore.doc(`tenants/${t}/publicado/producto__fot-sin`).get()).data()?.['medios']).toEqual([]);
      await desactivar(t, 'fot-con');
      await entregarCambios(t);
      expect((await estadoPublicado(t)).productos).toEqual(['fot-sin']);
      const c = mapear(await leerPublicado(t));
      expect(c.productos.map((p) => p.id)).toEqual(['fot-sin']);
      expect(c.productos[0]!.fotos).toEqual([]);
      expect(Object.values(c.carruseles).every((l) => l.length === 0)).toBe(true);
      expect(await aviso(t)).toMatchObject({ motivo: 'sin_fotos' });
      expect(await tableroPorCallable(t)).toMatchObject({ avisoSitio: { motivo: 'sin_fotos' } });
    });

    it('con el sitio sin productos, publicar a mano sigue rechazándose; tras una publicación correcta el aviso desaparece', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'rec-uno' });
      await entregarCambios(t);
      await publicar(t);
      await desactivar(t, 'rec-uno');
      await entregarCambios(t);
      expect(await aviso(t)).toMatchObject({ motivo: 'sin_productos' });
      await expect(publicar(t)).rejects.toMatchObject({ message: 'Publique al menos un producto activo' });
      expect(await aviso(t)).toMatchObject({ motivo: 'sin_productos' }); // el rechazo no limpia el aviso
      await sembrarProducto(t, { id: 'rec-dos' });
      expect((await publicar(t)).productos).toBe(1);
      expect(await aviso(t)).toBeUndefined();
      expect((await tableroPorCallable(t)).avisoSitio).toBeNull();
    });

    it('reactivar un producto retirado no lo republica: no vuelve a la copia ni al catálogo y cuenta como cambio sin publicar', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'rea-uno' });
      await sembrarProducto(t, { id: 'rea-dos' });
      await entregarCambios(t);
      await publicar(t);
      await desactivar(t, 'rea-uno');
      await entregarCambios(t);
      expect((await estadoPublicado(t)).productos).toEqual(['rea-dos']);
      const versionAntes = (await estadoPublicado(t)).version;
      const sinPublicarAntes = await cambiosSinPublicar(t);
      await reactivar(t, 'rea-uno');
      await entregarCambios(t);
      expect((await h.firestore.doc(`tenants/${t}/publicado/producto__rea-uno`).get()).exists).toBe(false);
      expect((await estadoPublicado(t)).productos).toEqual(['rea-dos']);
      expect((await estadoPublicado(t)).version).toBe(versionAntes);
      expect(mapear(await leerPublicado(t)).productos.map((p) => p.id)).toEqual(['rea-dos']);
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['rea-dos']);
      expect(await cambiosSinPublicar(t)).toBeGreaterThan(sinPublicarAntes);
    });

    it('ficha en borrador u oculta: no se publica y su copia anterior se borra al volver a publicar', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'fic-uno' });
      await sembrarProducto(t, { id: 'fic-dos' });
      await sembrarProducto(t, { id: 'fic-tres', ficha: 'borrador' });
      await publicar(t);
      expect(Object.keys((await leerPublicado(t)).documentos).filter((k) => k.startsWith('producto__')).sort()).toEqual(['producto__fic-dos', 'producto__fic-uno']);
      await h.firestore.doc(`tenants/${t}/fichasWeb/fic-uno`).update({ estado: 'oculto' });
      await h.firestore.doc(`tenants/${t}/fichasWeb/fic-dos`).update({ estado: 'borrador' });
      await sembrarProducto(t, { id: 'fic-cuatro' });
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(Object.keys(resp.documentos).filter((k) => k.startsWith('producto__'))).toEqual(['producto__fic-cuatro']);
      expect(mapear(resp).productos.map((p) => p.id)).toEqual(['fic-cuatro']);
    });
  });

  it('cambio de precio después de publicar: sin volver a publicar, la copia y el sitio traen el precio nuevo y se agenda la reconstrucción (S7-1)', async () => {
    // S7-1: el cambio de precio en Inventarios publica `producto.cambiado`; la consola actualiza SOLO el precio de la copia, sube la versión
    // publicada en 1, agenda la reconstrucción (ventana de 10 minutos) y no lo cuenta como «cambio sin publicar».
    const t = await nuevoTenant();
    await sembrarProducto(t, { id: 'pre-uno', precio: { bo: 10000, ar: 20000 } });
    await entregarCambios(t);
    await publicar(t);
    // La publicación ya agendó su reconstrucción; se deja el estado como «el temporizador ya reconstruyó» para que lo agendado
    // después sea obra del consumidor y no un resto de la publicación.
    await simularTemporizadorReconstruyo(t);
    expect(await trabajosProg(t)).toEqual([]);
    const antes = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number };
    const sinPublicarAntes = await cambiosSinPublicar(t);
    await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'pre-uno', cambios: { precioUSD: { bo: 15000, ar: 25000 } } }));
    await entregarCambios(t);
    const resp = await leerPublicado(t);
    expect(resp.documentos['producto__pre-uno']).toMatchObject({ precioUSD: { bo: 150, ar: 250 }, nombre: 'Producto pre-uno' });
    expect(mapear(resp).productos[0]!.precioUsd).toEqual({ BO: 150, AR: 250 });
    const estado = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number; precioVivoEn?: string; reconstruccion?: { programadaPara?: number } };
    expect(estado.version).toBe(antes.version + 1);
    expect((await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()?.['version']).toBe(antes.version + 1);
    expect(estado.precioVivoEn).toEqual(expect.any(String));
    expect(estado.reconstruccion?.programadaPara).toEqual(expect.any(Number));
    // El trabajo `prog-` es NUEVO: lo creó el consumidor (antes del cambio no había ninguno).
    expect(await trabajosProg(t)).toHaveLength(1);
    expect(await cambiosSinPublicar(t)).toBe(sinPublicarAntes);
    // Entregar de nuevo lo mismo no cambia nada.
    await entregarCambios(t);
    expect(((await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number }).version).toBe(antes.version + 1);
    // Dos cambios más seguidos se agrupan en la misma reconstrucción agendada: sigue habiendo un solo trabajo.
    for (const bo of [16000, 17000]) {
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'pre-uno', cambios: { precioUSD: { bo, ar: 25000 } } }));
      await entregarCambios(t);
    }
    expect(await trabajosProg(t)).toHaveLength(1);
    expect((await estadoPublicado(t)).version).toBe(antes.version + 3);
    expect((await h.firestore.doc(`tenants/${t}/publicado/producto__pre-uno`).get()).data()?.['precioUSD']).toMatchObject({ bo: 170 });
  });

  /** Catálogo de NovuChat del tenant (mercado BO) con un token propio. */
  const catalogoDe = async (t: string): Promise<{ id: string; precioCentavos: number; activo: boolean; disponible: boolean }[]> => {
    const hash = createHash('sha256').update(token).digest('hex');
    await h.firestore.doc(`novuchatTokens/${hash}`).set({ tenantId: t, hash, activo: true });
    const r = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: `Bearer ${token}` } });
    expect(r.status, r.texto).toBe(200);
    return (r.cuerpo as { items: { id: string; precioCentavos: number; activo: boolean; disponible: boolean }[] }).items;
  };

  describe('S7-2: una sola definición de «publicado» (existe la copia publicado/producto__<id>)', () => {
    it('ficha publicada con producto.publicado=false SÍ está en el catálogo; producto.publicado=true sin ficha publicada NO; el conjunto coincide con el del sitio', async () => {
      // S7-2: el catálogo de NovuChat parte de `publicado/estado.productos` y de la copia; `producto.publicado` ya no se lee.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'def-a', publicado: false, ficha: 'publicado' }); // ficha publicada, producto.publicado=false
      await sembrarProducto(t, { id: 'def-b', publicado: true, ficha: null }); // producto.publicado=true, sin ficha
      await sembrarProducto(t, { id: 'def-c', publicado: true, ficha: 'borrador' });
      await sembrarProducto(t, { id: 'def-d', publicado: true, ficha: 'publicado' }); // coinciden las dos definiciones
      await publicar(t);
      const sitio = mapear(await leerPublicado(t)).productos.map((p) => p.id);
      expect(sitio).toEqual(['def-a', 'def-d']);
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['def-a', 'def-d']);
      const estado = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { productos: string[] };
      expect([...estado.productos].sort()).toEqual(sitio);
    });

    it('desactivado tras publicar: el catálogo ya no lo ofrece y, tras consumir el evento, tampoco la copia ni el sitio (S7-1)', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'des-a' });
      await sembrarProducto(t, { id: 'des-b' });
      await entregarCambios(t);
      await publicar(t);
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'des-b', cambios: { activo: false } }));
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['des-a']); // el catálogo usa el producto vivo
      await entregarCambios(t);
      expect(mapear(await leerPublicado(t)).productos.map((p) => p.id)).toEqual(['des-a']);
      expect((await h.firestore.doc(`tenants/${t}/publicado/producto__des-b`).get()).exists).toBe(false);
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['des-a']);
    });

    it('sin publicado/estado (copia a mano de un producto activo): catálogo vacío con 200', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'sin-est', publicado: true });
      await h.firestore.doc(`tenants/${t}/publicado/producto__sin-est`).set({ id: 'sin-est' });
      expect((await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).exists).toBe(false);
      expect(await catalogoDe(t)).toEqual([]);
    });

    it('el precio del catálogo es el vivo de Inventarios, sin esperar a que el evento llegue a la copia', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'viv-a', precio: { bo: 10000, ar: 20000 } });
      await publicar(t);
      const antes = (await catalogoDe(t))[0]!.precioCentavos;
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'viv-a', cambios: { precioUSD: { bo: 15000, ar: 25000 } } }));
      const despues = (await catalogoDe(t))[0]!.precioCentavos;
      // Cotización BO = 7: 100 USD → 700 BOB (70 000 centavos); 150 USD → 1 050 BOB (105 000 centavos).
      expect(antes).toBe(70_000);
      expect(despues).toBe(105_000);
      // El disparador del bus del emulador puede entregar el evento en cualquier momento: se entrega aquí también (idempotente) y la copia llega al mismo precio.
      await entregarCambios(t);
      expect(mapear(await leerPublicado(t)).productos[0]!.precioUsd).toEqual({ BO: 150, AR: 250 });
    });

    it('tras un cambio de precio y la entrega del evento, el precio del catálogo de NovuChat y el de la copia publicada coinciden (S7-1)', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'coin-a', precio: { bo: 10000, ar: 20000 } });
      await entregarCambios(t);
      await publicar(t);
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'coin-a', cambios: { precioUSD: { bo: 15000, ar: 25000 } } }));
      await entregarCambios(t);
      const copiaBo = (mapear(await leerPublicado(t)).productos[0]!.precioUsd as { BO: number }).BO;
      expect(copiaBo).toBe(150);
      // Cotización BO = 7: USD de la copia × 7 × 100 = centavos de BOB del catálogo.
      expect((await catalogoDe(t))[0]!.precioCentavos).toBe(Math.round(copiaBo * 7 * 100));
    });

    /** Siembra directa de un producto activo con su copia publicada (rápido, sin pasar por la consola). */
    const sembrarDirecto = async (t: string, id: string, nombre: string): Promise<void> => {
      await h.firestore.doc(`tenants/${t}/productos/${id}`).set({
        id, nombre, categoria: 'televisores', sku: `SKU-${id}`, marca: 'M', precioUSD: { bo: 1000, ar: 1000 }, activo: true, publicado: false, conSerie: false,
      });
      await h.firestore.doc(`tenants/${t}/publicado/producto__${id}`).set({ id, nombre });
    };

    it('más de 100 ids publicados (dos lotes): todos presentes, orden por nombre e id', async () => {
      const t = await nuevoTenant();
      const ids = Array.from({ length: 105 }, (_, i) => `lote-${String(i).padStart(3, '0')}`);
      for (let i = 0; i < ids.length; i += 20) await Promise.all(ids.slice(i, i + 20).map((id) => sembrarDirecto(t, id, id.endsWith('7') ? 'Zeta' : 'Alfa')));
      await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ productos: [...ids].reverse() });
      const items = (await catalogoDe(t)).map((i) => i.id);
      const esperado = [...ids].sort((a, b) => {
        const na = a.endsWith('7') ? 'Zeta' : 'Alfa';
        const nb = b.endsWith('7') ? 'Zeta' : 'Alfa';
        return na.localeCompare(nb) || a.localeCompare(b);
      });
      expect(items).toEqual(esperado);
      expect(items).toContain('lote-104');
    });

    it('un id inválido o con «/» en estado.productos se ignora y el resto del catálogo responde 200', async () => {
      const t = await nuevoTenant();
      await sembrarDirecto(t, 'val-a', 'Alfa');
      await sembrarDirecto(t, 'val-b', 'Beta');
      await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ productos: ['val-a', 'val-a/otro', 'a/b/c', '', 'MAYUS', 'val-b'] });
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['val-a', 'val-b']);
    });

    it('ids duplicados en estado.productos: sin ítems repetidos', async () => {
      const t = await nuevoTenant();
      await sembrarDirecto(t, 'dup-a', 'Alfa');
      await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ productos: ['dup-a', 'dup-a', 'dup-a'] });
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['dup-a']);
    });

    it('producto borrado en Inventarios con la copia aún presente: no aparece', async () => {
      const t = await nuevoTenant();
      await sembrarDirecto(t, 'bor-a', 'Alfa');
      await sembrarDirecto(t, 'bor-b', 'Beta');
      await h.firestore.doc(`tenants/${t}/publicado/estado`).set({ productos: ['bor-a', 'bor-b'] });
      await h.firestore.doc(`tenants/${t}/productos/bor-b`).delete();
      expect((await h.firestore.doc(`tenants/${t}/publicado/producto__bor-b`).get()).exists).toBe(true);
      expect((await catalogoDe(t)).map((i) => i.id)).toEqual(['bor-a']);
    });
  });
});
