/**
 * Datos generales del negocio que muestra el sitio público: regla compartida (límites, íconos, validación y enlaces).
 * Subruta del paquete (`@novutienda/consola/negocio`): solo depende de los dos archivos hoja `errores.ts` y `validar.ts`
 * (sin importar nada más de la consola; del núcleo solo la expresión del identificador), para que el sitio pueda importarla sin arrastrar el resto.
 *
 * Los límites son los que aplica `paquetes/website/src/contenido/validar.ts` (`validarNegocio`); cada uno cita su línea. No
 * incluye `mercados`, `mercadoInicial` ni `logo` (salen del tenant y del logo por archivo) ni redes sociales.
 *
 * Dos niveles de validación:
 * - `heredado`: paridad con lo que hoy acepta el sitio (mismos límites y misma tolerancia de caracteres que su `Lector.texto`:
 *   solo largo y no ser solo blancos). Lo usan la lectura y la publicación, para no romper datos que el sitio ya acepta.
 * - `estricto`: lo de `heredado` más reglas de seguridad (sin caracteres engañosos ni HTML, correo y teléfono con forma,
 *   anfitriones sin IP, topes de categorías y de tamaño). Lo usa el guardado para lo que escribe una persona.
 */
import { LIMITES_TEXTOS_SITIO, RE_SLUG_SITIO, validarCifra, validarInstitucional, type MensajeChatTexto, type TextosInstitucionales } from '@novutienda/nucleo';
import { ErrorConsola } from './errores.js';
import { esObjeto } from './validar.js';

export type NivelNegocio = 'estricto' | 'heredado';

/** Lista cerrada de íconos (copia de `IDS_ICONO` de `website/src/contenido/tipos.ts`, líneas 16-19; el traslado definitivo se hace en S6-2). */
export const IDS_ICONO_NEGOCIO = [
  'parlante', 'microondas', 'televisor', 'lavadora', 'aire', 'congelador', 'heladera', 'cuadricula',
  'escudo', 'camion', 'mensaje', 'tendencia', 'usuario', 'check', 'pin', 'telefono', 'actualizar',
] as const;
export type IdIconoNegocio = (typeof IDS_ICONO_NEGOCIO)[number];

/** Límites del negocio; cada uno cita la línea de `website/src/contenido/validar.ts` de la que se copió. */
export const LIMITES_NEGOCIO = {
  /** línea 398 */ nombre: { min: 1, max: 80 },
  /** línea 399 */ lema: { min: 0, max: 160 },
  /** línea 402 */ telefono: { min: 6, max: 30 },
  /** línea 403 */ correo: { min: 5, max: 120 },
  /** línea 404 */ direccion: { min: 1, max: 200 },
  /** línea 405 */ horario: { min: 1, max: 200 },
  /** `LARGO_MAXIMO_MAPA` de `website/src/contenido/validar.ts` */ mapa: { max: 1000 },
  /** líneas 20 (RE_HOST) y 372-378 */ enlacesPermitidos: { max: 20, host: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/ },
  /** línea 84 */ largoEnlace: 500,
  /** líneas 302-313 */ portada: { insignia: 60, titulo: 60, lineasTitulo: 3, texto: 400, boton: 60 },
  /** líneas 315-320 */ beneficios: { max: 8, titulo: 200, descripcion: 160 },
  /** líneas 322-338 */ identidad: { etiqueta: 80, titulo: 120, texto: 1200, afirmacion: 200, valores: 6, tituloValor: 80, textoValor: 400, alt: 200, url: 500, versiones: 6, anchoMin: 16, anchoMax: 8000 },
  /** línea 412 */ textoPrivacidad: { minParrafos: 1, maxParrafos: 40, min: 1, max: 2000 },
  /**
   * líneas 18 (RE_SLUG) y 380-390. El sitio NO acota la cantidad de categorías del negocio; el tope de 40 es el que impone al
   * contenido (línea 448, `l.lista(raiz['categorias'], 'categorias', 40)`) y aquí rige solo en `estricto`.
   */
  categorias: { id: RE_SLUG_SITIO, nombre: { min: 1, max: 80 }, max: 40, orden: { min: 0, max: 39 } },
  /** Tope del documento completo (JSON canónico); el sitio no lo impone: rige solo en `estricto`. */
  documentoMax: 200_000,
  /** Correo y teléfono con forma (solo `estricto`; el sitio solo acota el largo). */
  formaCorreo: /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/,
  formaTelefono: /^\+?[0-9 ()-]{6,30}$/,
  digitosTelefono: { min: 6, max: 15 },
  /** líneas 17 (RE_ID) y 392-396; el tope es `LIMITES_SITIO.productos` (tipos.ts línea 24) */ destacados: { max: 200, id: /^[a-z0-9][a-z0-9-]{1,59}$/, largoId: 60 },
} as const;

export interface Afirmacion { readonly texto: string; readonly confirmada: boolean }
export interface PortadaNegocio {
  readonly insignia: string;
  readonly titulo: readonly [string, string, string];
  readonly texto: string;
  readonly textoBotonCatalogo: string;
  readonly textoBotonConsulta: string;
}
export interface BeneficioNegocio { readonly icono: IdIconoNegocio; readonly titulo: Afirmacion; readonly descripcion: string }
export interface CategoriaNegocio { readonly nombre: string; readonly icono: IdIconoNegocio; readonly oculta?: true; readonly orden?: number }
export interface ValorNegocio { readonly icono: IdIconoNegocio; readonly titulo: string; readonly texto: string }
/** Foto de la identidad: un medio de la consola de tipo foto. */
export interface FotoIdentidadMedio { readonly medioId: string; readonly alt: string }
/** Solo datos heredados de la siembra: dirección web. El servicio de guardado no permite escribir una nueva. */
export interface FotoIdentidadHeredada {
  readonly url: string;
  readonly alt: string;
  readonly versiones?: readonly { readonly url: string; readonly ancho: number }[];
}
export type FotoIdentidad = FotoIdentidadMedio | FotoIdentidadHeredada;
export interface IdentidadNegocio {
  readonly etiqueta: string;
  readonly titulo: string;
  readonly texto: string;
  readonly foto: FotoIdentidad | null;
  readonly cifra: { readonly valor: Afirmacion; readonly detalle: string } | null;
  readonly valores: readonly ValorNegocio[];
  readonly sello: Afirmacion;
}

/** Textos opcionales del sitio (misión, visión y chat): el tipo y los límites son los del núcleo (`LIMITES_TEXTOS_SITIO`). */
export type InstitucionalNegocio = TextosInstitucionales;
export type MensajeChatNegocio = MensajeChatTexto;

/** Los datos del negocio (campo por campo, sin versión). */
export interface NegocioSitioDatos {
  readonly nombre: string;
  readonly lema: string;
  readonly telefono: string | null;
  readonly correo: string | null;
  readonly direccion: string;
  readonly horario: string | null;
  /** Enlace de Google Maps a la tienda; ausente = el sitio no muestra «Cómo llegar». */
  readonly mapa?: string;
  readonly enlacesPermitidos: readonly string[];
  readonly portada: PortadaNegocio;
  readonly beneficios: readonly BeneficioNegocio[];
  readonly identidad: IdentidadNegocio;
  readonly textoPrivacidad: readonly string[];
  /** id de categoría → nombre e ícono. */
  /** `oculta`: sus productos no se publican; `orden`: posición en el sitio (entero 0..39). */
  readonly categorias: Readonly<Record<string, CategoriaNegocio>>;
  readonly destacados: readonly string[];
  /** Ausente = el sitio no pinta misión, visión ni chat. */
  readonly institucional?: InstitucionalNegocio;
}

/** Identificador de un medio de la consola (el mismo formato que `ID_MEDIO` de las fichas). */
export const ID_MEDIO_NEGOCIO = /^[A-Za-z0-9_-]{8,40}$/;

// ---------------------------------------------------------------------------------------------
// Enlaces (equivalente a `urlEnlaceSegura` del sitio, líneas 43-97, con el tope de 500)
// ---------------------------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex -- se buscan justamente los caracteres de control
const RE_CONTROL = /[\u0000-\u001f]/;
const esRutaPropia = (url: string): boolean => url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') && !RE_CONTROL.test(url);

/** Sin expresión regular cuadrática (ReDoS): una sola `@`, dominio con punto interior, sin espacios ni `<>"`. */
function esCorreoSimple(correo: string): boolean {
  if (correo.length === 0 || correo.length > 254 || /[\s<>"]/.test(correo)) return false;
  const arroba = correo.indexOf('@');
  if (arroba <= 0 || arroba !== correo.lastIndexOf('@')) return false;
  const dominio = correo.slice(arroba + 1);
  const punto = dominio.indexOf('.');
  return punto > 0 && punto < dominio.length - 1 && !dominio.endsWith('.');
}

/**
 * Enlace admitido en el sitio: ruta propia (`/…`, sin `//` ni `\`), `tel:`, `mailto:` o `https` a un anfitrión de `permitidos`
 * (sin credenciales); de hasta 500 caracteres. Nunca `javascript:`, `data:` ni `http:`.
 */
export function enlacePermitidoEnSitio(url: string, permitidos: readonly string[]): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > LIMITES_NEGOCIO.largoEnlace) return false;
  if (url.startsWith('/')) return esRutaPropia(url);
  if (/^tel:\+?[0-9]{6,15}$/.test(url)) return true;
  if (url.startsWith('mailto:')) return esCorreoSimple(url.slice('mailto:'.length));
  // Sin la clase `URL` (este archivo no depende de tipos de plataforma): se extrae el anfitrión a mano. Más estricto que el sitio:
  // espacios, controles y barras invertidas se rechazan (el analizador de `URL` los toleraría o los normalizaría).
  if (/[\s\\]/.test(url) || RE_CONTROL.test(url)) return false;
  const m = /^https:\/\/([^/?#]*)(?:[/?#]|$)/i.exec(url);
  if (m === null) return false;
  const autoridad = m[1] ?? '';
  if (autoridad.includes('@')) return false;
  // Puerto: el sitio (clase `URL`) rechaza más de 65535; aquí igual, para que un enlace guardado no tumbe la reconstrucción.
  const dosPuntos = autoridad.lastIndexOf(':');
  const puerto = dosPuntos >= 0 ? autoridad.slice(dosPuntos + 1) : null;
  const sinPuerto = puerto !== null && /^\d*$/.test(puerto) ? autoridad.slice(0, dosPuntos) : autoridad;
  if (puerto !== null && /^\d*$/.test(puerto) && puerto !== '' && Number(puerto) > 65535) return false;
  return permitidos.includes(sinPuerto.toLowerCase());
}

/**
 * Enlace al mapa de la tienda: https a Google Maps y a ningún otro anfitrión (`www.google.com/maps…`, `maps.google.com`,
 * `maps.app.goo.gl`, `goo.gl/maps…`), sin credenciales ni puerto, sin espacios ni controles y de hasta 1.000 caracteres.
 *
 * DUPLICADA de `urlMapaSegura` de `paquetes/website/src/contenido/validar.ts`: la consola no puede importar del sitio y el
 * núcleo no es zona de este módulo. Si cambia una, cambia la otra; `pruebas/consola/negocio.test.ts` fija los mismos casos que
 * `validar.test.ts` del sitio. Sin la clase `URL` (este archivo no depende de tipos de plataforma): es algo más estricta
 * (rechaza `:` en la autoridad aunque el puerto esté vacío, anfitriones que no vengan en minúsculas o que `URL` normalizaría,
 * toda ruta con `%2e`, `%2f` o `%5c` o con segmentos `.` o `..`, y en `maps.google.com` toda ruta fuera de la raíz y de `/maps`).
 */
export function urlMapaSegura(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0 || url.length > LIMITES_NEGOCIO.mapa.max) return false;
  if (RE_CONTROL.test(url) || /[\s\\]/.test(url)) return false;
  const m = /^https:\/\/([^/?#]*)([^?#]*)/.exec(url);
  if (m === null) return false;
  // El anfitrión debe venir ya en minúsculas (el sitio lo compara tal cual) y sin credenciales ni puerto.
  const host = m[1] ?? '';
  if (host !== host.toLowerCase() || host.includes('@') || host.includes(':')) return false;
  const ruta = (m[2] ?? '').toLowerCase();
  // Sin `.` ni `/` ni `\` codificados (`%2e`, `%2f`, `%5c`) ni segmentos `.` o `..`: permitirían salir de `/maps`.
  if (/%2e|%2f|%5c/.test(ruta) || ruta.split('/').some((x) => x === '.' || x === '..')) return false;
  const enMaps = ruta === '/maps' || ruta.startsWith('/maps/');
  switch (host) {
    case 'www.google.com':
    case 'goo.gl': return enMaps;
    // `maps.google.com` solo en la raíz o bajo `/maps` (no `/url?q=…`, que redirige fuera de Google Maps).
    case 'maps.google.com': return ruta === '' || ruta === '/' || enMaps;
    case 'maps.app.goo.gl': return true;
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------------------------

const ICONOS: readonly unknown[] = IDS_ICONO_NEGOCIO;

const ETIQUETA_HTML = /<\/?[a-zA-Z!][^>]*>/;
/** Controles C0 y C1 (incluye DEL), formatos Unicode (bidi, ancho cero, BOM…) y separadores de línea y de párrafo. */
const RE_ENGANOSO = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/**
 * Caracteres que no deben llegar a un texto del sitio escrito por una persona: controles, formatos Unicode engañosos (inversión
 * bidi U+202A–202E y U+2066–2069, ancho cero, U+FEFF) y U+2028/U+2029. En campos de varias líneas se admiten `\n` y `\t`.
 * Función propia de este archivo: no cambia `textoPlano` del resto de la consola.
 */
export function tieneCaracteresEnganosos(t: string, multilinea: boolean): boolean {
  for (const c of t) {
    if (multilinea && (c === '\n' || c === '\t')) continue;
    if (RE_ENGANOSO.test(c)) return true;
  }
  return false;
}

class Lector {
  readonly errores: string[] = [];
  constructor(readonly nivel: NivelNegocio) {}
  get estricto(): boolean { return this.nivel === 'estricto'; }
  falla(ruta: string, motivo: string): void { this.errores.push(`${ruta}: ${motivo}`); }

  /**
   * Texto de `min` a `max`. Igual que `Lector.texto` del sitio (línea 104): tipo texto, no solo blancos si `min` ≥ 1 y hasta `max`.
   * En `estricto` además sin caracteres engañosos ni etiquetas HTML.
   */
  texto(v: unknown, ruta: string, min: number, max: number, multilinea = false): string {
    if (typeof v !== 'string') { this.falla(ruta, 'debe ser texto'); return ''; }
    if (v.trim().length < min) this.falla(ruta, 'es obligatorio');
    else if (v.length > max) this.falla(ruta, `máximo ${String(max)} caracteres`);
    else if (this.estricto && tieneCaracteresEnganosos(v, multilinea)) this.falla(ruta, 'contiene caracteres de control');
    else if (this.estricto && ETIQUETA_HTML.test(v)) this.falla(ruta, 'no se admite HTML');
    else return v;
    return '';
  }
  textoONulo(v: unknown, ruta: string, min: number, max: number): string | null {
    return v === null ? null : this.texto(v, ruta, min, max);
  }
  /** Enlace de mapa opcional: ausente o `null` = sin mapa (`undefined`). */
  mapa(v: unknown, ruta: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || !urlMapaSegura(v)) {
      this.falla(ruta, 'debe ser una dirección https de Google Maps (www.google.com/maps, maps.google.com, maps.app.goo.gl o goo.gl/maps) de hasta 1.000 caracteres');
      return undefined;
    }
    return v;
  }
  obj(v: unknown, ruta: string, claves: readonly string[], ignorarDesconocidas = false): Record<string, unknown> {
    if (!esObjeto(v)) { this.falla(ruta, 'debe ser un objeto'); return {}; }
    if (!ignorarDesconocidas) {
      for (const k of Object.keys(v)) if (!claves.includes(k)) this.falla(ruta, `campo desconocido «${k}»`);
    }
    return v;
  }
  lista(v: unknown, ruta: string, max: number, min = 0): readonly unknown[] {
    if (!Array.isArray(v) || v.length > max || v.length < min) { this.falla(ruta, `debe ser una lista de ${String(min)} a ${String(max)} elementos`); return []; }
    return v;
  }
  icono(v: unknown, ruta: string): IdIconoNegocio {
    if (!ICONOS.includes(v)) { this.falla(ruta, 'ícono fuera de la lista cerrada'); return 'cuadricula'; }
    return v as IdIconoNegocio;
  }
  bool(v: unknown, ruta: string): boolean {
    if (typeof v !== 'boolean') this.falla(ruta, 'debe ser verdadero o falso');
    return v === true;
  }
}

/**
 * `institucional` opcional: presente, se valida entero con la regla única del núcleo (`validarInstitucional`: misión y visión
 * de 1 a 600; chat de 1 a 6 mensajes de 1 a 300). Aquí solo se agrega la forma (campos conocidos) y la tolerancia de caracteres.
 */
function institucional(l: Lector, v: unknown): InstitucionalNegocio | undefined {
  if (v === undefined) return undefined;
  const o = l.obj(v, 'institucional', ['mision', 'vision', 'chat']);
  const c = o['chat'] === undefined ? undefined : l.obj(o['chat'], 'institucional.chat', ['mensajes']);
  const errores = validarInstitucional(v, 'institucional');
  l.errores.push(...errores);
  if (errores.length > 0) return {};
  const L = LIMITES_TEXTOS_SITIO;
  const r: { -readonly [K in keyof InstitucionalNegocio]?: InstitucionalNegocio[K] } = {};
  if (o['mision'] !== undefined) r.mision = l.texto(o['mision'], 'institucional.mision', 1, L.texto, true);
  if (o['vision'] !== undefined) r.vision = l.texto(o['vision'], 'institucional.vision', 1, L.texto, true);
  if (c !== undefined) {
    const mensajes = l.lista(c['mensajes'], 'institucional.chat.mensajes', L.mensajes, 1).map((m, i): MensajeChatNegocio => {
      const x = l.obj(m, `institucional.chat.mensajes[${String(i)}]`, ['de', 'texto']);
      return { de: x['de'] === 'comercio' ? 'comercio' : 'cliente', texto: l.texto(x['texto'], `institucional.chat.mensajes[${String(i)}].texto`, 1, L.mensaje) };
    });
    r.chat = { mensajes };
  }
  return r;
}

function afirmacion(l: Lector, v: unknown, ruta: string): Afirmacion {
  const o = l.obj(v, ruta, ['texto', 'confirmada']);
  return { texto: l.texto(o['texto'], `${ruta}.texto`, 1, LIMITES_NEGOCIO.identidad.afirmacion), confirmada: l.bool(o['confirmada'], `${ruta}.confirmada`) };
}

/** Ruta propia o https, sin espacios, comas ni caracteres de control (la coma rompe el `srcset`); el origen lo valida el sitio. */
function urlHeredadaSegura(url: string): boolean {
  if (/[\s,\\]/.test(url) || RE_CONTROL.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  return /^https:\/\/[^/?#@]+/i.test(url);
}

function fotoIdentidad(l: Lector, v: unknown, ruta: string): FotoIdentidad | null {
  if (v === null) return null;
  const I = LIMITES_NEGOCIO.identidad;
  if (esObjeto(v) && v['url'] !== undefined) {
    const o = l.obj(v, ruta, ['url', 'alt', 'versiones'], true);
    if (v['medioId'] !== undefined) l.falla(ruta, 'campo desconocido «medioId»');
    const url = l.texto(o['url'], `${ruta}.url`, 1, I.url);
    if (url !== '' && !urlHeredadaSegura(url)) l.falla(`${ruta}.url`, 'debe ser una ruta propia o una dirección https');
    const alt = l.texto(o['alt'], `${ruta}.alt`, 1, I.alt);
    if (o['versiones'] === undefined) return { url, alt };
    const versiones = l.lista(o['versiones'], `${ruta}.versiones`, I.versiones).map((x, i) => {
      const w = l.obj(x, `${ruta}.versiones[${String(i)}]`, ['url', 'ancho'], true);
      const u = l.texto(w['url'], `${ruta}.versiones[${String(i)}].url`, 1, I.url);
      if (u !== '' && !urlHeredadaSegura(u)) l.falla(`${ruta}.versiones[${String(i)}].url`, 'debe ser una ruta propia o una dirección https');
      const a = w['ancho'];
      if (typeof a !== 'number' || !Number.isFinite(a) || a < I.anchoMin || a > I.anchoMax) l.falla(`${ruta}.versiones[${String(i)}].ancho`, `debe ser un número entre ${String(I.anchoMin)} y ${String(I.anchoMax)}`);
      return { url: u, ancho: typeof a === 'number' ? a : I.anchoMin };
    });
    return { url, alt, versiones };
  }
  const o = l.obj(v, ruta, ['medioId', 'alt']);
  const id = o['medioId'];
  if (typeof id !== 'string' || !ID_MEDIO_NEGOCIO.test(id)) l.falla(`${ruta}.medioId`, 'inválido');
  return { medioId: typeof id === 'string' ? id : '', alt: l.texto(o['alt'], `${ruta}.alt`, 1, I.alt) };
}

/** La clave `mapa` solo existe si hay valor: sin mapa el negocio queda idéntico al de antes. */
const conMapa = (m: string | undefined): { mapa?: string } => (m === undefined ? {} : { mapa: m });

export const CAMPOS_NEGOCIO = [
  'nombre', 'lema', 'telefono', 'correo', 'direccion', 'horario', 'mapa', 'enlacesPermitidos', 'portada', 'beneficios',
  'identidad', 'textoPrivacidad', 'categorias', 'destacados', 'institucional',
] as const;

/** Claves de primer nivel de la siembra que el servicio no guarda: en `heredado` se ignoran en silencio (el sitio las usa de `config`). */
const CLAVES_IGNORADAS_HEREDADO = ['mercados', 'mercadoInicial', 'logo', 'whatsappTienda'] as const;

export interface EvaluacionNegocio {
  /** `null` si hay errores. */
  readonly negocio: NegocioSitioDatos | null;
  /** `ruta: motivo`; nombran el campo, nunca su valor. */
  readonly errores: readonly string[];
}

/** Campo de primer nivel al que pertenece un error (`categorias[0]` → `categorias`); `negocio` si es del documento entero. */
export function campoDeError(error: string): string {
  const ruta = error.split(': ')[0] ?? '';
  return /^[A-Za-z]+/.exec(ruta)?.[0] ?? 'negocio';
}

/** Rutas de campo (sin motivo ni valores) de una lista de errores, sin repetir. */
export function rutasDeErrores(errores: readonly string[]): string[] {
  return [...new Set(errores.map((e) => e.split(': ')[0] ?? ''))];
}

/**
 * Valida y normaliza los datos del negocio sin lanzar. `heredado` = paridad con el sitio (ignora en silencio las claves
 * `mercados`, `mercadoInicial`, `logo` y `whatsappTienda`, que no se guardan; toda otra clave desconocida se rechaza, salvo dentro
 * de la foto heredada). `estricto` = `heredado` más caracteres, forma de correo y teléfono, anfitriones sin IP y topes.
 */
export function evaluarNegocioSitio(entrada: unknown, nivel: NivelNegocio): EvaluacionNegocio {
  const l = new Lector(nivel);
  const L = LIMITES_NEGOCIO;
  const sinIgnoradas = nivel === 'heredado' && esObjeto(entrada) && CLAVES_IGNORADAS_HEREDADO.some((k) => k in entrada)
    ? Object.fromEntries(Object.entries(entrada).filter(([k]) => !(CLAVES_IGNORADAS_HEREDADO as readonly string[]).includes(k)))
    : entrada;
  const o = l.obj(sinIgnoradas, 'negocio', CAMPOS_NEGOCIO);
  const nulo = (k: string): boolean => o[k] === null;
  /** Teléfono y correo: en `estricto` además deben tener forma (el sitio solo acota el largo). */
  const contacto = (k: 'telefono' | 'correo', min: number, max: number): string => {
    const antes = l.errores.length;
    const t = l.texto(o[k], k, min, max);
    if (!l.estricto || l.errores.length > antes) return t;
    if (k === 'correo' && !L.formaCorreo.test(t)) l.falla(k, 'no tiene la forma de un correo (usuario@dominio.ext)');
    if (k === 'telefono') {
      const digitos = t.replace(/[^0-9]/g, '').length;
      if (!L.formaTelefono.test(t) || digitos < L.digitosTelefono.min || digitos > L.digitosTelefono.max) l.falla(k, 'debe ser un número de 6 a 15 dígitos (admite +, espacios, paréntesis y guiones)');
    }
    return t;
  };

  const enlacesPermitidos = l.lista(o['enlacesPermitidos'], 'enlacesPermitidos', L.enlacesPermitidos.max).flatMap((h, i) => {
    if (typeof h !== 'string' || !L.enlacesPermitidos.host.test(h)) { l.falla(`enlacesPermitidos[${String(i)}]`, 'debe ser un nombre de anfitrión'); return []; }
    if (l.estricto && (h === 'localhost' || /^[0-9]+$/.test(h.slice(h.lastIndexOf('.') + 1)))) {
      l.falla(`enlacesPermitidos[${String(i)}]`, 'no se admite una dirección IP ni localhost');
      return [];
    }
    return [h];
  });

  const por = l.obj(o['portada'], 'portada', ['insignia', 'titulo', 'texto', 'textoBotonCatalogo', 'textoBotonConsulta']);
  const tit = l.lista(por['titulo'], 'portada.titulo', L.portada.lineasTitulo, L.portada.lineasTitulo).map((t, i) => l.texto(t, `portada.titulo[${String(i)}]`, 1, L.portada.titulo));
  const portada: PortadaNegocio = {
    insignia: l.texto(por['insignia'], 'portada.insignia', 1, L.portada.insignia),
    titulo: [tit[0] ?? '', tit[1] ?? '', tit[2] ?? ''],
    texto: l.texto(por['texto'], 'portada.texto', 1, L.portada.texto, true),
    textoBotonCatalogo: l.texto(por['textoBotonCatalogo'], 'portada.textoBotonCatalogo', 1, L.portada.boton),
    textoBotonConsulta: l.texto(por['textoBotonConsulta'], 'portada.textoBotonConsulta', 1, L.portada.boton),
  };

  const beneficios = l.lista(o['beneficios'], 'beneficios', L.beneficios.max).map((b, i): BeneficioNegocio => {
    const r = `beneficios[${String(i)}]`;
    const x = l.obj(b, r, ['icono', 'titulo', 'descripcion']);
    return { icono: l.icono(x['icono'], `${r}.icono`), titulo: afirmacion(l, x['titulo'], `${r}.titulo`), descripcion: l.texto(x['descripcion'], `${r}.descripcion`, 1, L.beneficios.descripcion) };
  });

  const I = L.identidad;
  const ide = l.obj(o['identidad'], 'identidad', ['etiqueta', 'titulo', 'texto', 'foto', 'cifra', 'valores', 'sello']);
  const identidad: IdentidadNegocio = {
    etiqueta: l.texto(ide['etiqueta'], 'identidad.etiqueta', 1, I.etiqueta),
    titulo: l.texto(ide['titulo'], 'identidad.titulo', 1, I.titulo),
    texto: l.texto(ide['texto'], 'identidad.texto', 1, I.texto, true),
    foto: fotoIdentidad(l, ide['foto'], 'identidad.foto'),
    cifra: ide['cifra'] === null ? null : (() => {
      const c = l.obj(ide['cifra'], 'identidad.cifra', ['valor', 'detalle']);
      return { valor: afirmacion(l, c['valor'], 'identidad.cifra.valor'), detalle: l.texto(c['detalle'], 'identidad.cifra.detalle', 1, LIMITES_TEXTOS_SITIO.cifraDetalle) };
    })(),
    valores: l.lista(ide['valores'], 'identidad.valores', I.valores).map((x, i): ValorNegocio => {
      const r = `identidad.valores[${String(i)}]`;
      const v = l.obj(x, r, ['icono', 'titulo', 'texto']);
      return { icono: l.icono(v['icono'], `${r}.icono`), titulo: l.texto(v['titulo'], `${r}.titulo`, 1, I.tituloValor), texto: l.texto(v['texto'], `${r}.texto`, 1, I.textoValor) };
    }),
    sello: afirmacion(l, ide['sello'], 'identidad.sello'),
  };

  // La cifra del contador (valor de hasta 20 caracteres) la valida la regla única del núcleo, en ambos niveles: el sitio rechaza más.
  l.errores.push(...validarCifra(ide['cifra'], 'identidad.cifra'));

  const categorias: Record<string, CategoriaNegocio> = {};
  if (o['categorias'] !== undefined) {
    const c = esObjeto(o['categorias']) ? o['categorias'] : {};
    if (!esObjeto(o['categorias'])) l.falla('categorias', 'debe ser un objeto');
    else if (l.estricto && Object.keys(c).length > L.categorias.max) l.falla('categorias', `máximo ${String(L.categorias.max)} categorías`);
    for (const [i, [id, x]] of Object.entries(c).entries()) {
      // Una clave inválida no se copia al error: se nombra por posición.
      const r = L.categorias.id.test(id) ? `categorias.${id}` : `categorias[${String(i)}]`;
      if (!L.categorias.id.test(id)) l.falla(r, 'la clave no es un identificador válido');
      const e = l.obj(x, r, ['nombre', 'icono', 'oculta', 'orden']);
      if (e['oculta'] !== undefined && e['oculta'] !== true) l.falla(`${r}.oculta`, 'debe ser verdadero o no estar');
      const O = L.categorias.orden;
      if (e['orden'] !== undefined && !(typeof e['orden'] === 'number' && Number.isInteger(e['orden']) && e['orden'] >= O.min && e['orden'] <= O.max)) {
        l.falla(`${r}.orden`, `debe ser un entero de ${String(O.min)} a ${String(O.max)}`);
      }
      categorias[id] = {
        nombre: l.texto(e['nombre'], `${r}.nombre`, L.categorias.nombre.min, L.categorias.nombre.max), icono: l.icono(e['icono'], `${r}.icono`),
        ...(e['oculta'] === true ? { oculta: true as const } : {}),
        ...(typeof e['orden'] === 'number' && Number.isInteger(e['orden']) && e['orden'] >= O.min && e['orden'] <= O.max ? { orden: e['orden'] } : {}),
      };
    }
  }
  const destacados = o['destacados'] === undefined ? [] : l.lista(o['destacados'], 'destacados', L.destacados.max).map((d, i) => {
    const id = l.texto(d, `destacados[${String(i)}]`, 1, L.destacados.largoId);
    if (id !== '' && !L.destacados.id.test(id)) l.falla(`destacados[${String(i)}]`, 'identificador inválido');
    return id;
  });

  const negocio: NegocioSitioDatos = {
    nombre: l.texto(o['nombre'], 'nombre', L.nombre.min, L.nombre.max),
    lema: l.texto(o['lema'], 'lema', L.lema.min, L.lema.max),
    telefono: nulo('telefono') ? null : contacto('telefono', L.telefono.min, L.telefono.max),
    correo: nulo('correo') ? null : contacto('correo', L.correo.min, L.correo.max),
    direccion: l.texto(o['direccion'], 'direccion', L.direccion.min, L.direccion.max),
    horario: l.textoONulo(o['horario'], 'horario', L.horario.min, L.horario.max),
    ...conMapa(l.mapa(o['mapa'], 'mapa')),
    enlacesPermitidos,
    portada,
    beneficios,
    identidad,
    textoPrivacidad: l.lista(o['textoPrivacidad'], 'textoPrivacidad', L.textoPrivacidad.maxParrafos, L.textoPrivacidad.minParrafos)
      .map((p, i) => l.texto(p, `textoPrivacidad[${String(i)}]`, L.textoPrivacidad.min, L.textoPrivacidad.max, true)),
    categorias,
    destacados,
    ...(o['institucional'] === undefined ? {} : { institucional: institucional(l, o['institucional']) ?? {} }),
  };
  if (l.estricto && l.errores.length === 0 && canonico(negocio).length > L.documentoMax) l.falla('negocio', `el documento supera ${String(L.documentoMax)} caracteres`);
  return { negocio: l.errores.length > 0 ? null : negocio, errores: l.errores };
}

/**
 * Valida los datos del negocio al `nivel` indicado. Lanza `ErrorConsola('entrada-invalida')` con la lista completa de errores,
 * que nombran la RUTA de cada campo inválido (nunca su valor).
 */
export function validarNegocioSitio(entrada: unknown, opciones: { readonly nivel: NivelNegocio }): NegocioSitioDatos {
  const { negocio, errores } = evaluarNegocioSitio(entrada, opciones.nivel);
  if (negocio === null) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', errores);
  return negocio;
}

/** JSON con las claves ordenadas: dos valores iguales dan el mismo texto sin importar el orden de sus claves (Firestore las ordena). */
export function canonico(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => (esObjeto(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** Nombres de los campos de primer nivel que difieren entre dos negocios (para la auditoría: nunca los valores). */
export function camposCambiados(antes: NegocioSitioDatos | null, despues: NegocioSitioDatos): string[] {
  if (antes === null) return [...CAMPOS_NEGOCIO];
  return CAMPOS_NEGOCIO.filter((k) => canonico(antes[k]) !== canonico(despues[k]));
}
