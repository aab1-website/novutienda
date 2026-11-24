// Datos del negocio del sitio por el callable real `consola` (emulador): `leerNegocioSitio` (supervisor y administrador) y
// `guardarNegocioSitio` (solo administrador, con control de versión), el módulo apagado, y el recorrido hasta `publicado/negocio`
// y `GET /api/sitio/v1/publicado`. Tenants y datos sintéticos.
//
// No cubre: lectura directa de `sitio/negocio` y `publicado/negocio` con el SDK de cliente (reglas de Firestore). Esta suite no
// prueba reglas de Firestore con el SDK de cliente (solo las de Storage); las de Firestore las cubre `pruebas/reglas`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { crearProducto, ingresar, type Autor } from '@novutienda/inventarios';
import { accion, crearUsuario, firmar, hayEmulador, herramientas, http, sembrarTenant, TENANT_TODO_ENCENDIDO, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const secretoSitio = process.env['SITIO_RECONSTRUCCION_SECRETO'] ?? '';
const SEMBRADOR: Autor = { uid: 'sembrador', rol: 'adm' };
const AHORA = Date.parse('2026-11-04T11:30:00Z');

const negocio = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nombre: 'Tienda de Prueba', lema: 'Lema de prueba', telefono: '+59170000000', correo: 'hola@ejemplo.test',
  direccion: 'Calle Ficticia 123', horario: 'Lunes a viernes de 9 a 18', enlacesPermitidos: ['ejemplo.test'],
  portada: {
    insignia: 'PRUEBA', titulo: ['UNO', 'DOS', 'TRES'], texto: 'Texto de prueba.', textoBotonCatalogo: 'VER CATÁLOGO', textoBotonConsulta: 'CONSULTAR',
  },
  beneficios: [{ icono: 'check', titulo: { texto: 'UNO', confirmada: true }, descripcion: 'Descripción uno.' }],
  identidad: {
    etiqueta: 'IDENTIDAD', titulo: 'HISTORIA', texto: 'Texto de identidad de prueba.', foto: null,
    cifra: { valor: { texto: 'Más de 10', confirmada: true }, detalle: 'CLIENTES' },
    valores: [{ icono: 'escudo', titulo: 'Confianza', texto: 'Texto uno.' }],
    sello: { texto: 'SELLO DE PRUEBA.', confirmada: true },
  },
  textoPrivacidad: ['Texto de privacidad de prueba.'],
  categorias: { televisores: { nombre: 'Televisores', icono: 'cuadricula' } },
  destacados: ['tv-uno'],
  ...extra,
});

interface Lectura { negocio: Record<string, unknown> | null; version: number; enlacesPermitidos: string[]; invalido?: string[] }

describe.skipIf(!hayEmulador)('datos del negocio del sitio (callable consola, emulador)', () => {
  let h: Herramientas;
  const docNegocio = async (t: string): Promise<Record<string, unknown> | undefined> => (await h.firestore.doc(`tenants/${t}/sitio/negocio`).get()).data();

  beforeAll(() => {
    h = herramientas();
  });

  /** Siembra de NovuTienda (Admin SDK): sin `sitio/negocio` el panel no puede guardar. Versión 1. */
  const sembrar = async (t: string, extra: Record<string, unknown> = {}): Promise<void> => {
    await h.firestore.doc(`tenants/${t}/sitio/negocio`).set({ ...negocio(extra), version: 1, actualizadoEn: '2026-11-04T11:30:00.000Z', por: 'siembra' });
  };

  /** Tenant con un producto publicable (para publicar y para que el destacado exista). */
  const nuevoTenant = async (): Promise<string> => {
    const t = unico('neg').toLowerCase();
    await sembrarTenant(h, t);
    await h.firestore.doc(`tenants/${t}/sitio/config`).set({ plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {} });
    await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: [] });
    await h.db.runTransaction((tx) => crearProducto(tx, {
      tenantId: t, operacionId: unico('prod'), por: SEMBRADOR,
      producto: { id: 'tv-uno', nombre: 'Televisor', categoria: 'televisores', sku: 'SKU-1', marca: 'Marca', precioUSD: { bo: 12345, ar: 6789 }, activo: true, publicado: true },
    }));
    await h.db.runTransaction((tx) => ingresar(tx, { tenantId: t, operacionId: unico('ing'), por: { uid: 'sembrador', rol: 'sup' }, ubicacionId: 'tienda', lineas: [{ productoId: 'tv-uno', cantidad: 3 }] }));
    const medioId = 'medfototvx';
    await h.firestore.doc(`tenants/${t}/medios/${medioId}`).set({
      id: medioId, productoId: 'tv-uno', tipo: 'foto', formatoOriginal: 'jpeg', bytesOriginal: 1000, rutaOriginal: `tenants/${t}/privado/originales/tv-uno/s`, ancho: 1600, alto: 900, creadoEn: AHORA, por: 'u',
      versiones: [480, 960].map((lado) => ({ clase: 'imagen', lado, formato: 'webp', ruta: `tenants/${t}/publico/medios/tv-uno/${medioId}-imagen${String(lado)}.webp`, bytes: 100 })),
    });
    await h.firestore.doc(`tenants/${t}/fichasWeb/tv-uno`).set({
      productoId: 'tv-uno', slug: 'slug-tv-uno', descripcion: 'Descripción.', garantia: '12 meses', medios: [{ medioId, alt: 'Foto' }],
      seo: { titulo: 'SEO', descripcion: 'Descripción SEO' }, estado: 'publicado',
    });
    return t;
  };

  it('el administrador guarda sobre lo sembrado (versión 2) y lo lee; el documento lleva versión, fecha y autor', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const vacio = await accion('consola', 'leerNegocioSitio', {}, adm.token, t);
    expect(vacio.status, JSON.stringify(vacio.error)).toBe(200);
    expect(vacio.resultado).toEqual({ negocio: null, version: 0, enlacesPermitidos: [] });

    await sembrar(t, { lema: 'Lema sembrado' });
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 1 }, adm.token, t);
    expect(g.status, JSON.stringify(g.error)).toBe(200);
    expect(g.resultado).toEqual({ version: 2, afectados: 0 });

    const l = await accion('consola', 'leerNegocioSitio', {}, adm.token, t);
    expect(l.status, JSON.stringify(l.error)).toBe(200);
    const lectura = l.resultado as Lectura;
    expect(lectura.version).toBe(2);
    expect(lectura.enlacesPermitidos).toEqual(['ejemplo.test']);
    expect(lectura.negocio).toMatchObject({ nombre: 'Tienda de Prueba', destacados: ['tv-uno'], enlacesPermitidos: ['ejemplo.test'] });
    expect(lectura).not.toHaveProperty('invalido');

    const d = await docNegocio(t);
    expect(d).toMatchObject({ nombre: 'Tienda de Prueba', lema: 'Lema de prueba', version: 2, por: adm.uid });
    expect(typeof d?.['actualizadoEn']).toBe('string');
  });

  it('guardar lo mismo no sube la versión; un cambio la sube a 2', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    await sembrar(t);
    const igual = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 1 }, adm.token, t);
    expect(igual.resultado).toEqual({ version: 1, afectados: 0 });
    const cambio = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ lema: 'Otro lema' }), versionEsperada: 1 }, adm.token, t);
    expect(cambio.resultado).toEqual({ version: 2, afectados: 0 });
    expect((await docNegocio(t))?.['lema']).toBe('Otro lema');
  });

  it('sin siembra, guardar da FAILED_PRECONDITION y no escribe nada', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 0 }, adm.token, t);
    expect(g.status).toBe(400);
    expect(g.error?.status).toBe('FAILED_PRECONDITION');
    expect(JSON.stringify(g.error)).toContain('Pida a NovuTienda que los cargue primero');
    expect(await docNegocio(t)).toBeUndefined();
    // No se compara `sitio/estado`: el consumidor de `producto.cambiado` de la siembra de productos lo anota en paralelo
    // (carrera vista en CI). Que el guardado no escribió nada lo prueban la ausencia del documento y de su auditoría.
    const aud = await h.firestore.collection(`tenants/${t}/auditoria`).where('accion', '==', 'sitio.negocio.guardar').get();
    expect(aud.empty).toBe(true);
  });

  it('el supervisor lee y NO puede guardar', async () => {
    const t = await nuevoTenant();
    const sup = await crearUsuario(h, { rol: 'sup', tenant: t });
    await sembrar(t);

    const l = await accion('consola', 'leerNegocioSitio', {}, sup.token, t);
    expect(l.status, JSON.stringify(l.error)).toBe(200);
    expect((l.resultado as Lectura).version).toBe(1);

    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ lema: 'Cambio del supervisor' }), versionEsperada: 1 }, sup.token, t);
    expect(g.status).toBe(403);
    expect(g.error?.status).toBe('PERMISSION_DENIED');
    expect((await docNegocio(t))?.['lema']).toBe('Lema de prueba');
    expect((await docNegocio(t))?.['version']).toBe(1);
  });

  it('el cajero no puede leer ni guardar', async () => {
    const t = await nuevoTenant();
    const caj = await crearUsuario(h, { rol: 'caj', tenant: t });
    const l = await accion('consola', 'leerNegocioSitio', {}, caj.token, t);
    expect(l.status).toBe(403);
    expect(l.error?.status).toBe('PERMISSION_DENIED');
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 0 }, caj.token, t);
    expect(g.status).toBe(403);
    expect(g.error?.status).toBe('PERMISSION_DENIED');
    expect(await docNegocio(t)).toBeUndefined();
  });

  it('un administrador de otro tenant no puede leer ni guardar', async () => {
    const t = await nuevoTenant();
    const otro = await nuevoTenant();
    await sembrar(t);
    const ajeno = await crearUsuario(h, { rol: 'adm', tenant: otro });
    const l = await accion('consola', 'leerNegocioSitio', {}, ajeno.token, t);
    expect(l.status).toBe(403);
    expect(JSON.stringify(l.error)).not.toContain('Tienda de Prueba');
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ lema: 'Intruso' }), versionEsperada: 1 }, ajeno.token, t);
    expect(g.status).toBe(403);
    expect((await docNegocio(t))?.['lema']).toBe('Lema de prueba');
    // Sin sesión.
    expect((await accion('consola', 'leerNegocioSitio', {}, undefined, t)).status).toBe(401);
  });

  it('versionEsperada equivocada: conflicto y el documento no cambia', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    await sembrar(t);
    const antes = await docNegocio(t);
    for (const versionEsperada of [0, 2, 99]) {
      const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ lema: 'No debe guardarse' }), versionEsperada }, adm.token, t);
      expect(g.status, String(versionEsperada)).toBe(409);
      expect(g.error?.status).toBe('ALREADY_EXISTS');
      expect(JSON.stringify(g.error)).toContain('conflicto');
    }
    expect(await docNegocio(t)).toEqual(antes);
  });

  it('un campo inválido: error de validación que nombra la ruta del campo y no contiene el valor', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    await sembrar(t);
    const antes = await docNegocio(t);
    const marca = 'MARCA-SENSIBLE-8f3a';
    const demasiadoLargo = marca + 'a'.repeat(80); // el nombre admite 80
    const g = await accion('consola', 'guardarNegocioSitio', {
      negocio: negocio({ nombre: demasiadoLargo, portada: { ...(negocio()['portada'] as object), insignia: `<b>${marca}</b>` } }), versionEsperada: 1,
    }, adm.token, t);
    expect(g.status).toBe(400);
    expect(g.error?.status).toBe('INVALID_ARGUMENT');
    const cuerpo = JSON.stringify(g.error);
    expect(cuerpo).toContain('nombre');
    expect(cuerpo).not.toContain(marca);
    expect(await docNegocio(t)).toEqual(antes);

    // En el nivel estricto (campo nuevo con HTML): nombra la ruta, no el valor.
    const html = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ lema: `<script>${marca}</script>` }), versionEsperada: 1 }, adm.token, t);
    expect(html.status).toBe(400);
    expect(JSON.stringify(html.error)).toContain('lema');
    expect(JSON.stringify(html.error)).not.toContain(marca);
    // Forma que el esquema del callable rechaza (versión no numérica): tampoco guarda.
    const forma = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 'cero' }, adm.token, t);
    expect(forma.status).toBe(400);
    expect(await docNegocio(t)).toEqual(antes);
  });

  it('con el módulo consola apagado para el tenant, leer y guardar se rechazan', async () => {
    const t = unico('neg-apagado').toLowerCase();
    await h.firestore.doc(`tenants/${t}`).set({ ...TENANT_TODO_ENCENDIDO, modulos: { inventarios: { version: '0.1.0', submodulos: [] } } });
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    const l = await accion('consola', 'leerNegocioSitio', {}, adm.token, t);
    expect(l.status).toBe(403);
    expect(JSON.stringify(l.error)).toContain('modulo-apagado');
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 0 }, adm.token, t);
    expect(g.status).toBe(403);
    expect(JSON.stringify(g.error)).toContain('modulo-apagado');
    expect(await docNegocio(t)).toBeUndefined();
  });

  it('tras guardar y publicar existe publicado/negocio sin el campo `por`, y el endpoint lo entrega en documentos.negocio', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    await sembrar(t);
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio(), versionEsperada: 1 }, adm.token, t);
    expect(g.status, JSON.stringify(g.error)).toBe(200);
    const p = await accion('consola', 'publicarSitio', {}, adm.token, t);
    expect(p.status, JSON.stringify(p.error)).toBe(200);

    const pub = (await h.firestore.doc(`tenants/${t}/publicado/negocio`).get()).data();
    expect(pub).toBeDefined();
    expect(pub).not.toHaveProperty('por');
    expect(pub).toMatchObject({ nombre: 'Tienda de Prueba', version: 1, destacados: ['tv-uno'], enlacesPermitidos: ['ejemplo.test'] });
    expect(typeof pub?.['actualizadoEn']).toBe('string');

    const r0 = `/api/sitio/v1/publicado?tenantId=${t}`;
    const marca = String(Date.now());
    const r = await http(r0, { headers: { 'x-marca-tiempo': marca, 'x-firma': firmar(secretoSitio, marca, `GET\n${r0}\n`) } });
    expect(r.status, r.texto).toBe(200);
    const documentos = (r.cuerpo as { documentos: Record<string, Record<string, unknown>> }).documentos;
    expect(documentos['negocio']).toEqual(JSON.parse(JSON.stringify(pub)));
    expect(documentos['negocio']).not.toHaveProperty('por');
    expect(r.texto).not.toContain(adm.uid);
  });

  it('una categoría oculta guardada desde el panel saca sus productos de lo publicado (lo que lee el catálogo de NovuChat) pero no del inventario', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    // Segundo producto en otra categoría (con la misma foto), para que el sitio siga siendo publicable.
    await h.db.runTransaction((tx) => crearProducto(tx, {
      tenantId: t, operacionId: unico('prod'), por: SEMBRADOR,
      producto: { id: 'radio-uno', nombre: 'Radio', categoria: 'radios', sku: 'SKU-2', marca: 'Marca', precioUSD: { bo: 100, ar: 100 }, activo: true, publicado: true },
    }));
    await h.firestore.doc(`tenants/${t}/fichasWeb/radio-uno`).set({
      productoId: 'radio-uno', slug: 'slug-radio-uno', descripcion: 'Descripción.', garantia: '12 meses', medios: [{ medioId: 'medfototvx', alt: 'Foto' }],
      seo: { titulo: 'SEO', descripcion: 'Descripción SEO' }, estado: 'publicado',
    });
    await sembrar(t, { destacados: ['radio-uno'] });
    const categorias = { televisores: { nombre: 'Televisores', icono: 'cuadricula', oculta: true, orden: 1 }, radios: { nombre: 'Radios', icono: 'cuadricula', orden: 0 } };
    const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ categorias, destacados: ['radio-uno'] }), versionEsperada: 1 }, adm.token, t);
    expect(g.status, JSON.stringify(g.error)).toBe(200);
    expect((await docNegocio(t))?.['categorias']).toEqual(categorias);
    const p = await accion('consola', 'publicarSitio', {}, adm.token, t);
    expect(p.status, JSON.stringify(p.error)).toBe(200);
    expect(JSON.stringify(p.resultado)).toContain('1 producto no se publica porque su categoría está oculta');
    // El catálogo de NovuChat lista `publicado/estado.productos` y lee `publicado/producto__<id>`: ninguno de los dos trae el oculto.
    const estado = (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data();
    expect(estado?.['productos']).toEqual(['radio-uno']);
    expect((await h.firestore.doc(`tenants/${t}/publicado/producto__tv-uno`).get()).exists).toBe(false);
    expect((await h.firestore.doc(`tenants/${t}/publicado/producto__radio-uno`).get()).exists).toBe(true);
    // Sigue en inventario.
    expect((await h.firestore.doc(`tenants/${t}/productos/tv-uno`).get()).exists).toBe(true);
    // La categoría guardada llega al negocio publicado con su `orden` y su marca.
    expect((await h.firestore.doc(`tenants/${t}/publicado/negocio`).get()).data()?.['categorias']).toEqual(categorias);
  });

  it('ciclo completo: publicar, ocultar la categoría (el producto desaparece), publicar, reactivarla y publicar (vuelve)', async () => {
    const t = await nuevoTenant();
    const adm = await crearUsuario(h, { rol: 'adm', tenant: t });
    await h.db.runTransaction((tx) => crearProducto(tx, {
      tenantId: t, operacionId: unico('prod'), por: SEMBRADOR,
      producto: { id: 'radio-uno', nombre: 'Radio', categoria: 'radios', sku: 'SKU-2', marca: 'Marca', precioUSD: { bo: 100, ar: 100 }, activo: true, publicado: true },
    }));
    await h.firestore.doc(`tenants/${t}/fichasWeb/radio-uno`).set({
      productoId: 'radio-uno', slug: 'slug-radio-uno', descripcion: 'Descripción.', garantia: '12 meses', medios: [{ medioId: 'medfototvx', alt: 'Foto' }],
      seo: { titulo: 'SEO', descripcion: 'Descripción SEO' }, estado: 'publicado',
    });
    await sembrar(t);
    const visibles = { televisores: { nombre: 'Televisores', icono: 'cuadricula' }, radios: { nombre: 'Radios', icono: 'cuadricula' } };
    const ocultaTv = { ...visibles, televisores: { ...visibles.televisores, oculta: true } };
    const productos = async (): Promise<string[]> => [...((await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data()?.['productos'] as string[])].sort();
    const copia = async (id: string): Promise<boolean> => (await h.firestore.doc(`tenants/${t}/publicado/producto__${id}`).get()).exists;
    const guardarYPublicar = async (categorias: Record<string, unknown>, versionEsperada: number): Promise<void> => {
      const g = await accion('consola', 'guardarNegocioSitio', { negocio: negocio({ categorias, destacados: ['radio-uno'] }), versionEsperada }, adm.token, t);
      expect(g.status, JSON.stringify(g.error)).toBe(200);
      const p = await accion('consola', 'publicarSitio', {}, adm.token, t);
      expect(p.status, JSON.stringify(p.error)).toBe(200);
    };

    await guardarYPublicar(visibles, 1);
    expect(await productos()).toEqual(['radio-uno', 'tv-uno']);
    expect(await copia('tv-uno')).toBe(true);

    await guardarYPublicar(ocultaTv, 2);
    expect(await productos()).toEqual(['radio-uno']);
    expect(await copia('tv-uno')).toBe(false);

    await guardarYPublicar(visibles, 3);
    expect(await productos()).toEqual(['radio-uno', 'tv-uno']);
    expect(await copia('tv-uno')).toBe(true);
  });

  // Reglas de Firestore con el SDK de cliente: omitido a propósito. Esta suite no prueba reglas de Firestore (solo las de Storage,
  // con `@firebase/rules-unit-testing`); `sitio/negocio` y `publicado/negocio` caen en la matriz generada de `pruebas/reglas`.
});
