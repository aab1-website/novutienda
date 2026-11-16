// Contrato del logo entre lo publicado y el sitio: «la consola publica `sitio/logo` → GET /api/sitio/v1/publicado → contenidoDesdePublicado».
// Mismo patrón y ayudantes que `contrato-sitio.test.ts`, con la salida REAL de `publicarSitio` y del endpoint firmado del emulador.
// Subir y quitar el logo DESPUÉS de publicar (logo vivo) lo cubre en unidades `pruebas/consola/logo-vivo.test.ts`; aquí solo se comprueba
// «quitar» por el callable real, de punta a punta. Tenant y datos sintéticos.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { publicarSitio } from '@novutienda/consola';
import { crearProducto, ingresar, type Autor } from '@novutienda/inventarios';
import { contenidoDesdePublicado } from '../../plataforma/registro.js';
import { crearEntorno, type Entorno } from '../../plataforma/funciones/servidor/entorno.js';
import { accion, crearUsuario, firmar, hayEmulador, herramientas, http, sembrarTenant, unico, type Herramientas } from './ayudas.js';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const secretoSitio = process.env['SITIO_RECONSTRUCCION_SECRETO'] ?? '';
const ADM: Autor = { uid: 'sembrador', rol: 'adm' };
const AHORA = Date.parse('2026-11-04T11:30:00Z');
const MEDIOS = 'https://medios.ejemplo.invalid';
const ENTORNO_BASE = { origen: 'https://tienda.ejemplo.invalid', origenMedios: MEDIOS, appCheck: null, recaptchaSiteKey: null, disponibilidad: {} } as const;
const LOGO_ESCRITO = `${MEDIOS}/logo-escrito.png`;

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

type Doc = Record<string, unknown>;
interface RespuestaPublicado { documentos: Record<string, Doc>; redondeo: unknown }

describe.skipIf(!hayEmulador)('contrato del logo: consola → /publicado → contenido del sitio (emulador)', () => {
  let h: Herramientas;
  let e: Entorno;
  const actor = { uid: 'adm-sintetico', claims: { firebase: { sign_in_provider: 'password' }, pl: { t: {} as Record<string, string>, v: 1 } } };
  const ruta = (t: string, archivo: string): string => `tenants/${t}/publico/medios/_negocio/${archivo}`;

  beforeAll(() => {
    h = herramientas();
    e = crearEntorno({ firestore: h.firestore, auth: h.auth, bucket: h.bucket, ahora: () => AHORA, env: { PLATAFORMA_PRUEBAS: '1' } });
  });

  /** Tenant con un producto publicable (con su foto) y, si se pide, un `sitio/logo` como lo deja `finalizarSubida`. */
  const nuevoTenant = async (conLogo = true): Promise<string> => {
    const t = unico('logo').toLowerCase();
    await sembrarTenant(h, t);
    await h.firestore.doc(`tenants/${t}/sitio/config`).set({ plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {} });
    await h.firestore.doc(`tenants/${t}/sitio/indice`).set({ secciones: [] });
    await h.db.runTransaction((tx) => crearProducto(tx, {
      tenantId: t, operacionId: unico('prod'), por: ADM,
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
    if (conLogo) await sembrarLogo(t);
    return t;
  };

  /** `sitio/logo` con la forma exacta que escribe `finalizarSubida` (`medioId`, `ancho`, `alto`, `versiones` con `bytes`), WebP y PNG. */
  const sembrarLogo = async (t: string): Promise<void> => {
    await h.firestore.doc(`tenants/${t}/sitio/logo`).set({
      medioId: 'medlogo001', ancho: 1200, alto: 800, actualizadoEn: new Date(AHORA).toISOString(), por: 'adm-sintetico',
      versiones: [
        { formato: 'webp', lado: 128, ruta: ruta(t, 'h1-logo128.webp'), bytes: 10 },
        { formato: 'webp', lado: 512, ruta: ruta(t, 'h1-logo512.webp'), bytes: 20 },
        { formato: 'png', lado: 64, ruta: ruta(t, 'h1-logo64.png'), bytes: 10 },
        { formato: 'png', lado: 512, ruta: ruta(t, 'h1-logo512.png'), bytes: 30 },
      ],
    });
  };

  const publicar = (t: string) =>
    publicarSitio({ db: e.db, catalogo: e.catalogo, reloj: { ahora: e.ahora }, disparador: e.disparadorSitio }, {
      tenantId: t, actor: { ...actor, claims: { ...actor.claims, pl: { t: { [t]: 'adm' }, v: 1 } } },
    });

  const leerPublicado = async (t: string): Promise<RespuestaPublicado> => {
    const r0 = `/api/sitio/v1/publicado?tenantId=${t}`;
    const marca = String(Date.now());
    const r = await http(r0, { headers: { 'x-marca-tiempo': marca, 'x-firma': firmar(secretoSitio, marca, `GET\n${r0}\n`) } });
    expect(r.status, r.texto).toBe(200);
    return r.cuerpo as RespuestaPublicado;
  };

  /** Lectura del sitio con aviso: devuelve el contenido y las advertencias. */
  const leerSitio = (resp: unknown, neg: Record<string, unknown> = negocio()) => {
    const advertencias: string[] = [];
    const contenido = contenidoDesdePublicado(resp, neg, ENTORNO_BASE, advertencias);
    return { contenido, advertencias };
  };
  /** Copia de la respuesta real con `documentos.sitio.logo` reemplazado (o quitado con `undefined`). */
  const conLogo = (resp: RespuestaPublicado, logo: unknown): RespuestaPublicado => {
    const sitio: Doc = { ...resp.documentos['sitio'] };
    if (logo === undefined) delete sitio['logo']; else sitio['logo'] = logo;
    return { ...resp, documentos: { ...resp.documentos, sitio } };
  };
  const estadoPublicado = async (t: string): Promise<{ version: number; reconstruccion?: { programadaPara?: number | null } }> =>
    (await h.firestore.doc(`tenants/${t}/publicado/estado`).get()).data() as { version: number; reconstruccion?: { programadaPara?: number | null } };

  it('lo publicado trae `sitio.logo` con la forma pública exacta: solo ancho, alto y versiones de _negocio, con WebP', async () => {
    const t = await nuevoTenant();
    await publicar(t);
    const logo = (await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()?.['logo'] as { ancho: number; alto: number; versiones: { formato: string; lado: number; ruta: string }[] };
    // Sin `medioId`, `bytes`, `por` ni `actualizadoEn`: lo interno de la consola no se publica.
    expect(Object.keys(logo).sort()).toEqual(['alto', 'ancho', 'versiones']);
    expect(logo).toMatchObject({ ancho: 1200, alto: 800 });
    expect(logo.versiones).toHaveLength(4);
    for (const v of logo.versiones) {
      expect(Object.keys(v).sort()).toEqual(['formato', 'lado', 'ruta']);
      expect(['png', 'webp']).toContain(v.formato);
      expect(v.ruta).toMatch(new RegExp(`^tenants/${t}/publico/medios/_negocio/[A-Za-z0-9._-]+$`));
      expect(v.ruta).not.toContain('..');
    }
    expect(logo.versiones.some((v) => v.formato === 'webp')).toBe(true);
  });

  it('rutas ajenas a _negocio, con subcarpeta o con «..» no se publican; sin ninguna válida no hay logo', async () => {
    const t = await nuevoTenant(false);
    await h.firestore.doc(`tenants/${t}/sitio/logo`).set({
      medioId: 'medlogo002', ancho: 10, alto: 10,
      versiones: [
        { formato: 'webp', lado: 64, ruta: ruta(t, 'ok.webp'), bytes: 1 },
        { formato: 'webp', lado: 64, ruta: `tenants/${t}/publico/medios/tv-uno/otra.webp`, bytes: 1 },
        { formato: 'webp', lado: 64, ruta: `${ruta(t, 'sub')}/x.webp`, bytes: 1 },
        { formato: 'webp', lado: 64, ruta: ruta(t, '..'), bytes: 1 },
        { formato: 'webp', lado: 64, ruta: `tenants/otro-t/publico/medios/_negocio/x.webp`, bytes: 1 },
      ],
    });
    await publicar(t);
    const logo = (await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()?.['logo'] as { versiones: { ruta: string }[] };
    expect(logo.versiones.map((v) => v.ruta)).toEqual([ruta(t, 'ok.webp')]);
    await h.firestore.doc(`tenants/${t}/sitio/logo`).update({ versiones: [{ formato: 'webp', lado: 64, ruta: `tenants/${t}/publico/medios/tv-uno/otra.webp`, bytes: 1 }] });
    await publicar(t);
    expect((await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()).not.toHaveProperty('logo');
  });

  it('el endpoint entrega `documentos.sitio.logo` sin alterarlo y el sitio produce cabecera, icono e imagen al compartir (URL https del host de medios)', async () => {
    const t = await nuevoTenant();
    await publicar(t);
    const publicadoDoc = (await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()?.['logo'];
    const resp = await leerPublicado(t);
    expect(resp.documentos['sitio']?.['logo']).toEqual(publicadoDoc);
    const { contenido, advertencias } = leerSitio(resp, negocio({ logo: { url: LOGO_ESCRITO, alt: 'Logo escrito' } }));
    expect(advertencias).toEqual([]);
    const url = (archivo: string): string => `${MEDIOS}/${ruta(t, archivo)}`;
    // Cabecera: la WebP más chica que cubre 88 px (la de 128); icono: el PNG más chico que cubre 64 px; compartir: el PNG más grande.
    expect(contenido.config.logo).toEqual({ url: url('h1-logo128.webp'), alt: 'Tienda de Prueba' });
    expect(contenido.config.iconoSitio).toBe(url('h1-logo64.png'));
    expect(contenido.config.imagenCompartir).toBe(url('h1-logo512.png'));
    for (const u of [contenido.config.logo!.url, contenido.config.iconoSitio!, contenido.config.imagenCompartir!]) {
      expect(u.startsWith('https://')).toBe(true);
      expect(new URL(u).origin).toBe(MEDIOS);
    }
    // El logo subido manda sobre la dirección escrita a mano.
    expect(contenido.config.logo!.url).not.toBe(LOGO_ESCRITO);
  });

  describe('logo ausente o inválido: la lectura no falla, avisa y conserva el logo de la dirección escrita', () => {
    const invalidos: [string, (t: string) => unknown][] = [
      ['forma inválida (no es un objeto)', () => 'texto'],
      ['sin lista de versiones', () => ({ ancho: 1, alto: 1 })],
      ['solo PNG, sin versión WebP', (t) => ({ ancho: 1, alto: 1, versiones: [{ formato: 'png', lado: 64, ruta: ruta(t, 'a.png') }] })],
      ['ruta de otra carpeta', (t) => ({ ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: `tenants/${t}/publico/medios/tv-uno/a.webp` }] })],
      ['ruta con «..»', (t) => ({ ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: `tenants/${t}/publico/medios/_negocio/../a.webp` }] })],
      ['ruta con subcarpeta', (t) => ({ ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: `${ruta(t, 'sub')}/a.webp` }] })],
      ['ruta con esquema o host propio', () => ({ ancho: 1, alto: 1, versiones: [{ formato: 'webp', lado: 64, ruta: 'https://ajeno.example.org/a.webp' }] })],
    ];
    it.each(invalidos)('%s', async (_nombre, fabricar) => {
      const t = await nuevoTenant();
      await publicar(t);
      const resp = conLogo(await leerPublicado(t), fabricar(t));
      const { contenido, advertencias } = leerSitio(resp, negocio({ logo: { url: LOGO_ESCRITO, alt: 'Logo escrito' } }));
      expect(advertencias).toEqual([expect.stringMatching(/^documentos\.sitio\.logo: logo descartado \(/)]);
      expect(advertencias[0]).not.toContain(t); // el aviso lleva la ruta del campo, nunca el valor
      expect(contenido.config.logo).toEqual({ url: LOGO_ESCRITO, alt: 'Logo escrito' });
      expect(contenido.config.iconoSitio).toBeNull();
      expect(contenido.config.imagenCompartir).toBeNull();
      expect(contenido.productos.map((p) => p.id)).toEqual(['tv-uno']);
    });

    it('sin logo publicado (nunca se subió): sin aviso y se conserva la dirección escrita', async () => {
      const t = await nuevoTenant(false);
      await publicar(t);
      const resp = await leerPublicado(t);
      expect(resp.documentos['sitio']).not.toHaveProperty('logo');
      const { contenido, advertencias } = leerSitio(resp, negocio({ logo: { url: LOGO_ESCRITO, alt: 'Logo escrito' } }));
      expect(advertencias).toEqual([]);
      expect(contenido.config.logo).toEqual({ url: LOGO_ESCRITO, alt: 'Logo escrito' });
      expect(contenido.config.iconoSitio).toBeNull();
      expect(contenido.config.imagenCompartir).toBeNull();
    });
  });

  it('quitar el logo después de publicar (callable real) lo retira de lo publicado, sube la versión y agenda la reconstrucción', async () => {
    // Subir tras publicar y los demás caminos del logo vivo (reemplazo, rutas compartidas, disparador caído) están en pruebas/consola/logo-vivo.test.ts.
    const t = await nuevoTenant();
    await publicar(t);
    const antes = await estadoPublicado(t);
    const logoAntes = (await leerPublicado(t)).documentos['sitio']?.['logo'];
    expect(logoAntes).toBeDefined();
    const u = await crearUsuario(h, { rol: 'adm', tenant: t });
    const r = await accion('consola', 'quitarLogo', {}, u.token, t);
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    expect(r.resultado).toEqual({ quitado: true });
    const resp = await leerPublicado(t);
    expect(resp.documentos['sitio']).not.toHaveProperty('logo');
    const despues = await estadoPublicado(t);
    expect(despues.version).toBe(antes.version + 1);
    expect((await h.firestore.doc(`tenants/${t}/publicado/sitio`).get()).data()?.['version']).toBe(antes.version + 1);
    expect(despues.reconstruccion?.programadaPara).toEqual(expect.any(Number));
    expect((await h.firestore.doc(`tenants/${t}/sitio/logo`).get()).exists).toBe(false);
    // El sitio, con la respuesta real de después, vuelve a la dirección escrita sin aviso.
    const { contenido, advertencias } = leerSitio(resp, negocio({ logo: { url: LOGO_ESCRITO, alt: 'Logo escrito' } }));
    expect(advertencias).toEqual([]);
    expect(contenido.config.logo!.url).toBe(LOGO_ESCRITO);
    expect(contenido.config.iconoSitio).toBeNull();
  });
});
