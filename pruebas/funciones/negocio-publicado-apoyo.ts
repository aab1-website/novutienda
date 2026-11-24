// Fixtures compartidos de las pruebas de `generar` y `certificar` con `publicado/negocio` (todo inventado).

// ---- negocio publicado con el mapeo real (regresión de la huella, #219) ----
export const MEDIOS_REAL = 'https://medios.example.com';
const negocioPublicado = (): Record<string, unknown> => ({
  nombre: 'Tienda de Prueba', lema: 'Lema de prueba', telefono: null, correo: null, direccion: 'Calle Ficticia 123', horario: 'Lunes a sábado',
  enlacesPermitidos: ['example.com'],
  portada: { insignia: 'PRUEBA', titulo: ['UNO', 'DOS ', 'TRES.'], texto: 'Texto de prueba.', textoBotonCatalogo: 'VER CATÁLOGO', textoBotonConsulta: 'CONSULTAR' },
  beneficios: [
    { icono: 'check', titulo: { texto: 'UNO', confirmada: true }, descripcion: 'Descripción uno.' },
    { icono: 'tendencia', titulo: { texto: 'DOS', confirmada: true }, descripcion: 'Descripción dos.' },
    { icono: 'usuario', titulo: { texto: 'TRES', confirmada: true }, descripcion: 'Descripción tres.' },
    { icono: 'mensaje', titulo: { texto: 'CUATRO', confirmada: true }, descripcion: 'Descripción cuatro.' },
  ],
  identidad: {
    etiqueta: 'IDENTIDAD', titulo: 'HISTORIA', texto: 'Texto de identidad de prueba.',
    foto: { tipo: 'foto', alt: 'Foto de prueba', ancho: 2000, alto: 1000, versiones: [{ clase: 'imagen', lado: 960, formato: 'webp', ruta: 'm/identidad/960.webp' }] },
    cifra: { valor: { texto: 'Más de 10', confirmada: true }, detalle: 'CLIENTES' },
    valores: [{ icono: 'escudo', titulo: 'Confianza', texto: 'Texto uno.' }, { icono: 'camion', titulo: 'Entregas', texto: 'Texto dos.' }],
    sello: { texto: 'SELLO DE PRUEBA.', confirmada: true },
  },
  textoPrivacidad: ['Texto de privacidad de prueba.'], categorias: {}, destacados: [], version: 3, actualizadoEn: '2026-11-23T10:00:00.000Z', por: 'uid-prueba',
});
export const publicadoReal = () => ({
  redondeo: { BOB: { tipo: 'decimales', decimales: 2, modo: 'cercano' }, ARS: { tipo: 'multiplo', multiplo: 500, modo: 'arriba' } },
  documentos: {
    sitio: { plantillaActiva: 'bosque', whatsappNovuchat: '59170000000', medicion: {}, version: 3 },
    estado: { version: 3, secciones: [], publicadoEn: '2026-11-23T10:00:00.000Z' },
    producto__p0: { id: 'p0', slug: 'p0', nombre: 'Producto de prueba', categoria: 'otros', marca: 'Marca', descripcion: 'Descripción.', garantia: '', medios: [], seo: {}, precioUSD: { bo: 100, ar: 120 } },
    negocio: negocioPublicado(),
  },
});
// Respaldo completo (sirve solo, sin `publicado/negocio`); con negocio publicado aporta únicamente las 5 claves del respaldo.
export const SECRETO_NEGOCIO = JSON.stringify({
  ...negocioPublicado(), nombre: 'Nombre Secreto', direccion: 'Dirección Secreta 1', version: undefined, actualizadoEn: undefined, por: undefined,
  identidad: { ...(negocioPublicado()['identidad'] as Record<string, unknown>), foto: null },
  mercados: ['BO', 'AR'], mercadoInicial: 'BO', logo: null, whatsappTienda: null,
});
