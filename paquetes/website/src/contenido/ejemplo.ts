/**
 * CONTENIDO DE EJEMPLO. Todo lo que hay aquí es inventado: nombres, marcas,
 * precios, teléfonos e identificadores de medición no corresponden a ningún
 * negocio real. Sirve para construir y probar el sitio sin datos de un cliente.
 * Un cliente real entrega su contenido por la reconstrucción (ver `cargar.ts`).
 */
import type { Contenido, Foto, IdPlantilla, Producto } from './tipos.js';

const foto = (n: number, alt: string): Foto => ({ url: `/ejemplo/producto-${n}.svg`, alt });
const hero = (n: number, alt: string): Foto => ({ url: `/ejemplo/carrusel-${n}.svg`, alt });

const base = {
  disponible: true,
  video: null,
  destacado: false,
  seo: {},
} as const;

const productos: readonly Producto[] = [
  {
    ...base, id: 'ejemplo-tv-55', slug: 'televisor-ejemplo-55', nombre: 'Televisor de ejemplo 55"', categoria: 'televisores', marca: 'Aurora',
    descripcion: 'EJEMPLO. Televisor inventado para probar el sitio. Pantalla de 55 pulgadas, resolución 4K y aplicaciones de transmisión incluidas.',
    garantia: '12 meses (ejemplo)', precioUsd: { BO: 450, AR: 480 }, destacado: true,
    fotos: [foto(1, 'Televisor de ejemplo, vista frontal'), foto(2, 'Televisor de ejemplo, vista lateral'), foto(3, 'Televisor de ejemplo, conexiones')],
    video: { url: '/ejemplo/video-ejemplo.mp4', poster: '/ejemplo/producto-1.svg', titulo: 'Video de ejemplo del televisor' },
  },
  {
    ...base, id: 'ejemplo-tv-65', slug: 'televisor-ejemplo-65', nombre: 'Televisor de ejemplo 65"', categoria: 'televisores', marca: 'Aurora',
    descripcion: 'EJEMPLO. Televisor inventado de 65 pulgadas. Producto con precio a consultar para probar ese estado.',
    garantia: '12 meses (ejemplo)', precioUsd: { BO: 0, AR: 0 }, disponible: false, fotos: [foto(1, 'Televisor de ejemplo de 65 pulgadas')],
  },
  {
    ...base, id: 'ejemplo-tv-43', slug: 'televisor-ejemplo-43', nombre: 'Televisor de ejemplo 43"', categoria: 'televisores', marca: 'Nórdika',
    descripcion: 'EJEMPLO. Televisor inventado de 43 pulgadas, ideal para dormitorios.', garantia: '6 meses (ejemplo)', precioUsd: { BO: 280, AR: 300 },
    fotos: [foto(2, 'Televisor de ejemplo de 43 pulgadas')],
  },
  {
    ...base, id: 'ejemplo-lavadora-9', slug: 'lavadora-ejemplo-9-kg', nombre: 'Lavadora de ejemplo 9 kg', categoria: 'lavadoras', marca: 'Nórdika',
    descripcion: 'EJEMPLO. Lavadora inventada de carga superior con capacidad de 9 kilos y varios programas de lavado.',
    garantia: '24 meses (ejemplo)', precioUsd: { BO: 320, AR: 340 }, destacado: true, fotos: [foto(4, 'Lavadora de ejemplo de carga superior')],
  },
  {
    ...base, id: 'ejemplo-lavadora-15', slug: 'lavadora-ejemplo-15-kg', nombre: 'Lavadora de ejemplo 15 kg', categoria: 'lavadoras', marca: 'Vektor',
    descripcion: 'EJEMPLO. Lavadora inventada de gran capacidad para familias numerosas.', garantia: '24 meses (ejemplo)',
    precioUsd: { BO: 540, AR: 560 }, disponible: false, fotos: [foto(4, 'Lavadora de ejemplo de 15 kilos')],
  },
  {
    ...base, id: 'ejemplo-heladera-300', slug: 'heladera-ejemplo-300-l', nombre: 'Heladera de ejemplo 300 L', categoria: 'heladeras', marca: 'Vektor',
    descripcion: 'EJEMPLO. Heladera inventada con congelador superior y estantes regulables.', garantia: '12 meses (ejemplo)',
    precioUsd: { BO: 410, AR: 430 }, destacado: true, fotos: [foto(5, 'Heladera de ejemplo con congelador superior')],
  },
  {
    ...base, id: 'ejemplo-heladera-450', slug: 'heladera-ejemplo-450-l', nombre: 'Heladera de ejemplo 450 L', categoria: 'heladeras', marca: 'Aurora',
    descripcion: 'EJEMPLO. Heladera inventada de dos puertas con dispensador de agua.', garantia: '12 meses (ejemplo)',
    precioUsd: { BO: 690, AR: 720 }, fotos: [foto(5, 'Heladera de ejemplo de dos puertas')],
  },
  {
    ...base, id: 'ejemplo-aire-12000', slug: 'aire-ejemplo-12000-btu', nombre: 'Aire acondicionado de ejemplo 12.000 BTU', categoria: 'aires', marca: 'Lumina',
    descripcion: 'EJEMPLO. Aire acondicionado inventado, frío y calor, con modo ahorro.', garantia: '18 meses (ejemplo)',
    precioUsd: { BO: 380, AR: 400 }, destacado: true, fotos: [foto(6, 'Aire acondicionado de ejemplo tipo split')],
  },
  {
    ...base, id: 'ejemplo-aire-18000', slug: 'aire-ejemplo-18000-btu', nombre: 'Aire acondicionado de ejemplo 18.000 BTU', categoria: 'aires', marca: 'Lumina',
    descripcion: 'EJEMPLO. Aire acondicionado inventado para ambientes grandes.', garantia: '18 meses (ejemplo)',
    precioUsd: { BO: 520, AR: 545 }, fotos: [foto(6, 'Aire acondicionado de ejemplo de 18.000 BTU')],
  },
  {
    ...base, id: 'ejemplo-parlante-1', slug: 'parlante-ejemplo-portatil', nombre: 'Parlante portátil de ejemplo', categoria: 'parlantes', marca: 'Nórdika',
    descripcion: 'EJEMPLO. Parlante inventado con Bluetooth, luces y batería de larga duración.', garantia: null,
    precioUsd: { BO: 90, AR: 95 }, fotos: [foto(3, 'Parlante portátil de ejemplo')],
  },
];

const carrusel = (orden: readonly number[]): readonly Foto[] =>
  orden.map((n) => hero(n, `Imagen de ejemplo ${n} del carrusel de la portada`));

const carruseles: Readonly<Record<IdPlantilla, readonly Foto[]>> = {
  cielo: carrusel([1, 2, 3]),
  bosque: carrusel([2, 3, 4]),
  ambar: carrusel([3, 4, 5]),
  grafito: carrusel([4, 5, 1]),
  ciruela: carrusel([5, 1, 2]),
};

export const contenidoEjemplo: Contenido = {
  config: {
    nombre: 'Tienda de Ejemplo',
    lema: 'Contenido de ejemplo para probar el sitio',
    logo: { url: '/ejemplo/logo.svg', alt: 'Logotipo de la tienda de ejemplo' },
    origen: 'https://ejemplo.invalid',
    plantilla: 'cielo',
    whatsappNovuchat: '59100000001',
    whatsappTienda: '59100000002',
    telefono: '+591 00000000',
    correo: 'contacto@ejemplo.invalid',
    direccion: 'Calle Ficticia 123, Ciudad de Ejemplo',
    horario: 'Lunes a sábado, de 9:00 a 19:00 (ejemplo)',
    mercados: ['BO', 'AR'],
    mercadoInicial: 'BO',
    // Política de redondeo de EJEMPLO: la real la decide el negocio.
    redondeo: {
      BOB: { tipo: 'decimales', decimales: 0, modo: 'arriba' },
      ARS: { tipo: 'multiplo', multiplo: 1000, modo: 'arriba' },
    },
    medicion: { google: 'G-EJEMPLO00', searchConsole: null, meta: '1234567890123456', tiktok: 'CEJEMPLO0000EJEMPLO' },
    recaptchaSiteKey: 'EJEMPLO-clave-recaptcha',
    origenMedios: null,
    enlacesPermitidos: ['www.ejemplo.invalid'],
    textoPrivacidad: [
      'EJEMPLO: este texto no es una política real. El negocio debe redactar la suya antes de publicar.',
      'Usamos tus datos de contacto solo para responder tu consulta. No los vendemos ni los compartimos con terceros ajenos a la atención.',
      'La medición de Google, Meta y TikTok solo se activa si tú lo aceptas en el aviso de cookies. Puedes cambiar tu decisión cuando quieras.',
    ],
    esEjemplo: true,
  },
  portada: {
    insignia: 'CONTENIDO DE EJEMPLO',
    titulo: ['TECNOLOGÍA QUE', 'CONECTA TU ', 'HOGAR.'],
    texto: 'Electrodomésticos de las mejores marcas. Coordina tu compra directamente con nosotros. (Texto de ejemplo.)',
    textoBotonCatalogo: 'VER CATÁLOGO DE PRODUCTOS',
    textoBotonConsulta: 'HACER UNA CONSULTA',
  },
  beneficios: [
    { icono: 'check', titulo: { texto: 'PRODUCTOS ORIGINALES', confirmada: false }, descripcion: 'Garantía oficial y marcas líderes.' },
    { icono: 'tendencia', titulo: { texto: 'ENVÍOS COORDINADOS', confirmada: true }, descripcion: 'Coordinamos la entrega según tu ubicación.' },
    { icono: 'usuario', titulo: { texto: 'COMPRA ASESORADA', confirmada: true }, descripcion: 'Asesoramiento y pedidos rápidos por WhatsApp.' },
    { icono: 'mensaje', titulo: { texto: 'ATENCIÓN EN DOS PAÍSES', confirmada: true }, descripcion: 'Atención personalizada con líneas locales.' },
  ],
  categorias: [
    { id: 'televisores', nombre: 'Televisores', icono: 'televisor' },
    { id: 'lavadoras', nombre: 'Lavadoras', icono: 'lavadora' },
    { id: 'heladeras', nombre: 'Heladeras y refrigeradores', icono: 'heladera' },
    { id: 'aires', nombre: 'Aires acondicionados', icono: 'aire' },
    { id: 'parlantes', nombre: 'Parlantes', icono: 'parlante' },
  ],
  marcas: ['Aurora', 'Nórdika', 'Vektor', 'Lumina'],
  identidad: {
    etiqueta: 'NUESTRA IDENTIDAD Y VALORES',
    titulo: 'CONOCE NUESTRA HISTORIA',
    texto: 'EJEMPLO. Somos una tienda inventada para probar el sitio. Aquí el negocio cuenta quién es y cómo atiende a sus clientes.',
    foto: hero(1, 'Fachada de ejemplo de la tienda'),
    cifra: { valor: { texto: 'Más de 1.000', confirmada: false }, detalle: 'CLIENTES SATISFECHOS' },
    valores: [
      { icono: 'escudo', titulo: 'Confianza', texto: 'Ejemplo: te acompañamos antes y después de tu compra.' },
      { icono: 'camion', titulo: 'Entregas', texto: 'Ejemplo: coordinamos el envío contigo.' },
    ],
    sello: { texto: 'CALIDAD, GARANTÍA Y RESPALDO EN NUESTROS PRODUCTOS.', confirmada: false },
  },
  productos,
  secciones: [
    {
      id: 'como-comprar', slug: 'como-comprar', titulo: 'Cómo comprar', orden: 1,
      bloques: [
        { tipo: 'texto', titulo: 'Compra en tres pasos', parrafos: ['Elige tu producto.', 'Pulsa «Comprar» para abrir el chat de WhatsApp con el mensaje listo.', 'Coordina el pago y la entrega con el asistente.'] },
        { tipo: 'enlaces', titulo: 'Más información', items: [{ texto: 'Ver el catálogo', url: '/productos' }, { texto: 'Contacto', url: '/contacto' }] },
      ],
    },
    {
      id: 'garantia', slug: 'garantia', titulo: 'Garantía', orden: 2,
      bloques: [{ tipo: 'texto', parrafos: ['EJEMPLO. Aquí el negocio explica las condiciones de su garantía.'] }],
    },
  ],
  carruseles,
};
