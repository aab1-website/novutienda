// Paridad entre la regla compartida del negocio de la consola (`@novutienda/consola/negocio`, nivel `heredado`) y lo que hoy acepta el
// sitio (`validarNegocio`, `urlEnlaceSegura`, `IDS_ICONO`). Solo esta carpeta puede importar la consola y el sitio a la vez.
//
// Enlaces: la propiedad de seguridad es «si la consola acepta, el sitio también» (la consola puede ser más estricta, nunca más laxa).
// El tope de 500 caracteres lo impone el sitio en OTRO lector (`LARGO_MAXIMO_ENLACE`, aplicado con `Lector.texto` antes de llamar a
// `urlEnlaceSegura`), no la propia `urlEnlaceSegura`; por eso para el largo se compara con la composición `texto(≤500) && urlEnlaceSegura`.
//
// Casos en que difieren en la dirección segura (la consola rechaza y `urlEnlaceSegura` acepta): ver el arreglo `MAS_ESTRICTA` más abajo
// (se fijan como tales en una prueba, para que un cambio de comportamiento sea visible).
import { construirPublicado } from '@novutienda/consola';
import { LIMITES_NEGOCIO, IDS_ICONO_NEGOCIO, enlacePermitidoEnSitio, evaluarNegocioSitio, validarNegocioSitio } from '@novutienda/consola/negocio';
import { IDS_ICONO, LARGO_MAXIMO_ENLACE, urlEnlaceSegura, validarNegocio } from '@novutienda/website';
import { LIMITES_TEXTOS_SITIO } from '@novutienda/nucleo';
import { describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;

describe('íconos', () => {
  it('IDS_ICONO_NEGOCIO es igual a IDS_ICONO del sitio, en el mismo orden', () => {
    expect([...IDS_ICONO_NEGOCIO]).toEqual([...IDS_ICONO]);
  });
});

describe('enlaces: lo que acepta la consola lo acepta el sitio', () => {
  const PERMITIDOS = ['ejemplo.test'];
  const relleno = (n: number, prefijo: string): string => prefijo + 'a'.repeat(n - prefijo.length);
  const casos: readonly string[] = [
    'https://ejemplo.test', 'https://ejemplo.test/', 'https://ejemplo.test/ruta?x=1#y',
    'https://ejemplo.test:443/', 'https://ejemplo.test:65535', 'https://ejemplo.test:65536', 'https://ejemplo.test:99999',
    'https://ejemplo.test:', 'https://ejemplo.test:/x', 'https://ejemplo.test:0', 'https://ejemplo.test:abc',
    'https://EJEMPLO.TEST/x', 'HTTPS://ejemplo.test/x', 'HTTPS://EJEMPLO.TEST',
    'https://ejemplo.test.', 'https://ejemplo.test./x',
    'https://u:p@ejemplo.test/', 'https://u@ejemplo.test/', 'https://@ejemplo.test/',
    'https://ejemplo.test/a@b', 'https://ejemplo.test/?q=a@b', 'https://evil.test@ejemplo.test/', 'https://ejemplo.test@evil.test/',
    '//x', '//ejemplo.test', '/\\x', '/\\\\x', '\\\\ejemplo.test', 'https:\\\\ejemplo.test', 'https://ejemplo.test\\x',
    '/ruta/válida', '/ruta con espacio', '/ruta\tcon-tab', '/ruta\ncon-salto', '/ruta\u0000nulo', '/ruta\u007fdel', '/', '/x?y=1#z',
    'https://ejemplo.test/ruta con espacio', 'https://ejemplo.test/ru\tta', 'https://ejemplo.test/a\nb', ' https://ejemplo.test', 'https://ejemplo.test ',
    'http://ejemplo.test', 'http://ejemplo.test/x', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,hola', 'vbscript:x', 'ftp://ejemplo.test',
    'tel:+59100000', 'tel:12345', 'tel:123456', 'tel:+123456', 'tel:123456789012345', 'tel:1234567890123456', 'tel:+1234567890123456', 'tel:', 'tel:12 3456', 'TEL:123456',
    'mailto:a@ejemplo.test', 'mailto:a@b.co', 'mailto:', 'mailto:a', 'mailto:a@b', 'mailto:@b.co', 'mailto:a@.co', 'mailto:a@b.', 'mailto:a@@b.co',
    'mailto:a b@c.co', 'mailto:a<b>@c.co', 'mailto:"a"@c.co', 'mailto:a@b.co?subject=x', 'MAILTO:a@b.co',
    'https://sub.ejemplo.test/', 'https://otro.test/', 'https://ejemplo.test.evil.test/', 'https://xejemplo.test/', 'ejemplo.test', 'https://', 'https:///x', 'https://[::1]/', 'https://127.0.0.1/',
    'https://ejemplo%2etest/', 'https://ejemplo.test/', 'https://ejemplo.test/%00', '', ' ', '#', '?x', 'x', 'about:blank',
    relleno(499, 'https://ejemplo.test/'), relleno(500, 'https://ejemplo.test/'), relleno(501, 'https://ejemplo.test/'),
    relleno(500, '/'), relleno(501, '/'), '/' + 'a'.repeat(1000),
  ];

  /** El sitio aplica el tope de 500 con `Lector.texto` antes de `urlEnlaceSegura` (validar.ts, `leerFoto` y bloques de enlaces). */
  const sitioAcepta = (u: string): boolean => u.length >= 1 && u.length <= LARGO_MAXIMO_ENLACE && urlEnlaceSegura(u, PERMITIDOS);

  it('el tope de largo del sitio es 500, igual que el de la consola', () => {
    expect(LARGO_MAXIMO_ENLACE).toBe(500);
    expect(LIMITES_NEGOCIO.largoEnlace).toBe(500);
  });

  it('propiedad de seguridad: si enlacePermitidoEnSitio acepta, el sitio también (con el tope de 500 del sitio)', () => {
    const laxas = casos.filter((u) => enlacePermitidoEnSitio(u, PERMITIDOS) && !sitioAcepta(u));
    expect(laxas).toEqual([]);
  });

  it('propiedad de seguridad sin el tope: urlEnlaceSegura sola acepta todo lo que acepta la consola salvo el largo', () => {
    const laxas = casos.filter((u) => u.length <= 500 && enlacePermitidoEnSitio(u, PERMITIDOS) && !urlEnlaceSegura(u, PERMITIDOS));
    expect(laxas).toEqual([]);
  });

  it('el largo: 500 pasa y 501 no en la consola; urlEnlaceSegura sola no lo acota (lo hace otro lector del sitio)', () => {
    expect(enlacePermitidoEnSitio(relleno(500, 'https://ejemplo.test/'), PERMITIDOS)).toBe(true);
    expect(enlacePermitidoEnSitio(relleno(501, 'https://ejemplo.test/'), PERMITIDOS)).toBe(false);
    expect(urlEnlaceSegura(relleno(501, 'https://ejemplo.test/'), PERMITIDOS)).toBe(true);
    expect(sitioAcepta(relleno(501, 'https://ejemplo.test/'))).toBe(false);
  });

  /**
   * Casos fijados: la consola rechaza y `urlEnlaceSegura` acepta (dirección segura). Si cambia, la prueba lo hace visible.
   * La consola descarta espacios, tabuladores, saltos, barras invertidas, `@` en la autoridad (incluso vacía) y anfitriones con
   * escapes (`%2e`); la clase `URL` del sitio los recorta, los convierte en `/` o los decodifica.
   */
  const MAS_ESTRICTA = [
    'https://@ejemplo.test/', 'https:\\\\ejemplo.test', 'https://ejemplo.test\\x', 'https://ejemplo.test/ruta con espacio', 'https://ejemplo.test/ru\tta',
    'https://ejemplo.test/a\nb', ' https://ejemplo.test', 'https://ejemplo.test ', 'https://ejemplo%2etest/',
  ];
  it('casos donde la consola es más estricta que urlEnlaceSegura (dirección segura), fijados', () => {
    const difieren = casos.filter((u) => u.length <= 500 && !enlacePermitidoEnSitio(u, PERMITIDOS) && urlEnlaceSegura(u, PERMITIDOS));
    expect(difieren).toEqual(MAS_ESTRICTA);
  });

  it('puertos: 65535 pasa y 65536 y 99999 no, en ambas; vacío y 0 se comparan', () => {
    for (const u of ['https://ejemplo.test:65535', 'https://ejemplo.test:65536', 'https://ejemplo.test:99999', 'https://ejemplo.test:', 'https://ejemplo.test:0']) {
      if (enlacePermitidoEnSitio(u, PERMITIDOS)) expect(urlEnlaceSegura(u, PERMITIDOS)).toBe(true);
    }
    expect(enlacePermitidoEnSitio('https://ejemplo.test:65535', PERMITIDOS)).toBe(true);
    expect(enlacePermitidoEnSitio('https://ejemplo.test:65536', PERMITIDOS)).toBe(false);
    expect(enlacePermitidoEnSitio('https://ejemplo.test:99999', PERMITIDOS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Límites de los textos (nivel `heredado`)
// ---------------------------------------------------------------------------------------------

const base = (): Json => ({
  nombre: 'Tienda de Ejemplo',
  lema: 'Un lema de ejemplo',
  telefono: '+59100000000',
  correo: 'hola@ejemplo.test',
  direccion: 'Calle Ficticia 123',
  horario: 'Lunes a viernes de 9 a 18',
  enlacesPermitidos: ['ejemplo.test', 'otro.ejemplo.test'],
  portada: {
    insignia: 'Insignia', titulo: ['Línea uno', 'Línea dos', 'Línea tres'], texto: 'Texto de portada',
    textoBotonCatalogo: 'Ver catálogo', textoBotonConsulta: 'Consultar',
  },
  beneficios: [{ icono: 'escudo', titulo: { texto: 'Garantía', confirmada: true }, descripcion: 'Descripción del beneficio' }],
  identidad: {
    etiqueta: 'Quiénes somos', titulo: 'Título de identidad', texto: 'Texto de identidad', foto: null,
    cifra: { valor: { texto: '10 años', confirmada: false }, detalle: 'Detalle de la cifra' },
    valores: [{ icono: 'check', titulo: 'Valor', texto: 'Texto del valor' }],
    sello: { texto: 'Sello', confirmada: true },
  },
  textoPrivacidad: ['Párrafo uno', 'Párrafo dos'],
  categorias: { herramientas: { nombre: 'Herramientas', icono: 'cuadricula' } },
  destacados: ['producto-uno', 'producto-dos'],
});

/** Copia con `valor` puesto en la ruta (`a.b[0].c`). */
function con(origen: Json, ruta: string, valor: unknown): Json {
  const copia = structuredClone(origen) as Json;
  const partes = ruta.replace(/\[(\d+)\]/g, '.$1').split('.');
  let actual: Record<string, unknown> = copia;
  for (const p of partes.slice(0, -1)) actual = actual[p] as Record<string, unknown>;
  actual[partes[partes.length - 1] ?? ''] = valor;
  return copia;
}

/** Lo que el sitio exige y la consola no guarda: mercados, mercado inicial, logo y WhatsApp de la tienda. */
const paraElSitio = (x: Json): Json => ({ ...x, mercados: ['BO'], mercadoInicial: 'BO', logo: null, whatsappTienda: null });

const veredictoSitio = (x: Json): boolean => validarNegocio(paraElSitio(x), ['https://medios.ejemplo.test']).ok;
const veredictoConsola = (x: Json): boolean => evaluarNegocioSitio(x, 'heredado').errores.length === 0;

/** Afirma el mismo veredicto y devuelve el de la consola (para comprobar el borde esperado). */
function mismoVeredicto(x: Json): boolean {
  const consola = veredictoConsola(x);
  expect(veredictoSitio(x), 'veredicto del sitio distinto del de la consola').toBe(consola);
  return consola;
}

describe('base válida', () => {
  it('lo acepta la consola (heredado y estricto) y el sitio', () => {
    expect(veredictoSitio(base())).toBe(true);
    expect(veredictoConsola(base())).toBe(true);
    expect(() => validarNegocioSitio(base(), { nivel: 'heredado' })).not.toThrow();
    expect(() => validarNegocioSitio(base(), { nivel: 'estricto' })).not.toThrow();
  });
});

const un = (n: number, c = 'a'): string => c.repeat(n);

describe('heredado: límites de texto con el mismo veredicto que el sitio', () => {
  // ruta, mínimo (0 = sin mínimo de contenido), máximo
  const CAMPOS: readonly [string, number, number][] = [
    ['nombre', 1, 80], ['lema', 0, 160], ['telefono', 6, 30], ['correo', 5, 120], ['direccion', 1, 200], ['horario', 1, 200],
    ['portada.insignia', 1, 60], ['portada.titulo[0]', 1, 60], ['portada.titulo[1]', 1, 60], ['portada.titulo[2]', 1, 60],
    ['portada.texto', 1, 400], ['portada.textoBotonCatalogo', 1, 60], ['portada.textoBotonConsulta', 1, 60],
    ['beneficios[0].titulo.texto', 1, 200], ['beneficios[0].descripcion', 1, 160],
    ['identidad.etiqueta', 1, 80], ['identidad.titulo', 1, 120], ['identidad.texto', 1, 1200],
    ['identidad.cifra.valor.texto', 1, LIMITES_TEXTOS_SITIO.cifraValor], ['identidad.cifra.detalle', 1, 120],
    ['identidad.valores[0].titulo', 1, 80], ['identidad.valores[0].texto', 1, 400], ['identidad.sello.texto', 1, 200],
    ['textoPrivacidad[0]', 1, 2000], ['categorias.herramientas.nombre', 1, 80],
  ];

  for (const [ruta, min, max] of CAMPOS) {
    it(`${ruta}: largos ${String(min - 1)}, ${String(min)}, ${String(max)} y ${String(max + 1)}`, () => {
      if (min >= 1) expect(mismoVeredicto(con(base(), ruta, un(min - 1)))).toBe(false); // vacío (min-1 = 0)
      if (min >= 2) expect(mismoVeredicto(con(base(), ruta, un(min)))).toBe(true);
      expect(mismoVeredicto(con(base(), ruta, un(min === 0 ? 0 : Math.max(min, 1))))).toBe(true);
      expect(mismoVeredicto(con(base(), ruta, un(max)))).toBe(true);
      expect(mismoVeredicto(con(base(), ruta, un(max + 1)))).toBe(false);
    });
  }

  it('solo blancos: rechazado si el mínimo es 1 (igual en ambos), aceptado en el lema (mínimo 0)', () => {
    for (const [ruta, min] of CAMPOS) {
      expect(mismoVeredicto(con(base(), ruta, '   ')), ruta).toBe(min === 0);
    }
  });

  it('teléfono y correo: los largos min-1 y min exactos (6 y 5), y nulo', () => {
    expect(mismoVeredicto(con(base(), 'telefono', un(5)))).toBe(false);
    expect(mismoVeredicto(con(base(), 'telefono', un(6)))).toBe(true);
    expect(mismoVeredicto(con(base(), 'correo', un(4)))).toBe(false);
    expect(mismoVeredicto(con(base(), 'correo', un(5)))).toBe(true);
    for (const k of ['telefono', 'correo', 'horario']) expect(mismoVeredicto(con(base(), k, null)), k).toBe(true);
    for (const k of ['nombre', 'lema', 'direccion']) expect(mismoVeredicto(con(base(), k, null)), k).toBe(false);
  });

  it('tipos incorrectos en los textos', () => {
    for (const [ruta] of CAMPOS) {
      for (const v of [5, true, {}, [], undefined]) expect(mismoVeredicto(con(base(), ruta, v)), `${ruta}=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('portada.titulo: exactamente tres líneas', () => {
    for (const n of [0, 2, 3, 4]) expect(mismoVeredicto(con(base(), 'portada.titulo', Array.from({ length: n }, () => 'x'))), String(n)).toBe(n === 3);
  });

  it('beneficios: cantidad 0, 8 y 9 y sus campos', () => {
    const uno = (base().beneficios as unknown[])[0];
    for (const n of [0, 1, 8, 9]) expect(mismoVeredicto(con(base(), 'beneficios', Array.from({ length: n }, () => uno))), String(n)).toBe(n <= 8);
    expect(mismoVeredicto(con(base(), 'beneficios[0].icono', 'no-existe'))).toBe(false);
    for (const id of IDS_ICONO) expect(mismoVeredicto(con(base(), 'beneficios[0].icono', id)), id).toBe(true);
    expect(mismoVeredicto(con(base(), 'beneficios[0].titulo.confirmada', 'si'))).toBe(false);
    expect(mismoVeredicto(con(base(), 'beneficios[0].titulo', null))).toBe(false);
  });

  it('identidad: valores 0, 6 y 7; cifra nula; íconos; confirmada', () => {
    const uno = ((base().identidad as Json).valores as unknown[])[0];
    for (const n of [0, 1, 6, 7]) expect(mismoVeredicto(con(base(), 'identidad.valores', Array.from({ length: n }, () => uno))), String(n)).toBe(n <= 6);
    expect(mismoVeredicto(con(base(), 'identidad.cifra', null))).toBe(true);
    expect(mismoVeredicto(con(base(), 'identidad.valores[0].icono', 'x'))).toBe(false);
    expect(mismoVeredicto(con(base(), 'identidad.sello.confirmada', 1))).toBe(false);
    expect(mismoVeredicto(con(base(), 'identidad.foto', null))).toBe(true);
  });

  it('privacidad: cantidad de párrafos 0, 1, 40 y 41', () => {
    for (const n of [0, 1, 40, 41]) expect(mismoVeredicto(con(base(), 'textoPrivacidad', Array.from({ length: n }, () => 'p'))), String(n)).toBe(n >= 1 && n <= 40);
  });

  it('categorías: nombre, ícono, clave, ausente, forma, y cantidad sin tope en heredado (41)', () => {
    expect(mismoVeredicto(con(base(), 'categorias.herramientas.icono', 'x'))).toBe(false);
    for (const id of IDS_ICONO) expect(mismoVeredicto(con(base(), 'categorias.herramientas.icono', id)), id).toBe(true);
    const sinCategorias: Json = base();
    delete sinCategorias['categorias'];
    expect(mismoVeredicto(sinCategorias)).toBe(true);
    expect(mismoVeredicto(con(base(), 'categorias', {}))).toBe(true);
    for (const malo of [null, [], 'x', 5]) expect(mismoVeredicto(con(base(), 'categorias', malo)), JSON.stringify(malo)).toBe(false);
    for (const clave of ['a', 'Mayus', '-guion', 'con espacio', un(80), un(81), 'ñ']) {
      expect(mismoVeredicto(con(base(), 'categorias', { [clave]: { nombre: 'N', icono: 'check' } })), clave).toBe(/^[a-z0-9][a-z0-9-]{0,79}$/.test(clave));
    }
    const muchas = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`c${String(i)}`, { nombre: 'N', icono: 'check' }]));
    expect(mismoVeredicto(con(base(), 'categorias', muchas))).toBe(true); // el tope de 40 es del contenido completo y de `estricto`
    expect(evaluarNegocioSitio(con(base(), 'categorias', muchas), 'estricto').errores.length).toBeGreaterThan(0);
  });

  it('destacados: cantidad 0, 200 y 201; formato del id; ausente', () => {
    const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `prod-${String(i)}`);
    for (const n of [0, 1, 200, 201]) expect(mismoVeredicto(con(base(), 'destacados', ids(n))), String(n)).toBe(n <= 200);
    const sin: Json = base();
    delete sin['destacados'];
    expect(mismoVeredicto(sin)).toBe(true);
    for (const id of ['a', 'ab', 'Ab', '-ab', 'a b', un(59), un(60), un(61), 'a-', 'ñandú']) {
      expect(mismoVeredicto(con(base(), 'destacados', [id])), id).toBe(/^[a-z0-9][a-z0-9-]{1,59}$/.test(id) && id.length <= 60);
    }
    expect(mismoVeredicto(con(base(), 'destacados', [5]))).toBe(false);
  });

  it('enlacesPermitidos: cantidad 0, 20 y 21; forma de anfitrión', () => {
    const hs = (n: number): string[] => Array.from({ length: n }, (_, i) => `h${String(i)}.ejemplo.test`);
    for (const n of [0, 1, 20, 21]) expect(mismoVeredicto(con(base(), 'enlacesPermitidos', hs(n))), String(n)).toBe(n <= 20);
    for (const h of ['ejemplo.test', 'a.b', 'a-b.c-d', 'sinpunto', 'EJEMPLO.test', '-a.b', 'a-.b', 'a..b', '.a.b', 'a.b.', 'a b.c', 'a.b/c', 'a.b:80', '127.0.0.1', 'localhost', 'ñ.test', '', 'a.b.c.d.e']) {
      expect(mismoVeredicto(con(base(), 'enlacesPermitidos', [h])), h).toBe(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h));
    }
    for (const malo of [[5], [null], 'x', null]) expect(mismoVeredicto(con(base(), 'enlacesPermitidos', malo)), JSON.stringify(malo)).toBe(false);
  });

  it('campos obligatorios ausentes: mismo veredicto', () => {
    for (const k of ['nombre', 'lema', 'telefono', 'correo', 'direccion', 'horario', 'enlacesPermitidos', 'portada', 'beneficios', 'identidad', 'textoPrivacidad']) {
      const x = base();
      delete x[k];
      expect(mismoVeredicto(x), k).toBe(false);
    }
    expect(mismoVeredicto(null as unknown as Json)).toBe(false);
  });
});

describe('heredado: tolerancia de caracteres igual a la del sitio', () => {
  const RAROS: readonly [string, string][] = [
    ['salto de línea', 'a\nb'], ['retorno', 'a\rb'], ['DEL', 'a\u007fb'], ['HTML', '<b>a</b>'], ['U+202E', 'a‮b'],
    ['nulo', 'a\u0000b'], ['ancho cero', 'a​b'], ['U+2028', 'a b'], ['BOM', '﻿a'], ['script', '<script>x</script>'],
  ];
  for (const campo of ['nombre', 'lema', 'telefono', 'correo', 'direccion', 'horario', 'portada.insignia', 'portada.titulo[0]', 'identidad.etiqueta', 'categorias.herramientas.nombre']) {
    it(`${campo}: mismo veredicto (y heredado acepta)`, () => {
      for (const [nombre, v] of RAROS) {
        // Se rellena para superar el mínimo de largo (6 el teléfono, 5 el correo): solo se prueba el carácter.
        expect(mismoVeredicto(con(base(), campo, `${v}xxxxxxx`)), `${campo} con ${nombre}`).toBe(true);
      }
    });
  }

  it('estricto sí rechaza esos caracteres en un campo de una línea (más duro a propósito)', () => {
    for (const [nombre, v] of RAROS) {
      expect(evaluarNegocioSitio(con(base(), 'nombre', v), 'estricto').errores.length, nombre).toBeGreaterThan(0);
    }
  });
});

describe('diferencias conocidas, fijadas como tales', () => {
  it('la consola rechaza claves desconocidas; el sitio no', () => {
    for (const ruta of ['extra', 'portada.extra', 'beneficios[0].extra', 'identidad.extra', 'identidad.sello.extra', 'identidad.valores[0].extra', 'categorias.herramientas.extra']) {
      const x = con(base(), ruta, 'x');
      expect(veredictoSitio(x), `sitio ${ruta}`).toBe(true);
      expect(veredictoConsola(x), `consola ${ruta}`).toBe(false);
    }
  });

  it('en el primer nivel la consola ignora mercados, mercadoInicial, logo y whatsappTienda (heredado), pero estricto los rechaza', () => {
    const x: Json = { ...base(), mercados: ['BO'], mercadoInicial: 'BO', logo: null, whatsappTienda: null };
    expect(veredictoConsola(x)).toBe(true);
    expect(veredictoSitio(x)).toBe(true);
    expect(evaluarNegocioSitio(x, 'estricto').errores.length).toBeGreaterThan(0);
    for (const k of ['mercados', 'mercadoInicial', 'logo', 'whatsappTienda']) {
      expect(evaluarNegocioSitio({ ...base(), [k]: 'cualquier-cosa' }, 'heredado').errores, k).toEqual([]);
    }
  });

  it('foto heredada: el sitio valida el origen de la URL; la consola solo su forma', () => {
    const foto = (url: string): Json => con(base(), 'identidad.foto', { url, alt: 'Foto' });
    // Ruta propia: ambos aceptan.
    expect(veredictoSitio(foto('/imagenes/a.webp'))).toBe(true);
    expect(veredictoConsola(foto('/imagenes/a.webp'))).toBe(true);
    // https de un origen declarado: ambos aceptan.
    expect(veredictoSitio(foto('https://medios.ejemplo.test/a.webp'))).toBe(true);
    expect(veredictoConsola(foto('https://medios.ejemplo.test/a.webp'))).toBe(true);
    // https de un origen NO declarado: el sitio rechaza, la consola acepta (la forma es válida).
    expect(veredictoSitio(foto('https://ajeno.test/a.webp'))).toBe(false);
    expect(veredictoConsola(foto('https://ajeno.test/a.webp'))).toBe(true);
    // Mala forma: ambos rechazan.
    for (const u of ['http://medios.ejemplo.test/a.webp', '//ajeno.test/a.webp', '/a b', '/a,b', 'javascript:x']) {
      expect(veredictoConsola(foto(u)), u).toBe(false);
      expect(veredictoSitio(foto(u)), u).toBe(false);
    }
    // Las claves desconocidas dentro de la foto heredada se toleran en la consola.
    expect(veredictoConsola(con(base(), 'identidad.foto', { url: '/a.webp', alt: 'Foto', extra: 1 }))).toBe(true);
  });

  it('foto heredada: versiones (cantidad y ancho) con el mismo veredicto salvo el origen', () => {
    const v = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ url: `/a-${String(i)}.webp`, ancho: 100 + i }));
    for (const n of [0, 6, 7]) expect(mismoVeredicto(con(base(), 'identidad.foto', { url: '/a.webp', alt: 'F', versiones: v(n) })), String(n)).toBe(n <= 6);
    for (const ancho of [15, 16, 8000, 8001, Number.NaN, '100']) {
      expect(veredictoConsola(con(base(), 'identidad.foto', { url: '/a.webp', alt: 'F', versiones: [{ url: '/b.webp', ancho }] })), String(ancho))
        .toBe(veredictoSitio(con(base(), 'identidad.foto', { url: '/a.webp', alt: 'F', versiones: [{ url: '/b.webp', ancho }] })));
    }
  });
});

describe('lo que publica la consola lo acepta el sitio (negocio publicado + las 4 claves del respaldo)', () => {
  const publicadoDe = (datos: Json, medios = new Map()): { negocio: Json; advertencias: readonly string[] } => {
    const negocio = evaluarNegocioSitio(datos, 'estricto').negocio;
    expect(negocio).not.toBeNull();
    const p = construirPublicado({
      productos: [], fichas: new Map(), medios, config: {} as never, secciones: [], carruseles: [],
      negocio: { datos: negocio!, version: 4, actualizadoEn: '2026-11-23T10:00:00.000Z' },
    });
    return { negocio: p.negocio as unknown as Json, advertencias: p.advertencias };
  };
  const sinControl = (n: Json): Json => Object.fromEntries(Object.entries(n).filter(([k]) => !['version', 'actualizadoEn', 'por'].includes(k)));
  const respaldo = { mercados: ['BO', 'AR'], mercadoInicial: 'BO', logo: null, whatsappTienda: null };

  it('con foto de identidad heredada (url)', () => {
    const { negocio } = publicadoDe(con(base(), 'identidad.foto', { url: '/a.webp', alt: 'Foto', versiones: [{ url: '/b.webp', ancho: 480 }] }));
    const resto = sinControl(negocio);
    expect(validarNegocio({ ...resto, ...respaldo }, ['https://medios.ejemplo.test']).ok).toBe(true);
  });

  it('sin foto, con mapa y horario nulo', () => {
    const { negocio } = publicadoDe({ ...con(base(), 'horario', null), mapa: 'https://maps.app.goo.gl/AbC123' });
    const resto = sinControl(negocio);
    const r = validarNegocio({ ...resto, ...respaldo }, ['https://medios.ejemplo.test']);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.negocio.horario).toBeNull(); expect(r.negocio.mapa).toBe('https://maps.app.goo.gl/AbC123'); }
  });
});
