// Contrato de punta a punta «la consola publica → GET /api/sitio/v1/publicado → contenidoDesdePublicado → contenido del sitio».
// Todo con la salida REAL de `publicarSitio` (sobre el catálogo real de Inventarios) y el endpoint firmado real del emulador;
// el mapeo se alcanza por `plataforma/registro.ts`. Tenant y datos sintéticos. Lo que hoy es una incoherencia entre lo que la
// consola acepta y lo que el sitio exige se afirma tal cual está HOY y se marca con `INCOHERENCIA S2` / `S7`: al corregirla, la
// afirmación cambia a propósito.
import { createHash, randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { publicarSitio } from '@novutienda/consola';
import { actualizarProducto, crearProducto, ingresar, type Autor } from '@novutienda/inventarios';
import { contenidoDesdePublicado } from '../../plataforma/registro.js';
import { crearEntorno, type Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { firmar, hayEmulador, herramientas, http, sembrarTenant, unico, type Herramientas } from './ayudas.js';

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
    it('producto sin marca: la consola publica, el sitio rechaza TODA la reconstrucción (INCOHERENCIA S2)', async () => {
      // INCOHERENCIA S2: Inventarios admite `marca` ausente (inventarios/src/productos.ts:18) y `construirPublicado` la omite (consola/src/publicar.ts:162);
      // `contenidoDesdePublicado` la exige (website/src/contenido/desde-publicado.ts:147) y un solo producto sin marca tumba el sitio entero.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'con-marca' });
      await sembrarProducto(t, { id: 'sin-marca', marca: null });
      const r = await publicar(t);
      expect(r.productos).toBe(2);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__sin-marca']).toBeDefined();
      expect(resp.documentos['producto__sin-marca']).not.toHaveProperty('marca');
      const m = mensajeDeError(() => mapear(resp));
      expect(m).toContain('documentos.producto__sin-marca.marca: falta');
      expect(m).not.toContain('con-marca');
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

    it('bloque carrusel cuyos medios faltan: se publica con advertencia y el sitio rechaza todo (INCOHERENCIA S2)', async () => {
      // INCOHERENCIA S2: `construirPublicado` omite el medio inexistente y deja `items: []` (consola/src/publicar.ts:144-146 y 177, advertencia solo
      // en el resultado de publicar); el sitio exige de 1 a 8 fotos por carrusel (validar.ts:263) y falla toda la reconstrucción.
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'car-uno' });
      await h.firestore.doc(`tenants/${t}/secciones/galeria`).set({ id: 'galeria', titulo: 'Galería', visible: true, bloques: [
        { tipo: 'carrusel', items: [{ medioId: idMedio('nohay'), alt: 'No existe' }] },
      ] });
      await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: ['galeria'] });
      const r = await publicar(t);
      expect(r.advertencias).toEqual([expect.stringContaining('no existe y se omitió')]);
      const resp = await leerPublicado(t);
      expect(resp.documentos['seccion__galeria']).toMatchObject({ bloques: [{ tipo: 'carrusel', items: [] }] });
      expect(mensajeDeError(() => mapear(resp))).toContain('secciones[0].bloques[0].fotos: debe ser una lista de 1 a 8 elementos');
    });

    it('cero productos publicados: publicar tiene éxito (0 productos) y el sitio no se reconstruye (INCOHERENCIA S2)', async () => {
      // INCOHERENCIA S2: `publicarSitio` no exige ningún producto (consola/src/publicar.ts:249-273 solo exige la config del sitio); el mapeo sí
      // (desde-publicado.ts:178) y además la consecuencia en cascada (categorías y carruseles vacíos).
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'solo-borrador', ficha: 'borrador' });
      await sembrarProducto(t, { id: 'sin-ficha', ficha: null });
      const r = await publicar(t);
      expect(r).toMatchObject({ productos: 0 });
      const resp = await leerPublicado(t);
      expect(Object.keys(resp.documentos).filter((k) => k.startsWith('producto__'))).toEqual([]);
      expect(mensajeDeError(() => mapear(resp))).toContain('no hay productos publicados');
    });

    it('precio 0 en un mercado: se publica y el sitio lo acepta como «precio a consultar»', async () => {
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'p0-uno', precio: { bo: 0, ar: 5000 } });
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(resp.documentos['producto__p0-uno']).toMatchObject({ precioUSD: { bo: 0, ar: 50 } });
      expect(mapear(resp).productos[0]!.precioUsd).toEqual({ BO: 0, AR: 50 });
    });

    it('producto sin foto: pasa si otro producto aporta fotos al carrusel; si es el único, el sitio rechaza todo (INCOHERENCIA S2)', async () => {
      // INCOHERENCIA S2: la consola publica un producto sin fotos (fichas.ts admite `medios: []`); el sitio necesita al menos una
      // foto en algún producto para armar los carruseles de respaldo (desde-publicado.ts:201).
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'sf-uno', fotos: [] });
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(mensajeDeError(() => mapear(resp))).toContain('carruseles.cielo: debe ser una lista de 1 a 8 elementos');
      await sembrarProducto(t, { id: 'cf-dos' });
      await publicar(t);
      const c = mapear(await leerPublicado(t));
      expect(c.productos.find((p) => p.id === 'sf-uno')!.fotos).toEqual([]);
      expect(c.productos.find((p) => p.id === 'cf-dos')!.fotos).toHaveLength(1);
    });

    it('producto desactivado después de publicar: sigue en la copia y en el sitio hasta la siguiente publicación (INCOHERENCIA S7)', async () => {
      // INCOHERENCIA S7: desactivar en Inventarios no toca `publicado/`; solo `publicarSitio` filtra por `activo` (consola/src/publicar.ts:159).
      // Entre una cosa y la otra el sitio sigue mostrando el producto (con disponibilidad según /api/disponibilidad).
      const t = await nuevoTenant();
      await sembrarProducto(t, { id: 'des-uno' });
      await sembrarProducto(t, { id: 'des-dos' });
      await publicar(t);
      await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'des-uno', cambios: { activo: false } }));
      expect(mapear(await leerPublicado(t)).productos.map((p) => p.id)).toEqual(['des-dos', 'des-uno']);
      const r = await publicar(t);
      expect(r.productos).toBe(1);
      const despues = await leerPublicado(t);
      expect(despues.documentos['producto__des-uno']).toBeUndefined();
      expect(mapear(despues).productos.map((p) => p.id)).toEqual(['des-dos']);
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

  it('cambio de precio después de publicar: la copia conserva el precio anterior hasta volver a publicar (INCOHERENCIA S7)', async () => {
    // INCOHERENCIA S7: el precio se copia a `publicado/` al publicar (consola/src/publicar.ts:164-166 y 274); editarlo en Inventarios no lo actualiza
    // ni marca la copia como vencida, así que el sitio muestra el precio viejo (y el catálogo de NovuChat, que usa el precio vivo
    // de Inventarios con la ficha de la copia, el nuevo: dos precios para el mismo producto).
    const t = await nuevoTenant();
    await sembrarProducto(t, { id: 'pre-uno', precio: { bo: 10000, ar: 20000 } });
    await publicar(t);
    await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'pre-uno', cambios: { precioUSD: { bo: 15000, ar: 25000 } } }));
    expect(mapear(await leerPublicado(t)).productos[0]!.precioUsd).toEqual({ BO: 100, AR: 200 });
    await publicar(t);
    expect(mapear(await leerPublicado(t)).productos[0]!.precioUsd).toEqual({ BO: 150, AR: 250 });
  });

  it('dos definiciones de «publicado»: el sitio mira la ficha y activo; el catálogo de NovuChat exige producto.publicado y activo ADEMÁS de la copia (INCOHERENCIA S7)', async () => {
    // INCOHERENCIA S7: `construirPublicado` decide por ficha `publicado` + `activo` (consola/src/publicar.ts:159) y NO lee
    // `producto.publicado`; el catálogo de NovuChat filtra `publicado == true && activo == true` en Firestore y además exige la copia
    // `publicado/producto__*` (plataforma/funciones/servidor/http/novuchat.ts:99-113). Se afirma lo de HOY.
    const t = await nuevoTenant();
    await sembrarProducto(t, { id: 'def-a', publicado: false, ficha: 'publicado' }); // ficha publicada, producto.publicado=false
    await sembrarProducto(t, { id: 'def-b', publicado: true, ficha: null }); // producto.publicado=true, sin ficha
    await sembrarProducto(t, { id: 'def-c', publicado: true, ficha: 'borrador' });
    await sembrarProducto(t, { id: 'def-d', publicado: true, ficha: 'publicado' }); // coinciden las dos definiciones
    const hash = createHash('sha256').update(token).digest('hex');
    await h.firestore.doc(`novuchatTokens/${hash}`).set({ tenantId: t, hash, activo: true });
    await publicar(t);
    const catalogoIds = async (): Promise<{ id: string; activo: boolean; disponible: boolean }[]> => {
      const r = await http('/api/novuchat/v1/catalogo?mercado=BO', { headers: { authorization: `Bearer ${token}` } });
      expect(r.status, r.texto).toBe(200);
      return (r.cuerpo as { items: { id: string; activo: boolean; disponible: boolean }[] }).items;
    };
    // Sitio: def-a sí (aunque producto.publicado=false), def-b y def-c no, def-d sí.
    expect(mapear(await leerPublicado(t)).productos.map((p) => p.id)).toEqual(['def-a', 'def-d']);
    // Catálogo de NovuChat: def-a NO (producto.publicado=false aunque tenga copia), def-d sí.
    expect((await catalogoIds()).map((i) => i.id)).toEqual(['def-d']);
    // Tras desactivar def-d sin volver a publicar: el sitio lo sigue mostrando y NovuChat ya no lo lista.
    await h.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: t, operacionId: unico('act'), por: ADM, productoId: 'def-d', cambios: { activo: false } }));
    expect(mapear(await leerPublicado(t)).productos.map((p) => p.id)).toEqual(['def-a', 'def-d']);
    expect(await catalogoIds()).toEqual([]);
  });
});
