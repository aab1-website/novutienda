import { beforeEach, describe, expect, it } from 'vitest';
import {
  finalizarSubida, guardarCarrusel, guardarConfigSitio, guardarFicha, guardarNegocioSitio, guardarSeccion, leerNegocioSitio, publicarSitio,
  reservarSubida, type DepsMedios,
} from '@novutienda/consola';
import { camposCambiados, enlacePermitidoEnSitio, IDS_ICONO_NEGOCIO, LIMITES_NEGOCIO, urlMapaSegura, validarNegocioSitio } from '@novutienda/consola/negocio';
import { actor, AlmacenDoble, CatalogoDoble, DisparadorDoble, JPG, MP4, nuevaDb, ProcesadorSimulado, RelojFijo, T } from './dobles.js';

const adm = actor('adm');
const sup = actor('sup');
const caj = actor('caj');

const base = () => ({
  nombre: 'Tienda Ejemplo', lema: 'Lema de ejemplo', telefono: '22223333', correo: 'hola@ejemplo.test', direccion: 'Calle Falsa 123', horario: 'Lunes a viernes',
  enlacesPermitidos: ['ejemplo.test'],
  portada: { insignia: 'Nuevo', titulo: ['Uno', 'Dos', 'Tres'], texto: 'Texto de portada', textoBotonCatalogo: 'Ver', textoBotonConsulta: 'Consultar' },
  beneficios: [{ icono: 'escudo', titulo: { texto: 'Garantía', confirmada: true }, descripcion: 'Descripción' }],
  identidad: {
    etiqueta: 'Nosotros', titulo: 'Quiénes somos', texto: 'Texto', foto: null, cifra: null,
    valores: [{ icono: 'check', titulo: 'Valor', texto: 'Texto del valor' }], sello: { texto: 'Sello', confirmada: false },
  },
  textoPrivacidad: ['Párrafo uno'],
  categorias: { camaras: { nombre: 'Cámaras', icono: 'cuadricula' } },
  destacados: ['cam-1'],
});
type Dato = Record<string, unknown>;
const con = (cambios: Dato): Dato => ({ ...base(), ...cambios });
const una2 = (): Dato => con({ categorias: { camaras: { nombre: 'Cámaras', icono: 'pin', oculta: true, orden: 3 } } });
const errores = (entrada: unknown, nivel: 'estricto' | 'heredado' = 'estricto'): readonly string[] => {
  try { validarNegocioSitio(entrada, { nivel }); } catch (e) { return (e as { detalles: readonly string[] }).detalles; }
  return [];
};
const rep = (n: number): string => 'a'.repeat(n);

describe('validarNegocioSitio: límites campo por campo', () => {
  it('acepta lo válido y normaliza', () => {
    const n = validarNegocioSitio(base(), { nivel: 'estricto' });
    expect(n.nombre).toBe('Tienda Ejemplo');
    expect(IDS_ICONO_NEGOCIO).toContain(n.beneficios[0]?.icono);
  });
  const casos: [string, (n: number) => Dato, number, number][] = [
    ['nombre', (n) => con({ nombre: rep(n) }), 1, 80],
    ['lema', (n) => con({ lema: rep(n) }), 0, 160],
    ['direccion', (n) => con({ direccion: rep(n) }), 1, 200],
    ['horario', (n) => con({ horario: rep(n) }), 1, 200],
    ['telefono', (n) => con({ telefono: rep(n) }), 6, 30],
    ['correo', (n) => con({ correo: rep(n) }), 5, 120],
    ['portada.insignia', (n) => con({ portada: { ...base().portada, insignia: rep(n) } }), 1, 60],
    ['portada.texto', (n) => con({ portada: { ...base().portada, texto: rep(n) } }), 1, 400],
    ['identidad.texto', (n) => con({ identidad: { ...base().identidad, texto: rep(n) } }), 1, 1200],
    ['textoPrivacidad[0]', (n) => con({ textoPrivacidad: [rep(n)] }), 1, 2000],
    ['categorias.camaras.nombre', (n) => con({ categorias: { camaras: { nombre: rep(n), icono: 'pin' } } }), 1, 80],
  ];
  for (const [campo, mk, min, max] of casos) {
    it(`${campo}: ${String(min)} a ${String(max)}`, () => {
      // Los límites son los del sitio y valen en los dos niveles; se prueban en `heredado` (la forma del correo y del teléfono es de `estricto`).
      expect(errores(mk(max), 'heredado')).toEqual([]);
      expect(errores(mk(min), 'heredado')).toEqual([]);
      expect(errores(mk(max + 1), 'heredado').some((e) => e.startsWith(`${campo}:`))).toBe(true);
      expect(errores(mk(max + 1)).some((e) => e.startsWith(`${campo}:`))).toBe(true);
      if (min > 0) expect(errores(mk(min - 1), 'heredado').some((e) => e.startsWith(`${campo}:`))).toBe(true);
    });
  }
  it('nulos admitidos en teléfono, correo y horario; texto en blanco no cuenta', () => {
    expect(errores(con({ telefono: null, correo: null, horario: null }))).toEqual([]);
    expect(errores(con({ nombre: '   ' })).some((e) => e.startsWith('nombre:'))).toBe(true);
  });
  it('listas: anfitriones ≤20, beneficios ≤8, valores ≤6, privacidad 1–40, destacados ≤200', () => {
    const hosts = (n: number): string[] => Array.from({ length: n }, (_, i) => `h${String(i)}.ejemplo.test`);
    expect(errores(con({ enlacesPermitidos: hosts(20) }))).toEqual([]);
    expect(errores(con({ enlacesPermitidos: hosts(21) }))[0]).toMatch(/^enlacesPermitidos:/);
    expect(errores(con({ enlacesPermitidos: ['no es host'] }))[0]).toBe('enlacesPermitidos[0]: debe ser un nombre de anfitrión');
    const ben = { icono: 'check', titulo: { texto: 'T', confirmada: true }, descripcion: 'D' };
    expect(errores(con({ beneficios: Array(8).fill(ben) }))).toEqual([]);
    expect(errores(con({ beneficios: Array(9).fill(ben) }))[0]).toMatch(/^beneficios:/);
    const val = { icono: 'check', titulo: 'V', texto: 'T' };
    expect(errores(con({ identidad: { ...base().identidad, valores: Array(6).fill(val) } }))).toEqual([]);
    expect(errores(con({ identidad: { ...base().identidad, valores: Array(7).fill(val) } }))[0]).toMatch(/^identidad\.valores:/);
    expect(errores(con({ textoPrivacidad: Array(40).fill('p') }))).toEqual([]);
    expect(errores(con({ textoPrivacidad: Array(41).fill('p') }))[0]).toMatch(/^textoPrivacidad:/);
    expect(errores(con({ textoPrivacidad: [] }))[0]).toMatch(/^textoPrivacidad:/);
    const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `prod-${String(i).padStart(3, '0')}`);
    expect(errores(con({ destacados: ids(200) }))).toEqual([]);
    expect(errores(con({ destacados: ids(201) }))[0]).toMatch(/^destacados:/);
    expect(errores(con({ destacados: ['MAYUS'] }))[0]).toBe('destacados[0]: identificador inválido');
  });
  it('íconos de la lista cerrada, portada de tres líneas, afirmaciones', () => {
    expect(errores(con({ beneficios: [{ ...base().beneficios[0], icono: 'cohete' }] }))[0]).toBe('beneficios[0].icono: ícono fuera de la lista cerrada');
    expect(errores(con({ portada: { ...base().portada, titulo: ['a', 'b'] } }))[0]).toMatch(/^portada\.titulo:/);
    expect(errores(con({ identidad: { ...base().identidad, sello: { texto: 'x', confirmada: 'si' } } }))[0]).toBe('identidad.sello.confirmada: debe ser verdadero o falso');
    expect(LIMITES_NEGOCIO.destacados.max).toBe(200);
  });
  it('whatsappTienda heredado se ignora en silencio; otro campo desconocido se rechaza', () => {
    const n = validarNegocioSitio({ ...base(), whatsappTienda: '59170000000', mercados: ['BO'], mercadoInicial: 'BO', logo: null }, { nivel: 'heredado' });
    for (const k of ['whatsappTienda', 'mercados', 'mercadoInicial', 'logo']) expect(k in n).toBe(false);
    expect(errores({ ...base(), whatsappTienda: 'cualquier cosa' }, 'heredado')).toEqual([]);
    expect(errores({ ...base(), otra: 1 }, 'heredado')[0]).toContain('campo desconocido');
    // En `estricto` (lo que escribe una persona) ninguna clave desconocida, tampoco las de la siembra.
    expect(errores({ ...base(), mercados: ['BO'] })[0]).toContain('campo desconocido');
    expect(errores({ ...base(), logo: null })[0]).toContain('campo desconocido');
  });
  it('los errores nombran la ruta y nunca el valor', () => {
    const secreto = 'VALOR-SECRETO-<b>x</b>';
    const e = errores(con({ nombre: secreto, direccion: 12 }));
    expect(e.length).toBe(2);
    expect(JSON.stringify(e)).not.toContain('VALOR-SECRETO');
    expect(e[0]).toMatch(/^nombre:/);
  });
  it('rechaza HTML y caracteres de control; admite saltos de línea en párrafos', () => {
    expect(errores(con({ nombre: '<script>x</script>' }))[0]).toBe('nombre: no se admite HTML');
    expect(errores(con({ lema: 'a\u0000b' }))[0]).toBe('lema: contiene caracteres de control');
    expect(errores(con({ direccion: 'a\nb' }))[0]).toBe('direccion: contiene caracteres de control');
    expect(errores(con({ textoPrivacidad: ['uno\ndos'] }))).toEqual([]);
    expect(errores(con({ textoPrivacidad: ['<b>uno</b>'] }))[0]).toBe('textoPrivacidad[0]: no se admite HTML');
  });
  it('foto de identidad: por medio, heredada y inválidas', () => {
    const f = (foto: unknown): Dato => con({ identidad: { ...base().identidad, foto } });
    expect(errores(f({ medioId: 'medio-0001', alt: 'Foto' }))).toEqual([]);
    expect(errores(f({ medioId: 'x', alt: 'Foto' }))[0]).toBe('identidad.foto.medioId: inválido');
    expect(errores(f({ url: 'https://medios.ejemplo.test/a.webp', alt: 'Foto', versiones: [{ url: '/m/a-480.webp', ancho: 480 }] }))).toEqual([]);
    expect(errores(f({ url: 'javascript:alert(1)', alt: 'Foto' }))[0]).toBe('identidad.foto.url: debe ser una ruta propia o una dirección https');
    expect(errores(f({ url: '/a.webp', alt: 'Foto', versiones: [{ url: '/a.webp', ancho: 15 }] }))[0]).toMatch(/versiones\[0\]\.ancho/);
    expect(errores(f({ medioId: 'medio-0001', alt: 'Foto', url: '/a' }))).not.toEqual([]);
  });
});

describe('niveles de validación: heredado (paridad con el sitio) y estricto', () => {
  const sucio = (c: Dato): Dato => con(c);
  it('heredado acepta lo que el sitio acepta: saltos, retorno de carro, DEL, etiquetas y formas libres', () => {
    for (const c of [
      { direccion: 'Calle 1\nPiso 2' }, { horario: 'Lunes\tviernes' }, { lema: 'a\rb' }, { nombre: 'Tienda\u007f' }, { nombre: '<b>Tienda</b>' },
      { correo: 'abcde' }, { telefono: 'abcdef' }, { lema: 'x‮y' },
    ]) expect(errores(sucio(c), 'heredado'), JSON.stringify(c)).toEqual([]);
  });
  it('heredado conserva los límites del sitio campo por campo, y el tipo y lo obligatorio', () => {
    expect(errores(con({ nombre: rep(81) }), 'heredado')[0]).toMatch(/^nombre:/);
    expect(errores(con({ nombre: '  ' }), 'heredado')[0]).toMatch(/^nombre:/);
    expect(errores(con({ telefono: 'abc' }), 'heredado')[0]).toMatch(/^telefono:/);
    expect(errores(con({ direccion: 5 }), 'heredado')[0]).toBe('direccion: debe ser texto');
  });
  it('heredado ignora claves desconocidas dentro de la foto heredada, pero no en otros lugares', () => {
    const foto = { url: '/a.webp', alt: 'A', enlace: 'https://x.test', versiones: [{ url: '/a.webp', ancho: 480, extra: 1 }] };
    expect(errores(con({ identidad: { ...base().identidad, foto } }), 'heredado')).toEqual([]);
    expect(errores(con({ portada: { ...base().portada, extra: 1 } }), 'heredado')[0]).toContain('campo desconocido');
  });
  it('estricto rechaza los mismos datos', () => {
    expect(errores(con({ direccion: 'Calle 1\nPiso 2' }))[0]).toBe('direccion: contiene caracteres de control');
    expect(errores(con({ lema: 'a\rb' }))[0]).toBe('lema: contiene caracteres de control');
    expect(errores(con({ nombre: 'Tienda\u007f' }))[0]).toBe('nombre: contiene caracteres de control');
  });
  it('estricto rechaza controles C1, formatos Unicode (bidi, ancho cero, BOM) y separadores U+2028/2029', () => {
    for (const ch of ['\u0085', '\u009f', '‪', '‮', '⁦', '⁩', '​', '‌', '‍', '⁠', '﻿', ' ', ' ']) {
      expect(errores(con({ nombre: `Ti${ch}enda` })), `U+${ch.codePointAt(0)?.toString(16) ?? ''} en una línea`).toEqual(['nombre: contiene caracteres de control']);
      expect(errores(con({ textoPrivacidad: [`Pa${ch}rrafo`] })), `U+${ch.codePointAt(0)?.toString(16) ?? ''} en párrafo`).toEqual(['textoPrivacidad[0]: contiene caracteres de control']);
    }
  });
  it('estricto admite \\n y \\t solo en los campos de varias líneas', () => {
    expect(errores(con({ portada: { ...base().portada, texto: 'uno\ndos\ttres' } }))).toEqual([]);
    expect(errores(con({ identidad: { ...base().identidad, texto: 'uno\ndos' } }))).toEqual([]);
    expect(errores(con({ textoPrivacidad: ['uno\n\tdos'] }))).toEqual([]);
    expect(errores(con({ portada: { ...base().portada, texto: 'uno\r\ndos' } }))).not.toEqual([]);
    expect(errores(con({ horario: 'a\tb' }))).not.toEqual([]);
  });
  it('correo: forma sin parámetros', () => {
    for (const c of ['hola@ejemplo.test', 'a.b+c_d%e@sub.ejemplo.co']) expect(errores(con({ correo: c }))).toEqual([]);
    for (const c of ['hola@ejemplo.test?cc=otro@x.com', 'hola@ejemplo', 'hola@@ejemplo.test', 'ho la@ejemplo.test', 'hola@ejemplo.t', 'hola@ejemplo.test/x', 'abcde']) {
      expect(errores(con({ correo: c })), c).toEqual(['correo: no tiene la forma de un correo (usuario@dominio.ext)']);
    }
    expect(errores(con({ correo: `${rep(65)}@ejemplo.test` })).length).toBe(1);
  });
  it('teléfono: forma y de 6 a 15 dígitos', () => {
    for (const t of ['22223333', '+591 2222-3333', '(2) 222 3333', '123456', '123456789012345']) expect(errores(con({ telefono: t })), t).toEqual([]);
    for (const t of ['abcdef', '------', '( ) ( ) ( )', '+++++++', '12345', '1234567890123456', '2222 3333 x', '22223333; DROP']) {
      expect(errores(con({ telefono: t })), t).not.toEqual([]);
    }
  });
  it('enlacesPermitidos: sin IP, sin TLD numérico, sin localhost (en estricto)', () => {
    expect(errores(con({ enlacesPermitidos: ['ejemplo.test', 'a-b.ejemplo.co'] }))).toEqual([]);
    for (const h of ['1.2.3.4', '192.168.0.1', 'ejemplo.123', 'localhost']) expect(errores(con({ enlacesPermitidos: [h] })), h).not.toEqual([]);
    expect(errores(con({ enlacesPermitidos: ['1.2.3.4'] }))[0]).toBe('enlacesPermitidos[0]: no se admite una dirección IP ni localhost');
    expect(errores(con({ enlacesPermitidos: ['1.2.3.4'] }), 'heredado')).toEqual([]);
  });
  it('categorías: `oculta` (solo verdadero) y `orden` (entero 0 a 39) valen en ambos niveles; fuera de eso se rechaza con su ruta', () => {
    const una = (extra: Dato): Dato => con({ categorias: { camaras: { nombre: 'Cámaras', icono: 'pin', ...extra } } });
    for (const nivel of ['estricto', 'heredado'] as const) {
      expect(errores(una({ oculta: true, orden: 0 }), nivel), nivel).toEqual([]);
      expect(errores(una({ orden: 39 }), nivel), nivel).toEqual([]);
      expect(errores(una({ oculta: false }), nivel), nivel).toEqual(['categorias.camaras.oculta: debe ser verdadero o no estar']);
      for (const o of [-1, 40, 1.5, '3']) expect(errores(una({ orden: o }), nivel), `${nivel} ${String(o)}`).toEqual(['categorias.camaras.orden: debe ser un entero de 0 a 39']);
    }
  });
  it('categorías: lo válido se conserva en el negocio validado', () => {
    const n = validarNegocioSitio(una2(), { nivel: 'estricto' });
    expect(n.categorias['camaras']).toEqual({ nombre: 'Cámaras', icono: 'pin', oculta: true, orden: 3 });
  });
  it('categorías: tope de 40 solo en estricto (el sitio no acota las del negocio); tamaño del documento', () => {
    const cats = (n: number): Dato => Object.fromEntries(Array.from({ length: n }, (_, i) => [`cat-${String(i)}`, { nombre: `Cat ${String(i)}`, icono: 'pin' }]));
    expect(LIMITES_NEGOCIO.categorias.max).toBe(40);
    expect(errores(con({ categorias: cats(40) }))).toEqual([]);
    expect(errores(con({ categorias: cats(41) }))).toEqual(['categorias: máximo 40 categorías']);
    expect(errores(con({ categorias: cats(41) }), 'heredado')).toEqual([]);
    expect(LIMITES_NEGOCIO.documentoMax).toBe(200_000);
    // Con los límites por campo del nivel estricto el documento no llega al tope: es una red de seguridad.
    const grande = con({ textoPrivacidad: Array(40).fill(rep(2000)), destacados: Array.from({ length: 200 }, (_, i) => `prod-${String(i).padStart(3, '0')}`) });
    expect(errores(grande)).toEqual([]);
    expect(JSON.stringify(grande).length).toBeLessThan(LIMITES_NEGOCIO.documentoMax);
  });
});

describe('enlacePermitidoEnSitio', () => {
  const p = ['ejemplo.test'];
  it('admite rutas propias, tel, mailto y https de la lista', () => {
    for (const u of ['/catalogo', '/a?b=1', 'tel:+59122223333', 'mailto:hola@ejemplo.test', 'https://ejemplo.test/x', 'https://ejemplo.test:8443/x']) expect(enlacePermitidoEnSitio(u, p)).toBe(true);
  });
  it('rechaza esquemas peligrosos, hosts fuera de lista, credenciales y mal formados', () => {
    for (const u of ['javascript:alert(1)', 'http://ejemplo.test', 'https://otro.test', 'https://u:p@ejemplo.test', 'https://ejemplo.test@otro.test', '//otro.test', '/a\\b', '', 'data:text/html,x', 'tel:abc', 'mailto:sin-arroba', 'https://']) expect(enlacePermitidoEnSitio(u, p)).toBe(false);
  });
  it('puertos: hasta 65535 (el sitio rechaza más y tumbaría la reconstrucción)', () => {
    for (const u of ['https://ejemplo.test:65535/', 'https://ejemplo.test:1/x', 'https://ejemplo.test:/x', 'https://EJEMPLO.test:443']) expect(enlacePermitidoEnSitio(u, p), u).toBe(true);
    for (const u of ['https://ejemplo.test:65536/', 'https://ejemplo.test:99999/', 'https://ejemplo.test:999999999999']) expect(enlacePermitidoEnSitio(u, p), u).toBe(false);
  });
  it('tope de 500 caracteres', () => {
    const url = (n: number): string => `https://ejemplo.test/${'a'.repeat(n - 'https://ejemplo.test/'.length)}`;
    expect(enlacePermitidoEnSitio(url(500), p)).toBe(true);
    expect(enlacePermitidoEnSitio(url(501), p)).toBe(false);
    expect(url(501).length).toBe(501);
  });
});

describe('servicio y publicación del negocio', () => {
  let db: ReturnType<typeof nuevaDb>;
  let catalogo: CatalogoDoble;
  let almacen: AlmacenDoble;
  let proc: ProcesadorSimulado;
  let reloj: RelojFijo;
  let disparador: DisparadorDoble;
  let n = 0;
  const deps = (): DepsMedios => ({ db, almacen, procesador: proc, catalogo, reloj });
  const ds = () => ({ db, catalogo, reloj });
  const dp = () => ({ db, catalogo, reloj, disparador });
  const dn = () => ({ db, reloj });
  const ruta = `tenants/${T}/sitio/negocio`;
  const rutaPub = `tenants/${T}/publicado/negocio`;

  async function medio(producto: string, tipo: 'foto' | 'video' = 'foto'): Promise<string> {
    n += 1;
    const subidaId = `medio-${String(n).padStart(4, '0')}`;
    const bytes = tipo === 'foto' ? JPG : MP4;
    const r = await reservarSubida(deps(), { tenantId: T, actor: adm, subidaId, productoId: producto, tipo, bytes: bytes.length });
    almacen.subir(r.rutaOriginal, bytes);
    if (tipo === 'video') proc.info = { ancho: 1920, alto: 1080, duracionSeg: 20 };
    await finalizarSubida(deps(), { tenantId: T, actor: adm, subidaId });
    return subidaId;
  }
  const ficha = (slug: string, medios: { medioId: string; alt: string }[]) => ({
    slug, descripcion: 'D', garantia: '12 meses', medios, seo: { titulo: 'T', descripcion: 'D' }, estado: 'publicado',
  });
  const publicable = async (id = 'cam-1'): Promise<string> => {
    await guardarConfigSitio(ds(), { tenantId: T, actor: adm, config: { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: {} } });
    const m = await medio(id);
    await guardarFicha(ds(), { tenantId: T, actor: adm, productoId: id, ficha: ficha(`slug-${id}`, [{ medioId: m, alt: 'Frente' }]) });
    return m;
  };

  beforeEach(() => {
    db = nuevaDb();
    catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1', { marca: 'Acme', sku: 'SKU-1', garantiaMeses: 12, stockTotal: 5 });
    catalogo.agregar('cam-2', { marca: 'Acme' });
    almacen = new AlmacenDoble();
    proc = new ProcesadorSimulado(almacen);
    reloj = new RelojFijo();
    disparador = new DisparadorDoble();
  });

  /** Documento sembrado por NovuTienda (versión 0, otro nombre): sin él, el panel no puede guardar. */
  const sembrar = (extra: Dato = {}): void => { db.poner(ruta, { ...base(), nombre: 'Semilla', version: 0, actualizadoEn: 'x', por: 'siembra', ...extra }); };

  describe('guardar y leer', () => {
    beforeEach(() => { sembrar(); });
    it('sin documento sembrado se rechaza con `estado` y no se escribe nada', async () => {
      const vacia = nuevaDb();
      await expect(guardarNegocioSitio({ db: vacia, reloj }, T, adm, { negocio: base(), versionEsperada: 0 }))
        .rejects.toMatchObject({ codigo: 'estado', message: 'Todavía no están cargados los datos generales del sitio. Pida a NovuTienda que los cargue primero.' });
      expect(vacia.dato(ruta)).toBeUndefined();
    });
    it('una lista entrante mal formada se descarta sin rechazar el guardado', async () => {
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Nuevo', enlacesPermitidos: ['no es host', 7] }), versionEsperada: 0 });
      expect(db.dato(ruta)?.['enlacesPermitidos']).toEqual(['ejemplo.test']);
      expect(db.dato(ruta)?.['lema']).toBe('Nuevo');
    });
    it('sin documento: negocio nulo y versión 0; solo sup y adm leen', async () => {
      expect(await leerNegocioSitio({ db: nuevaDb() }, T, sup)).toEqual({ negocio: null, version: 0, enlacesPermitidos: [] });
      await expect(leerNegocioSitio(dn(), T, caj)).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(leerNegocioSitio(dn(), T, actor('adm', 'otro'))).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });
    it('guarda con versión 0, sube a 1, 2; deja versión, fecha y autor; solo adm guarda', async () => {
      const r = await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 });
      expect(r).toEqual({ version: 1, afectados: 0 });
      expect(db.dato(ruta)).toMatchObject({ nombre: 'Tienda Ejemplo', version: 1, por: 'u-adm', actualizadoEn: new Date(reloj.ms).toISOString() });
      expect(db.dato(ruta)).not.toHaveProperty('whatsappTienda');
      const l = await leerNegocioSitio(dn(), T, sup);
      expect(l).toMatchObject({ version: 1, enlacesPermitidos: ['ejemplo.test'] });
      expect(l.negocio?.nombre).toBe('Tienda Ejemplo');
      expect((await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Otro' }), versionEsperada: 1 })).version).toBe(2);
      await expect(guardarNegocioSitio(dn(), T, sup, { negocio: base(), versionEsperada: 2 })).rejects.toMatchObject({ codigo: 'no-autorizado' });
      await expect(guardarNegocioSitio(dn(), T, caj, { negocio: base(), versionEsperada: 2 })).rejects.toMatchObject({ codigo: 'no-autorizado' });
    });
    it('versión equivocada: conflicto sin escribir', async () => {
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 3 })).rejects.toMatchObject({ codigo: 'conflicto' });
      expect(db.dato(ruta)).toMatchObject({ nombre: 'Semilla', version: 0 });
      await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 });
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Otro' }), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'conflicto' });
      expect(db.dato(ruta)).toMatchObject({ version: 1, lema: 'Lema de ejemplo' });
    });
    it('datos inválidos: entrada-invalida con rutas y sin escribir', async () => {
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ nombre: '' }), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'entrada-invalida', detalles: [expect.stringMatching(/^nombre:/)] });
      expect(db.dato(ruta)).toMatchObject({ nombre: 'Semilla', version: 0 });
    });
    it('audita los NOMBRES de los campos cambiados, nunca los valores, y anota un cambio sin publicar', async () => {
      await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 });
      expect(db.dato(`tenants/${T}/sitio/estado`)?.['cambios']).toBe(1);
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Un lema nuevo secreto', telefono: '77778888' }), versionEsperada: 1 });
      expect(db.dato(`tenants/${T}/sitio/estado`)?.['cambios']).toBe(2);
      const aud = db.coleccion(`tenants/${T}/auditoria`).filter((a) => a['accion'] === 'sitio.negocio.guardar');
      expect(aud).toHaveLength(2);
      expect(aud[1]?.['resumenDespues']).toEqual({ campos: ['lema', 'telefono'], version: 2 });
      expect(JSON.stringify(aud)).not.toContain('lema nuevo secreto');
      expect(JSON.stringify(aud)).not.toContain('77778888');
    });
    it('foto por medio: debe existir y ser foto; la dirección web nueva se rechaza, la heredada se conserva', async () => {
      const m = await medio('cam-1');
      const f = (foto: unknown): Dato => con({ identidad: { ...base().identidad, foto } });
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: f({ medioId: 'medio-9999', alt: 'x' }), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'no-encontrado' });
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: f({ url: '/a.webp', alt: 'x' }), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      await guardarNegocioSitio(dn(), T, adm, { negocio: f({ medioId: m, alt: 'Fachada' }), versionEsperada: 0 });
      expect((db.dato(ruta)?.['identidad'] as Dato)['foto']).toEqual({ medioId: m, alt: 'Fachada' });
      // Dato heredado de la siembra (escrito directo): se puede conservar tal cual y también reemplazar.
      const heredada = { url: 'https://medios.ejemplo.test/f.webp', alt: 'Heredada', versiones: [{ url: 'https://medios.ejemplo.test/f-480.webp', ancho: 480 }] };
      db.poner(ruta, { ...base(), identidad: { ...base().identidad, foto: heredada }, version: 1, actualizadoEn: 'x', por: 'u' });
      // Sin cambios (la misma foto heredada): se acepta y no sube la versión.
      expect((await guardarNegocioSitio(dn(), T, adm, { negocio: f(heredada), versionEsperada: 1 })).version).toBe(1);
      expect((db.dato(ruta)?.['identidad'] as Dato)['foto']).toEqual(heredada);
      await guardarNegocioSitio(dn(), T, adm, { negocio: f({ medioId: m, alt: 'Fachada' }), versionEsperada: 1 });
      expect((db.dato(ruta)?.['identidad'] as Dato)['foto']).toEqual({ medioId: m, alt: 'Fachada' });
    });
    it('afectados: cuenta enlaces guardados que la lista nueva deja fuera, sin modificarlos', async () => {
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'ayuda', titulo: 'Ayuda', visible: true, bloques: [{ tipo: 'enlaces', items: [
        { texto: 'Uno', url: 'https://ejemplo.test/a' }, { texto: 'Dos', url: 'https://otro.test/b' }, { texto: 'Tres', url: '/interna' },
      ] }] } });
      const m = await medio('cam-1');
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'bosque', items: [{ medioId: m, alt: 'a', enlace: 'https://tercero.test/c' }, { medioId: m, alt: 'b' }] } });
      const antes = JSON.stringify([db.dato(`tenants/${T}/secciones/ayuda`), db.dato(`tenants/${T}/carruseles/bosque`)]);
      // La lista guardada (de NovuTienda) rige; el panel no la cambia.
      db.poner(ruta, { ...base(), version: 1, actualizadoEn: 'x', por: 'u' });
      const r = await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Otro lema' }), versionEsperada: 1 });
      expect(r.afectados).toBe(2); // otro.test y tercero.test; ejemplo.test y la ruta interna pasan
      expect(JSON.stringify([db.dato(`tenants/${T}/secciones/ayuda`), db.dato(`tenants/${T}/carruseles/bosque`)])).toBe(antes);
    });

    it('D8: el panel nunca cambia los anfitriones permitidos (se conserva la lista guardada)', async () => {
      db.poner(ruta, { ...base(), version: 1, actualizadoEn: 'x', por: 'u' });
      // Solo cambia la lista: no hay cambios, no sube la versión ni escribe.
      const r = await guardarNegocioSitio(dn(), T, adm, { negocio: con({ enlacesPermitidos: ['ejemplo.test', 'otro.test'] }), versionEsperada: 1 });
      expect(r.version).toBe(1);
      expect(db.dato(ruta)?.['enlacesPermitidos']).toEqual(['ejemplo.test']);
      // Cambia otro campo y la lista entrante se ignora.
      const r2 = await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Otro lema', enlacesPermitidos: ['malo.test'] }), versionEsperada: 1 });
      expect(r2.version).toBe(2);
      expect(db.dato(ruta)?.['enlacesPermitidos']).toEqual(['ejemplo.test']);
      expect(db.dato(ruta)?.['lema']).toBe('Otro lema');
    });
    it('D8: con un documento previo inválido se conserva su lista (filtrada) al corregirlo', async () => {
      db.poner(ruta, { ...base(), nombre: '', enlacesPermitidos: ['ejemplo.test', 'no es host', 7], version: 4, actualizadoEn: 'x', por: 'u' });
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ enlacesPermitidos: ['malo.test'] }), versionEsperada: 4 });
      expect(db.dato(ruta)?.['enlacesPermitidos']).toEqual(['ejemplo.test']);
      expect(db.dato(ruta)?.['version']).toBe(5);
    });
    it('D8: documento previo con enlacesPermitidos que no es una lista: queda []', async () => {
      db.poner(ruta, { ...base(), nombre: '', enlacesPermitidos: 'ejemplo.test', version: 2, actualizadoEn: 'x', por: 'u' });
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ enlacesPermitidos: ['malo.test'] }), versionEsperada: 2 });
      expect(db.dato(ruta)?.['enlacesPermitidos']).toEqual([]);
    });

    it('de extremo a extremo: con documento sembrado con lista, guardar (con otra lista entrante) y publicar conserva los enlaces permitidos', async () => {
      const m = await publicable();
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'ayuda', titulo: 'Ayuda', visible: true, bloques: [{ tipo: 'enlaces', items: [{ texto: 'Uno', url: 'https://ejemplo.test/a' }] }] } });
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'ambar', items: [{ medioId: m, alt: 'a', enlace: 'https://ejemplo.test/ok' }] } });
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ lema: 'Nuevo', enlacesPermitidos: [] }), versionEsperada: 0 });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r.advertencias).toEqual([]);
      expect((db.dato(rutaPub) as Dato)['enlacesPermitidos']).toEqual(['ejemplo.test']);
      expect((db.dato(`tenants/${T}/publicado/carrusel__ambar`) as { items: { enlace?: string }[] }).items[0]?.enlace).toBe('https://ejemplo.test/ok');
      expect(JSON.stringify(db.dato(`tenants/${T}/publicado/secciones__ayuda`) ?? db.coleccion(`tenants/${T}/publicado`))).toContain('https://ejemplo.test/a');
    });

    it('foto que apunta a un medio de tipo video: rechazada', async () => {
      const v = await medio('cam-1', 'video');
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ identidad: { ...base().identidad, foto: { medioId: v, alt: 'x' } } }), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      expect(db.dato(ruta)).toMatchObject({ nombre: 'Semilla', version: 0 });
    });
    it('guardar sin cambios: no sube la versión, no anota cambio ni audita, y responde la versión actual', async () => {
      await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 });
      const antes = JSON.stringify(db.dato(ruta));
      const r = await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 1 });
      expect(r).toEqual({ version: 1, afectados: 0 });
      expect(JSON.stringify(db.dato(ruta))).toBe(antes);
      expect(db.dato(`tenants/${T}/sitio/estado`)?.['cambios']).toBe(1);
      expect(db.coleccion(`tenants/${T}/auditoria`).filter((a) => a['accion'] === 'sitio.negocio.guardar')).toHaveLength(1);
      // Con la versión equivocada sigue siendo conflicto, aunque no haya cambios.
      await expect(guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'conflicto' });
    });
    it('afectados cuenta solo enlaces de secciones visibles y de carruseles', async () => {
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'oculta', titulo: 'Oculta', visible: false, bloques: [{ tipo: 'enlaces', items: [{ texto: 'X', url: 'https://otro.test/x' }] }] } });
      expect((await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 })).afectados).toBe(0);
    });

    describe('dos niveles y regla de transición', () => {
      const heredadoSucio = (): Dato => ({ ...base(), direccion: 'Calle 1\nPiso 2', version: 3, actualizadoEn: 'x', por: 'u' });
      it('un dato heredado (con salto de línea) se lee, se conserva y no impide corregir otro campo', async () => {
        db.poner(ruta, heredadoSucio());
        const l = await leerNegocioSitio(dn(), T, sup);
        expect(l.negocio?.direccion).toBe('Calle 1\nPiso 2');
        expect(l.invalido).toBeUndefined();
        const r = await guardarNegocioSitio(dn(), T, adm, { negocio: con({ direccion: 'Calle 1\nPiso 2', lema: 'Lema nuevo' }), versionEsperada: 3 });
        expect(r.version).toBe(4);
        expect(db.dato(ruta)).toMatchObject({ direccion: 'Calle 1\nPiso 2', lema: 'Lema nuevo' });
        const aud = db.coleccion(`tenants/${T}/auditoria`).filter((a) => a['accion'] === 'sitio.negocio.guardar');
        expect(aud[0]?.['resumenDespues']).toEqual({ campos: ['lema'], version: 4 });
      });
      it('pero si la persona cambia ese campo, se le exige el nivel estricto', async () => {
        db.poner(ruta, heredadoSucio());
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ direccion: 'Otra\nlínea' }), versionEsperada: 3 })).rejects
          .toMatchObject({ codigo: 'entrada-invalida', detalles: ['direccion: contiene caracteres de control'] });
        expect((await guardarNegocioSitio(dn(), T, adm, { negocio: con({ direccion: 'Calle 9' }), versionEsperada: 3 })).version).toBe(4);
      });
      it('un campo nuevo sin tocar lo demás: lo estricto se exige donde cambia; un dato nuevo malo se rechaza aunque lo demás sea heredado', async () => {
        db.poner(ruta, heredadoSucio());
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ direccion: 'Calle 1\nPiso 2', correo: 'sin-forma' }), versionEsperada: 3 })).rejects
          .toMatchObject({ detalles: [expect.stringMatching(/^correo:/)] });
      });
      it('lo que llega sin cumplir ni el nivel heredado se rechaza siempre', async () => {
        db.poner(ruta, heredadoSucio());
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ nombre: rep(81) }), versionEsperada: 3 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      });
      it('claves desconocidas o de la siembra no se aceptan al guardar', async () => {
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: { ...base(), logo: null }, versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
      });
    });

    describe('documento guardado inválido', () => {
      const invalido = (): Dato => ({ ...base(), nombre: '', correo: 5, version: 4, actualizadoEn: 'x', por: 'u' });
      it('leer no lanza: devuelve la versión cruda y las rutas inválidas (sin valores)', async () => {
        db.poner(ruta, invalido());
        const l = await leerNegocioSitio(dn(), T, sup);
        expect(l).toEqual({ negocio: null, version: 4, enlacesPermitidos: [], invalido: ['nombre', 'correo'] });
      });
      it('con otras formas de invalidez (clave desconocida, versión rara) tampoco lanza', async () => {
        db.poner(ruta, { ...base(), extra: 1, version: 'x' });
        expect(await leerNegocioSitio(dn(), T, adm)).toEqual({ negocio: null, version: 0, enlacesPermitidos: [], invalido: ['negocio'] });
      });
      it('guardar lo reemplaza con la versión cruda (todo campo cuenta como cambiado) y luego se lee bien', async () => {
        db.poner(ruta, invalido());
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 0 })).rejects.toMatchObject({ codigo: 'conflicto' });
        await expect(guardarNegocioSitio(dn(), T, adm, { negocio: con({ direccion: 'a\nb' }), versionEsperada: 4 })).rejects.toMatchObject({ codigo: 'entrada-invalida' });
        expect((await guardarNegocioSitio(dn(), T, adm, { negocio: base(), versionEsperada: 4 })).version).toBe(5);
        const l = await leerNegocioSitio(dn(), T, sup);
        expect(l.invalido).toBeUndefined();
        expect(l).toMatchObject({ version: 5, negocio: { nombre: 'Tienda Ejemplo' } });
        const aud = db.coleccion(`tenants/${T}/auditoria`).filter((a) => a['accion'] === 'sitio.negocio.guardar');
        expect((aud[0]?.['resumenDespues'] as { campos: string[] }).campos).toHaveLength(15);
      });
    });
  });

  describe('publicar', () => {
    it('sin sitio/negocio: no escribe ni toca publicado/negocio', async () => {
      await publicable();
      db.poner(rutaPub, { marca: 'previa' });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(db.dato(rutaPub)).toEqual({ marca: 'previa' });
    });
    it('con sitio/negocio: copia pública sin autor, con foto resuelta a medio público y sin whatsapp', async () => {
      await publicable();
      const fm = await medio('cam-1');
      db.poner(ruta, { ...base(), version: 1, actualizadoEn: 'x', por: 'u' });
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ identidad: { ...base().identidad, foto: { medioId: fm, alt: 'Fachada' } } }), versionEsperada: 1 });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r.advertencias).toEqual([]);
      const pub = db.dato(rutaPub) as Dato;
      expect(pub).toMatchObject({ nombre: 'Tienda Ejemplo', version: 2, telefono: '22223333', enlacesPermitidos: ['ejemplo.test'] });
      expect(pub).not.toHaveProperty('por');
      expect(JSON.stringify(pub)).not.toContain('u-adm');
      expect(JSON.stringify(pub)).not.toContain('whatsapp');
      const foto = (pub['identidad'] as Dato)['foto'] as Dato;
      expect(foto).toMatchObject({ tipo: 'foto', alt: 'Fachada' });
      expect(JSON.stringify(foto)).not.toContain('/privado/');
    });
    it('foto heredada se publica tal cual', async () => {
      await publicable();
      const heredada = { url: 'https://medios.ejemplo.test/f.webp', alt: 'H' };
      db.poner(ruta, { ...base(), identidad: { ...base().identidad, foto: heredada }, version: 1, actualizadoEn: 'x', por: 'u' });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(((db.dato(rutaPub) as Dato)['identidad'] as Dato)['foto']).toEqual(heredada);
    });
    it('quita con advertencia los enlaces fuera de la lista (secciones y carruseles) y filtra destacados no publicados', async () => {
      const m = await publicable();
      await guardarSeccion(ds(), { tenantId: T, actor: adm, seccion: { id: 'ayuda', titulo: 'Ayuda', visible: true, bloques: [
        { tipo: 'enlaces', items: [{ texto: 'Uno', url: 'https://ejemplo.test/a' }, { texto: 'Dos', url: 'https://otro.test/b' }] },
        { tipo: 'enlaces', items: [{ texto: 'Solo', url: 'https://otro.test/c' }] },
        { tipo: 'texto', titulo: '', parrafos: ['Hola'] },
      ] } });
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'ambar', items: [{ medioId: m, alt: 'a', enlace: 'https://tercero.test/c' }, { medioId: m, alt: 'b', enlace: 'https://ejemplo.test/ok' }] } });
      db.poner(ruta, { ...base(), version: 1, actualizadoEn: 'x', por: 'u' });
      await guardarNegocioSitio(dn(), T, adm, { negocio: con({ destacados: ['cam-1', 'cam-2', 'no-existe'] }), versionEsperada: 1 });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      const sec = db.dato(`tenants/${T}/publicado/seccion__ayuda`) as { bloques: { tipo: string; items?: { url: string }[] }[] };
      expect(sec.bloques).toHaveLength(2);
      expect(sec.bloques[0]?.items).toEqual([{ texto: 'Uno', url: 'https://ejemplo.test/a' }]);
      const car = db.dato(`tenants/${T}/publicado/carrusel__ambar`) as { items: { enlace?: string }[] };
      expect(car.items[0]).not.toHaveProperty('enlace');
      expect(car.items[1]?.enlace).toBe('https://ejemplo.test/ok');
      expect((db.dato(rutaPub) as Dato)['destacados']).toEqual(['cam-1']);
      const adv = r.advertencias.join('\n');
      expect(adv).toContain('enlace quitado');
      expect(adv).toContain('destacados[1]');
      expect(adv).not.toContain('otro.test');
      expect(adv).not.toContain('tercero.test');
    });
    it('documento inválido: no aborta; se publica como si no existiera y se advierte', async () => {
      const m = await publicable();
      db.poner(rutaPub, { marca: 'previa' });
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'ambar', items: [{ medioId: m, alt: 'a', enlace: 'https://tercero.test/c' }] } });
      db.poner(ruta, { ...base(), nombre: '', version: 2, actualizadoEn: 'x', por: 'u' });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r.advertencias).toContain('Los datos del sitio guardados no son válidos y no se publicaron; corríjalos en Datos del sitio');
      expect(db.dato(rutaPub)).toEqual({ marca: 'previa' });
      // Sin filtrar enlaces: el carrusel conserva el suyo.
      expect((db.dato(`tenants/${T}/publicado/carrusel__ambar`) as { items: { enlace?: string }[] }).items[0]?.enlace).toBe('https://tercero.test/c');
      expect(r.version).toBe(1);
    });
    it('un documento heredado (con salto de línea) sí se publica', async () => {
      await publicable();
      db.poner(ruta, { ...base(), direccion: 'a\nb', version: 1, actualizadoEn: 'x', por: 'u' });
      const r = await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect(r.advertencias.join()).not.toContain('no son válidos');
      expect((db.dato(rutaPub) as Dato)['direccion']).toBe('a\nb');
    });
    it('sin sitio/negocio los enlaces no se tocan', async () => {
      const m = await publicable();
      await guardarCarrusel(ds(), { tenantId: T, actor: adm, carrusel: { plantilla: 'ambar', items: [{ medioId: m, alt: 'a', enlace: 'https://tercero.test/c' }] } });
      await publicarSitio(dp(), { tenantId: T, actor: adm });
      expect((db.dato(`tenants/${T}/publicado/carrusel__ambar`) as { items: { enlace?: string }[] }).items[0]?.enlace).toBe('https://tercero.test/c');
    });
  });
});

describe('cifra del contador (identidad.cifra)', () => {
  const cifra = (valor: string) => ({ valor: { texto: valor, confirmada: true }, detalle: 'desde 2015' });
  const conCifra = (valor: string): Dato => ({ ...base(), identidad: { ...base().identidad, cifra: cifra(valor) } });
  for (const nivel of ['estricto', 'heredado'] as const) {
    it(`${nivel}: acepta 20 caracteres y rechaza 21`, () => {
      expect(errores(conCifra(rep(20)), nivel)).toEqual([]);
      expect(errores(conCifra(rep(21)), nivel).some((m) => m.includes('identidad.cifra.valor.texto'))).toBe(true);
    });
  }
});

describe('institucional (misión, visión y chat) y características de la ficha', () => {
  const chat = (n: number) => ({ mensajes: Array.from({ length: n }, (_, i) => ({ de: i % 2 === 0 ? 'cliente' : 'comercio', texto: 'Hola' })) });
  it('ausente es válido y presente se valida entero', () => {
    expect(errores(base())).toEqual([]);
    expect(errores(con({ institucional: { mision: 'M', vision: 'V', chat: chat(6) } }))).toEqual([]);
    expect(errores(con({ institucional: {} }))).toEqual([]);
  });
  it('topes y forma', () => {
    const casos: [Dato, boolean][] = [
      [{ mision: rep(600) }, true], [{ mision: rep(601) }, false], [{ mision: '' }, false], [{ vision: rep(601) }, false],
      [{ chat: chat(6) }, true], [{ chat: chat(7) }, false], [{ chat: { mensajes: [] } }, false],
      [{ chat: { mensajes: [{ de: 'otro', texto: 'x' }] } }, false], [{ chat: { mensajes: [{ de: 'cliente', texto: rep(301) }] } }, false],
      [{ chat: { mensajes: [{ de: 'cliente', texto: rep(300) }] } }, true],
    ];
    for (const [inst, ok] of casos) expect(errores(con({ institucional: inst }), 'heredado').length === 0, JSON.stringify(inst).slice(0, 80)).toBe(ok);
  });
  it('rechaza claves desconocidas y HTML en estricto', () => {
    expect(errores(con({ institucional: { otra: 'x' } })).length).toBeGreaterThan(0);
    expect(errores(con({ institucional: { mision: '<b>x</b>' } })).some((e) => e.startsWith('institucional.mision'))).toBe(true);
  });
  it('«Nosotros»: acepta tres bloques; rechaza claves desconocidas, HTML, controles y excesos; ausente queda igual', () => {
    const bloque = (titulo: string, ...parrafos: string[]) => ({ titulo, parrafos });
    const tres = [bloque('Sobre nosotros', 'Somos una tienda.', 'Desde 2015.'), bloque('Envíos', 'A todo el país.'), bloque('Garantías', 'Seis meses.')];
    expect(errores(con({ institucional: { nosotros: tres } }))).toEqual([]);
    const leido = validarNegocioSitio(con({ institucional: { nosotros: tres } }), { nivel: 'estricto' });
    expect(leido.institucional?.nosotros).toEqual(tres);
    expect(errores(con({ institucional: { mision: 'M' } }))).toEqual([]);
    expect(validarNegocioSitio(con({ institucional: { mision: 'M' } }), { nivel: 'estricto' }).institucional?.nosotros).toBeUndefined();
    const malos: unknown[] = [
      [{ ...bloque('A', 'x'), otra: 1 }], [bloque('<b>A</b>', 'x')], [bloque('A', 'x <script>')], [bloque('A', 'uno\ndos')], [bloque('A\u0007', 'x')],
      [bloque('', 'x')], [bloque('A')], [bloque('a'.repeat(81), 'x')], [bloque('A', 'a'.repeat(1001))], [bloque('A', ...Array(7).fill('x'))],
      Array(7).fill(bloque('A', 'x')), [],
    ];
    for (const n of malos) expect(errores(con({ institucional: { nosotros: n } })).length, JSON.stringify(n).slice(0, 60)).toBeGreaterThan(0);
    expect(errores(con({ institucional: { nosotros: [bloque('a'.repeat(80), ...Array(6).fill('a'.repeat(1000)))] } }))).toEqual([]);
  });
  it('se guarda y sube la versión; la ficha admite características de 1 a 8', async () => {
    const db = nuevaDb();
    const reloj = new RelojFijo();
    const catalogo = new CatalogoDoble(db);
    catalogo.agregar('cam-1', { marca: 'Acme', sku: 'SKU-1', garantiaMeses: 12, stockTotal: 5 });
    db.poner(`tenants/${T}/sitio/negocio`, { ...base(), nombre: 'Semilla', version: 0, actualizadoEn: 'x', por: 'siembra' });
    const r = await guardarNegocioSitio({ db, reloj }, T, adm, { negocio: con({ institucional: { mision: 'Nuestra misión' } }), versionEsperada: 0 });
    expect(r.version).toBe(1);
    const leido = await leerNegocioSitio({ db }, T, sup);
    expect(leido.negocio?.institucional?.mision).toBe('Nuestra misión');
    const r2 = await guardarNegocioSitio({ db, reloj }, T, adm, { negocio: con({ institucional: { mision: 'Otra' } }), versionEsperada: 1 });
    expect(r2.version).toBe(2);
    const f = (caracteristicas: string[]) => ({ slug: 'cam-1', descripcion: 'D', garantia: '', medios: [], seo: { titulo: '', descripcion: '' }, estado: 'borrador', caracteristicas });
    await expect(guardarFicha({ db, catalogo, reloj }, { tenantId: T, actor: adm, productoId: 'cam-1', ficha: f([]) })).rejects.toThrow();
    await guardarFicha({ db, catalogo, reloj }, { tenantId: T, actor: adm, productoId: 'cam-1', ficha: f(['Uno', 'Dos']) });
  });
});

// Mismos casos que `validar.test.ts` del sitio (`urlMapaSegura`): la regla está duplicada y estos casos las mantienen iguales.
const MAPAS_VALIDOS = [
  'https://www.google.com/maps/place/Tienda+Ejemplo/@-17.39,-66.15,17z', 'https://www.google.com/maps?q=-17.39,-66.15',
  'https://maps.google.com/?q=tienda', 'https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123',
] as const;
const MAPAS_INVALIDOS = [
  'javascript:alert(1)', 'http://www.google.com/maps', 'https://www.google.com/search?q=maps', 'https://www.google.com/mapsx', 'https://goo.gl/otra',
  'https://google.com/maps', 'https://evil.com/maps', 'https://www.google.com.evil.com/maps', 'https://usuario@www.google.com/maps',
  'https://www.google.com:8443/maps', 'https://maps.google.com/ruta con espacio', `https://maps.app.goo.gl/${'a'.repeat(1000)}`, '', 'data:text/html,x',
  'https://www.google.com/maps/../url?q=https://evil.com', 'https://www.google.com/maps/%2e%2e/url?q=x', 'https://www.google.com/maps/a%2eb', 'https://www.google.com/maps/..%2f..%2furl?q=x', 'https://www.google.com/maps/%5c..', 'https://maps.google.com/url?q=https://evil.example', 'https://goo.gl/maps/../abc', 'https://MAPS.GOOGLE.COM/x', 'https://maps.google.com:443/x', 'https://maps.google.com:/x', 'https:///maps.google.com/x', 'https:/maps.google.com/x', 'https://maps.google.com\\@evil.com/x', 'https://maps.google%2ecom/x', 'https://maps.google.\uff43om/x', 'https://www.google.com/maps/%2E%2E/url', 'https://www.google.com/maps/./x', 'https://www.google.com/maps/..',
] as const;

describe('enlace al mapa (campo opcional mapa)', () => {
  const con = (mapa: unknown) => ({ ...base(), mapa });
  const acepta = (n: unknown, nivel: 'estricto' | 'heredado' = 'estricto'): boolean => { try { validarNegocioSitio(n, { nivel }); return true; } catch { return false; } };

  it('urlMapaSegura acepta Google Maps y rechaza el resto', () => {
    for (const u of MAPAS_VALIDOS) expect(urlMapaSegura(u), u).toBe(true);
    for (const u of MAPAS_INVALIDOS) expect(urlMapaSegura(u), u).toBe(false);
  });
  it('es opcional: ausente o null no deja la clave; con valor válido se conserva', () => {
    expect('mapa' in validarNegocioSitio(base(), { nivel: 'estricto' })).toBe(false);
    expect('mapa' in validarNegocioSitio(con(null), { nivel: 'heredado' })).toBe(false);
    expect(validarNegocioSitio(con('https://maps.app.goo.gl/AbC123'), { nivel: 'estricto' }).mapa).toBe('https://maps.app.goo.gl/AbC123');
  });
  it('un valor inválido falla en ambos niveles nombrando la ruta, sin copiar el valor', () => {
    for (const nivel of ['estricto', 'heredado'] as const) {
      expect(acepta(con('https://evil.com/maps'), nivel)).toBe(false);
      expect(acepta(con(5), nivel)).toBe(false);
    }
    let error: unknown;
    expect(() => { try { validarNegocioSitio(con('javascript:alert(1)'), { nivel: 'estricto' }); } catch (e) { error = e; throw e; } }).toThrow();
    expect(JSON.stringify(error)).toContain('mapa');
    expect(JSON.stringify(error)).not.toContain('alert');
  });
  it('cuenta como campo cambiado', () => {
    const antes = validarNegocioSitio(base(), { nivel: 'estricto' });
    const despues = validarNegocioSitio(con('https://maps.app.goo.gl/AbC123'), { nivel: 'estricto' });
    expect(camposCambiados(antes, despues)).toEqual(['mapa']);
    expect(camposCambiados(despues, despues)).toEqual([]);
  });
});
