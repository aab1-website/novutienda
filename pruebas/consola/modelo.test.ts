import { describe, expect, it } from 'vitest';
import * as consola from '@novutienda/consola';
import * as nucleo from '@novutienda/nucleo';
import {
  esPlantilla, manifiestoConsola, PANTALLAS, PLANTILLAS, validarCarrusel, validarConfigSitio, validarEnlace, validarFichaWeb, validarSeccion,
} from '@novutienda/consola';
import { LIMITES_CONSOLA } from '@novutienda/consola';
import { crearRegistro, type ManifiestoModulo } from '@novutienda/nucleo';

describe('lista blanca de enlaces', () => {
  it.each([
    'https://ejemplo.com',
    'https://www.ejemplo.com/ruta/pagina?x=1#ancla',
    'https://wa.me/59100000000',
    'https://wa.me/59100000000?text=Hola',
    'tel:+59100000000',
    'mailto:ventas@ejemplo.com',
    '/',
    '/catalogo/camaras?marca=x',
  ])('acepta %s', (u) => {
    expect(validarEnlace(u).ok).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'data:text/html;base64,AAAA',
    'http://ejemplo.com',
    'ftp://ejemplo.com',
    '//evil.com/x',
    '/\\evil.com',
    'https://usuario:clave@ejemplo.com',
    'https://ejemplo.com@evil.com',
    'https://10.0.0.1/x',
    'https://localhost',
    'https://wa.me/abc',
    'https://ejemplo.com/a b',
    'https://ejemplo.com/\u0000',
    'mailto:a@b.com?cc=x@y.com',
    'tel:abc',
    '/../etc/passwd',
    'vbscript:x',
    'ejemplo.com',
    '',
  ])('rechaza %j', (u) => {
    expect(validarEnlace(u).ok).toBe(false);
  });

  it('rechaza lo que no es texto', () => {
    expect(validarEnlace(undefined).ok).toBe(false);
    expect(validarEnlace(5).ok).toBe(false);
    expect(validarEnlace(`https://ejemplo.com/${'a'.repeat(2100)}`).ok).toBe(false);
  });
});

const fichaOk = {
  slug: 'camara-ip-2mp',
  descripcion: 'Cámara de seguridad.',
  garantia: '12 meses',
  medios: [{ medioId: 'medio-0001', alt: 'Vista frontal' }],
  seo: { titulo: 'Cámara IP', descripcion: 'Cámara IP de 2 MP' },
  estado: 'borrador',
};

describe('ficha web', () => {
  it('acepta una ficha válida', () => {
    const r = validarFichaWeb(fichaOk);
    expect(r.ok).toBe(true);
  });
  it('exige texto alternativo en todo medio', () => {
    const r = validarFichaWeb({ ...fichaOk, medios: [{ medioId: 'medio-0001', alt: '' }] });
    expect(r.ok).toBe(false);
    expect(validarFichaWeb({ ...fichaOk, medios: [{ medioId: 'medio-0001' }] }).ok).toBe(false);
  });
  it('rechaza slug inválido, estado desconocido, HTML y campos desconocidos', () => {
    expect(validarFichaWeb({ ...fichaOk, slug: 'Mala Idea' }).ok).toBe(false);
    expect(validarFichaWeb({ ...fichaOk, slug: '-x' }).ok).toBe(false);
    expect(validarFichaWeb({ ...fichaOk, estado: 'archivado' }).ok).toBe(false);
    expect(validarFichaWeb({ ...fichaOk, descripcion: 'hola <script>alert(1)</script>' }).ok).toBe(false);
    expect(validarFichaWeb({ ...fichaOk, extra: 1 }).ok).toBe(false);
    expect(validarFichaWeb(null).ok).toBe(false);
  });
  it('publicar exige descripción; más de 6 medios o repetidos se rechazan', () => {
    expect(validarFichaWeb({ ...fichaOk, estado: 'publicado', descripcion: '' }).ok).toBe(false);
    const siete = Array.from({ length: 7 }, (_, i) => ({ medioId: `medio-000${String(i)}`, alt: 'a' }));
    expect(validarFichaWeb({ ...fichaOk, medios: siete }).ok).toBe(false);
    const rep = [{ medioId: 'medio-0001', alt: 'a' }, { medioId: 'medio-0001', alt: 'b' }];
    expect(validarFichaWeb({ ...fichaOk, medios: rep }).ok).toBe(false);
  });
  it('acepta un signo menor en texto plano que no es una etiqueta', () => {
    expect(validarFichaWeb({ ...fichaOk, descripcion: 'Pesa <5 kg' }).ok).toBe(true);
  });
});

describe('secciones', () => {
  const base = { id: 'nosotros', titulo: 'Nosotros', visible: true };
  it('acepta bloques tipados', () => {
    const r = validarSeccion({
      ...base,
      bloques: [
        { tipo: 'texto', titulo: 'Quiénes somos', parrafos: ['Somos una tienda.'] },
        { tipo: 'imagen', medioId: 'medio-0001', alt: 'Local' },
        { tipo: 'carrusel', items: [{ medioId: 'medio-0002', alt: 'Foto' }] },
        { tipo: 'enlaces', items: [{ texto: 'WhatsApp', url: 'https://wa.me/59100000000' }] },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it('rechaza un enlace fuera de la lista blanca', () => {
    const r = validarSeccion({ ...base, bloques: [{ tipo: 'enlaces', items: [{ texto: 'Clic', url: 'javascript:alert(1)' }] }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errores.join(' ')).toContain('lista blanca');
  });
  it('rechaza HTML libre, bloques desconocidos y campos extra', () => {
    expect(validarSeccion({ ...base, bloques: [{ tipo: 'html', contenido: '<b>x</b>' }] }).ok).toBe(false);
    expect(validarSeccion({ ...base, bloques: [{ tipo: 'texto', parrafos: ['<img src=x onerror=alert(1)>'] }] }).ok).toBe(false);
    expect(validarSeccion({ ...base, bloques: [{ tipo: 'imagen', medioId: 'medio-0001', alt: 'x', estilo: 'a' }] }).ok).toBe(false);
    expect(validarSeccion({ ...base, bloques: [{ tipo: 'imagen', medioId: 'medio-0001', alt: '' }] }).ok).toBe(false);
  });
});

describe('plantillas, configuración y carruseles', () => {
  it('hay exactamente 5 plantillas (lista cerrada)', () => {
    expect(PLANTILLAS).toHaveLength(5);
    expect(esPlantilla('cielo')).toBe(true);
    expect(esPlantilla('rosa-chicle')).toBe(false);
  });
  const cfg = { plantillaActiva: 'ambar', whatsappNovuchat: '59100000000', medicion: { ga4: 'G-ABC12345', metaPixel: '123456789012' } };
  it('valida la configuración', () => {
    expect(validarConfigSitio(cfg).ok).toBe(true);
    expect(validarConfigSitio({ ...cfg, plantillaActiva: 'otra' }).ok).toBe(false);
    expect(validarConfigSitio({ ...cfg, whatsappNovuchat: '+59100000000' }).ok).toBe(false);
    expect(validarConfigSitio({ ...cfg, medicion: { ga4: '<script>' } }).ok).toBe(false);
    expect(validarConfigSitio({ ...cfg, medicion: { otro: 'x' } }).ok).toBe(false);
  });
  it('valida el carrusel y su enlace', () => {
    const c = { plantilla: 'bosque', items: [{ medioId: 'medio-0001', alt: 'a', enlace: '/catalogo' }] };
    expect(validarCarrusel(c).ok).toBe(true);
    expect(validarCarrusel({ ...c, items: [{ medioId: 'medio-0001', alt: 'a', enlace: 'javascript:1' }] }).ok).toBe(false);
    expect(validarCarrusel({ plantilla: 'x', items: [] }).ok).toBe(false);
    expect(validarCarrusel({ plantilla: 'bosque', items: Array.from({ length: 9 }, () => c.items[0]) }).ok).toBe(false);
  });
});

describe('manifiesto y pantallas', () => {
  it('declara las 9 colecciones de un segmento, escritas solo por el servidor', () => {
    const rutas = manifiestoConsola.colecciones.map((c) => c.ruta).sort();
    // L1-b: se suma 'reconstrucciones' (solicitudes de reconstrucción del sitio).
    expect(rutas).toEqual([
      'carruseles',
      'fichasWeb',
      'medios',
      'publicado',
      'reconstrucciones',
      'secciones',
      'sitio',
      'subidas',
      'uso',
    ]);
    expect(manifiestoConsola.colecciones.every((c) => c.escritura === 'servidor' && !c.ruta.includes('/'))).toBe(true);
    expect(manifiestoConsola.colecciones.some((c) => c.lectura.includes('caj'))).toBe(false);
  });
  it('convive con el núcleo en el registro sin rutas duplicadas', () => {
    const r = crearRegistro<ManifiestoModulo>();
    r.registrar(nucleo.manifiestoNucleo);
    r.registrar(manifiestoConsola);
    expect(() => r.rutas()).not.toThrow();
  });
  it('cada llamada de cada pantalla existe como función exportada (de la consola o del núcleo)', () => {
    const exportadas = new Set([...Object.keys(consola), ...Object.keys(nucleo)]);
    for (const p of PANTALLAS) for (const l of p.llamadas) expect(exportadas.has(l), `${p.id}: ${l}`).toBe(true);
    expect(PANTALLAS.map((p) => p.id)).toEqual(['tablero', 'productos', 'ficha', 'categorias-marcas', 'importar-exportar', 'apariencia', 'secciones', 'usuarios']);
  });
});

describe('almacenamiento de la consola', () => {
  it('declara las tres rutas de Storage con la semántica de storage.rules', () => {
    const a = manifiestoConsola.almacenamiento ?? [];
    expect(a.map((r) => r.ruta)).toEqual(['privado/originales/{productoId}/{subidaId}', 'privado/procesando/{ruta=**}', 'publico/medios/{ruta=**}']);
    const [orig, proc, pub] = a;
    expect(orig?.lectura).toBe('servidor');
    expect(orig?.escritura).toEqual({
      tipo: 'subidaReservada', roles: ['sup', 'adm'], reserva: 'subidas',
      archivos: [
        { tipo: 'foto', bytesMax: LIMITES_CONSOLA.bytesFoto, contentType: 'image/(jpeg|png|webp|heic)' },
        { tipo: 'video', bytesMax: LIMITES_CONSOLA.bytesVideo, contentType: 'video/(mp4|quicktime|webm)' },
      ],
    });
    expect(proc).toEqual({ ruta: 'privado/procesando/{ruta=**}', lectura: 'servidor', escritura: 'servidor' });
    expect(pub).toEqual({ ruta: 'publico/medios/{ruta=**}', lectura: 'publica', escritura: 'servidor' });
    expect(manifiestoConsola.colecciones.some((c) => c.ruta === 'subidas' && c.escritura === 'servidor')).toBe(true);
  });
});
