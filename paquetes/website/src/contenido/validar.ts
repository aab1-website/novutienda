/**
 * Validación del contenido en el borde: lo que llega de la reconstrucción (o del
 * archivo de ejemplo) se comprueba antes de generar una sola página. Un contenido
 * inválido detiene el build con la lista completa de errores, no solo el primero.
 */
import { motivoReglaRedondeoInvalida } from '@novutienda/nucleo';
import type { Mercado } from '@novutienda/nucleo';
import {
  IDS_ICONO, IDS_PLANTILLA, LIMITES_SITIO,
  type Beneficio, type Bloque, type Contenido, type Foto, type IdIcono, type IdPlantilla, type Identidad, type NegocioSitio, type Portada, type Producto, type Seccion,
} from './tipos.js';

export type ResultadoValidacion =
  | { readonly ok: true; readonly contenido: Contenido }
  | { readonly ok: false; readonly errores: readonly string[] };

const RE_ID = /^[a-z0-9][a-z0-9-]{1,59}$/;
const RE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const RE_WA = /^[1-9]\d{7,14}$/;
const RE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Formato de los identificadores de medición: se interpolan en URL, así que se acotan al máximo. */
export const FORMATO_ID_MEDICION = {
  google: /^(G|AW|GT)-[A-Z0-9]{4,20}$/,
  searchConsole: /^[A-Za-z0-9_-]{20,100}$/,
  meta: /^\d{8,20}$/,
  tiktok: /^[A-Z0-9]{10,30}$/,
} as const;
const RE_RECAPTCHA = /^[A-Za-z0-9_-]{10,80}$/;
const FORMATO_APP_CHECK = {
  claveSitio: RE_RECAPTCHA,
  apiKey: /^[A-Za-z0-9_-]{20,80}$/,
  appId: /^\d{1,20}:\d{1,20}:web:[A-Za-z0-9]{8,40}$/,
  projectId: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
} as const;

type Obj = Readonly<Record<string, unknown>>;
const esObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

// eslint-disable-next-line no-control-regex -- se buscan justamente los caracteres de control
const RE_CONTROL = /[\u0000-\u001f]/;
/** Ruta del propio sitio: empieza con una sola barra y no trae barras invertidas ni caracteres de control. */
const esRutaPropia = (url: string): boolean => url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') && !RE_CONTROL.test(url);

/** Orígenes https (o http://localhost en desarrollo) sin ruta ni credenciales. */
export function origenValido(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  try {
    const u = new URL(x);
    const esLocal = u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    return (u.protocol === 'https:' || esLocal) && u.origin === x && u.username === '' && u.password === '';
  } catch {
    return false;
  }
}

/** Una URL de medio es segura si es una ruta propia (`/…`) o cuelga de un origen declarado. */
export function urlMedioSegura(url: string, origenes: readonly (string | null)[]): boolean {
  if (/[\s,]/.test(url)) return false; // una coma o un espacio rompe el `srcset`
  if (url.startsWith('/')) return esRutaPropia(url);
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && origenes.some((o) => o !== null && o === u.origin);
  } catch {
    return false;
  }
}

/**
 * `usuario@dominio.tld` sin espacios ni `<>"`, con una sola `@` y un punto interior en el dominio.
 * Sin expresión regular: la entrada es contenido editable y un patrón con varios `+` adyacentes
 * a `.` es cuadrático (ReDoS).
 */
function esCorreoSimple(correo: string): boolean {
  if (correo.length === 0 || correo.length > 254 || /[\s<>"]/.test(correo)) return false;
  const arroba = correo.indexOf('@');
  if (arroba <= 0 || arroba !== correo.lastIndexOf('@')) return false;
  const dominio = correo.slice(arroba + 1);
  const punto = dominio.indexOf('.');
  return punto > 0 && punto < dominio.length - 1 && !dominio.endsWith('.');
}

/** Largo máximo de un enlace de las secciones editables y de las fotos de carrusel. */
export const LARGO_MAXIMO_ENLACE = 500;

/** Enlaces de las secciones editables: ruta propia, tel:, mailto: o https a un anfitrión de la lista blanca. */
export function urlEnlaceSegura(url: string, permitidos: readonly string[]): boolean {
  if (url.startsWith('/')) return esRutaPropia(url);
  if (/^tel:\+?[0-9]{6,15}$/.test(url)) return true;
  if (url.startsWith('mailto:')) return esCorreoSimple(url.slice('mailto:'.length));
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.username === '' && u.password === '' && permitidos.includes(u.hostname);
  } catch {
    return false;
  }
}

class Lector {
  readonly errores: string[] = [];
  falla(ruta: string, motivo: string): void {
    this.errores.push(`${ruta}: ${motivo}`);
  }
  texto(v: unknown, ruta: string, min = 1, max = 500): string {
    if (typeof v !== 'string' || v.trim().length < min || v.length > max) {
      this.falla(ruta, `debe ser texto de ${min} a ${max} caracteres`);
      return '';
    }
    return v;
  }
  textoONulo(v: unknown, ruta: string, max = 500): string | null {
    return v === null ? null : this.texto(v, ruta, 1, max);
  }
  bool(v: unknown, ruta: string): boolean {
    if (typeof v !== 'boolean') this.falla(ruta, 'debe ser verdadero o falso');
    return v === true;
  }
  numero(v: unknown, ruta: string, min: number, max: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      this.falla(ruta, `debe ser un número entre ${min} y ${max}`);
      return min;
    }
    return v;
  }
  lista(v: unknown, ruta: string, max: number, min = 0): readonly unknown[] {
    if (!Array.isArray(v) || v.length > max || v.length < min) {
      this.falla(ruta, `debe ser una lista de ${min} a ${max} elementos`);
      return [];
    }
    return v;
  }
  obj(v: unknown, ruta: string): Obj {
    if (!esObj(v)) {
      this.falla(ruta, 'debe ser un objeto');
      return {};
    }
    return v;
  }
  icono(v: unknown, ruta: string): IdIcono {
    if (!IDS_ICONO.includes(v as IdIcono)) {
      this.falla(ruta, `ícono fuera de la lista cerrada (${IDS_ICONO.join(', ')})`);
      return 'cuadricula';
    }
    return v as IdIcono;
  }
}

function leerFoto(l: Lector, v: unknown, ruta: string, origenes: readonly (string | null)[], enlacesPermitidos?: readonly string[]): Foto {
  const f = leerFotoBase(l, v, ruta, origenes);
  if (enlacesPermitidos === undefined || !esObj(v) || v['enlace'] === undefined || v['enlace'] === null) return f;
  // Enlace de una foto de carrusel: misma regla que los enlaces de las secciones (ruta propia, tel:, mailto: o https de la lista blanca).
  const enlace = l.texto(v['enlace'], `${ruta}.enlace`, 1, LARGO_MAXIMO_ENLACE);
  if (enlace === '') return f;
  if (!urlEnlaceSegura(enlace, enlacesPermitidos)) { l.falla(`${ruta}.enlace`, 'enlace fuera de la lista blanca'); return f; }
  return { ...f, enlace };
}

function leerFotoBase(l: Lector, v: unknown, ruta: string, origenes: readonly (string | null)[]): Foto {
  const o = l.obj(v, ruta);
  const url = l.texto(o['url'], `${ruta}.url`, 1, 500);
  if (url !== '' && !urlMedioSegura(url, origenes)) l.falla(`${ruta}.url`, 'debe ser una ruta propia o un origen de medios declarado');
  const alt = l.texto(o['alt'], `${ruta}.alt`, 1, 200);
  if (o['versiones'] === undefined) return { url, alt };
  const versiones = l.lista(o['versiones'], `${ruta}.versiones`, 6).map((x, i) => {
    const w = l.obj(x, `${ruta}.versiones[${i}]`);
    const u = l.texto(w['url'], `${ruta}.versiones[${i}].url`, 1, 500);
    if (u !== '' && !urlMedioSegura(u, origenes)) l.falla(`${ruta}.versiones[${i}].url`, 'origen de medios no declarado');
    return { url: u, ancho: l.numero(w['ancho'], `${ruta}.versiones[${i}].ancho`, 16, 8000) };
  });
  return { url, alt, versiones };
}

function leerAfirmacion(l: Lector, v: unknown, ruta: string): { texto: string; confirmada: boolean } {
  const o = l.obj(v, ruta);
  return { texto: l.texto(o['texto'], `${ruta}.texto`, 1, 200), confirmada: l.bool(o['confirmada'], `${ruta}.confirmada`) };
}

function leerRegla(l: Lector, v: unknown, ruta: string): Contenido['config']['redondeo']['BOB'] {
  // D7: la validación es la única del núcleo; el valor de reemplazo solo se usa tras registrar la falla.
  const respaldo = { tipo: 'decimales', decimales: 2, modo: 'cercano' } as const;
  const motivo = motivoReglaRedondeoInvalida(v);
  if (motivo !== null) {
    l.falla(ruta, motivo);
    return respaldo;
  }
  return v as Contenido['config']['redondeo']['BOB'];
}

function leerConfig(l: Lector, v: unknown): Contenido['config'] {
  const o = l.obj(v, 'config');
  const wa = (k: string): string | null => {
    const x = o[k];
    if (x === null) return null;
    if (typeof x !== 'string' || !RE_WA.test(x)) {
      l.falla(`config.${k}`, 'debe ser null o un número solo con dígitos y código de país');
      return null;
    }
    return x;
  };
  const plantilla = IDS_PLANTILLA.find((p) => p === o['plantilla']);
  if (plantilla === undefined) l.falla('config.plantilla', `debe ser una de: ${IDS_PLANTILLA.join(', ')}`);
  const mercados = l.lista(o['mercados'], 'config.mercados', 2, 1).filter((m): m is Mercado => m === 'BO' || m === 'AR');
  if (mercados.length === 0) l.falla('config.mercados', 'debe incluir BO o AR');
  const mercadoInicial = mercados.find((m) => m === o['mercadoInicial']) ?? mercados[0] ?? 'BO';
  if (!mercados.includes(o['mercadoInicial'] as Mercado)) l.falla('config.mercadoInicial', 'debe estar entre los mercados activos');
  if (!origenValido(o['origen'])) l.falla('config.origen', 'debe ser un origen https sin ruta');
  const origenMedios = o['origenMedios'] === null || o['origenMedios'] === undefined ? null : o['origenMedios'];
  if (origenMedios !== null && !origenValido(origenMedios)) l.falla('config.origenMedios', 'debe ser un origen https sin ruta');
  const med = l.obj(o['medicion'], 'config.medicion');
  const id = (k: keyof typeof FORMATO_ID_MEDICION): string | null => {
    const x = med[k];
    if (x === null) return null;
    if (typeof x !== 'string' || !FORMATO_ID_MEDICION[k].test(x)) {
      l.falla(`config.medicion.${k}`, 'identificador con formato inválido');
      return null;
    }
    return x;
  };
  const rc = o['recaptchaSiteKey'];
  if (rc !== null && (typeof rc !== 'string' || !RE_RECAPTCHA.test(rc))) l.falla('config.recaptchaSiteKey', 'clave con formato inválido');
  const ac = o['appCheck'] === undefined || o['appCheck'] === null ? null : l.obj(o['appCheck'], 'config.appCheck');
  const appCheck = ac === null ? null : (() => {
    const campo = (k: keyof typeof FORMATO_APP_CHECK): string => {
      const x = ac[k];
      if (typeof x === 'string' && FORMATO_APP_CHECK[k].test(x)) return x;
      l.falla(`config.appCheck.${k}`, 'identificador con formato inválido');
      return '';
    };
    return { claveSitio: campo('claveSitio'), apiKey: campo('apiKey'), appId: campo('appId'), projectId: campo('projectId') };
  })();
  const permitidos = l.lista(o['enlacesPermitidos'], 'config.enlacesPermitidos', 20).map((h, i) => {
    if (typeof h !== 'string' || !RE_HOST.test(h)) {
      l.falla(`config.enlacesPermitidos[${i}]`, 'debe ser un nombre de anfitrión');
      return '';
    }
    return h;
  });
  const red = l.obj(o['redondeo'], 'config.redondeo');
  return {
    nombre: l.texto(o['nombre'], 'config.nombre', 1, 80),
    lema: l.texto(o['lema'], 'config.lema', 0, 160),
    logo: o['logo'] === null ? null : leerFoto(l, o['logo'], 'config.logo', [typeof o['origen'] === 'string' ? o['origen'] : null, typeof origenMedios === 'string' ? origenMedios : null]),
    origen: typeof o['origen'] === 'string' ? o['origen'] : '',
    plantilla: plantilla ?? 'cielo',
    whatsappNovuchat: wa('whatsappNovuchat'),
    whatsappTienda: wa('whatsappTienda'),
    telefono: o['telefono'] === null ? null : l.texto(o['telefono'], 'config.telefono', 6, 30),
    correo: o['correo'] === null ? null : l.texto(o['correo'], 'config.correo', 5, 120),
    direccion: l.texto(o['direccion'], 'config.direccion', 1, 200),
    horario: l.textoONulo(o['horario'], 'config.horario', 200),
    mercados,
    mercadoInicial,
    redondeo: { BOB: leerRegla(l, red['BOB'], 'config.redondeo.BOB'), ARS: leerRegla(l, red['ARS'], 'config.redondeo.ARS') },
    medicion: { google: id('google'), searchConsole: id('searchConsole'), meta: id('meta'), tiktok: id('tiktok') },
    recaptchaSiteKey: typeof rc === 'string' && RE_RECAPTCHA.test(rc) ? rc : null,
    appCheck,
    origenMedios: typeof origenMedios === 'string' ? origenMedios : null,
    enlacesPermitidos: permitidos.filter((h) => h !== ''),
    textoPrivacidad: l.lista(o['textoPrivacidad'], 'config.textoPrivacidad', 40, 1).map((p, i) => l.texto(p, `config.textoPrivacidad[${i}]`, 1, 2000)),
    esEjemplo: l.bool(o['esEjemplo'], 'config.esEjemplo'),
  };
}

function leerBloque(l: Lector, v: unknown, ruta: string, cfg: Contenido['config'], origenes: readonly (string | null)[]): Bloque {
  const o = l.obj(v, ruta);
  const titulo = o['titulo'] === undefined ? undefined : l.texto(o['titulo'], `${ruta}.titulo`, 1, 120);
  switch (o['tipo']) {
    case 'texto':
      return { tipo: 'texto', ...(titulo !== undefined ? { titulo } : {}), parrafos: l.lista(o['parrafos'], `${ruta}.parrafos`, 20, 1).map((p, i) => l.texto(p, `${ruta}.parrafos[${i}]`, 1, 3000)) };
    case 'imagen':
      return { tipo: 'imagen', foto: leerFoto(l, o['foto'], `${ruta}.foto`, origenes) };
    case 'carrusel':
      return { tipo: 'carrusel', fotos: l.lista(o['fotos'], `${ruta}.fotos`, LIMITES_SITIO.fotosPorCarrusel, 1).map((f, i) => leerFoto(l, f, `${ruta}.fotos[${i}]`, origenes, cfg.enlacesPermitidos)) };
    case 'enlaces':
      return {
        tipo: 'enlaces',
        ...(titulo !== undefined ? { titulo } : {}),
        items: l.lista(o['items'], `${ruta}.items`, 20, 1).map((x, i) => {
          const e = l.obj(x, `${ruta}.items[${i}]`);
          const url = l.texto(e['url'], `${ruta}.items[${i}].url`, 1, 500);
          if (url !== '' && !urlEnlaceSegura(url, cfg.enlacesPermitidos)) l.falla(`${ruta}.items[${i}].url`, 'enlace fuera de la lista blanca');
          return { texto: l.texto(e['texto'], `${ruta}.items[${i}].texto`, 1, 120), url };
        }),
      };
    default:
      l.falla(`${ruta}.tipo`, 'bloque desconocido (solo texto, imagen, carrusel y enlaces; nunca HTML libre)');
      return { tipo: 'texto', parrafos: [] };
  }
}

function leerPortada(l: Lector, v: unknown): Portada {
  const por = l.obj(v, 'portada');
  const tit = l.lista(por['titulo'], 'portada.titulo', 3, 3).map((t, i) => l.texto(t, `portada.titulo[${i}]`, 1, 60));
  const portada = {
    insignia: l.texto(por['insignia'], 'portada.insignia', 1, 60),
    titulo: [tit[0] ?? '', tit[1] ?? '', tit[2] ?? ''] as const,
    texto: l.texto(por['texto'], 'portada.texto', 1, 400),
    textoBotonCatalogo: l.texto(por['textoBotonCatalogo'], 'portada.textoBotonCatalogo', 1, 60),
    textoBotonConsulta: l.texto(por['textoBotonConsulta'], 'portada.textoBotonConsulta', 1, 60),
  };
  return portada;
}

function leerBeneficios(l: Lector, v: unknown): Beneficio[] {
  return l.lista(v, 'beneficios', 8).map((b, i) => {
    const o = l.obj(b, `beneficios[${i}]`);
    return { icono: l.icono(o['icono'], `beneficios[${i}].icono`), titulo: leerAfirmacion(l, o['titulo'], `beneficios[${i}].titulo`), descripcion: l.texto(o['descripcion'], `beneficios[${i}].descripcion`, 1, 160) };
  });
}

function leerIdentidad(l: Lector, v: unknown, origenes: readonly (string | null)[]): Identidad {
  const ide = l.obj(v, 'identidad');
  const cifraCruda = ide['cifra'];
  return {
    etiqueta: l.texto(ide['etiqueta'], 'identidad.etiqueta', 1, 80),
    titulo: l.texto(ide['titulo'], 'identidad.titulo', 1, 120),
    texto: l.texto(ide['texto'], 'identidad.texto', 1, 1200),
    foto: ide['foto'] === null ? null : leerFoto(l, ide['foto'], 'identidad.foto', origenes),
    cifra: cifraCruda === null ? null : (() => {
      const c = l.obj(cifraCruda, 'identidad.cifra');
      return { valor: leerAfirmacion(l, c['valor'], 'identidad.cifra.valor'), detalle: l.texto(c['detalle'], 'identidad.cifra.detalle', 1, 120) };
    })(),
    valores: l.lista(ide['valores'], 'identidad.valores', 6).map((x, i) => {
      const o = l.obj(x, `identidad.valores[${i}]`);
      return { icono: l.icono(o['icono'], `identidad.valores[${i}].icono`), titulo: l.texto(o['titulo'], `identidad.valores[${i}].titulo`, 1, 80), texto: l.texto(o['texto'], `identidad.valores[${i}].texto`, 1, 400) };
    }),
    sello: leerAfirmacion(l, ide['sello'], 'identidad.sello'),
  };
}

/** Ejecuta un lector y antepone `negocio.` a los errores que registre, para que nombren el campo del JSON del negocio. */
function conPrefijo<T>(l: Lector, f: () => T): T {
  const antes = l.errores.length;
  const r = f();
  for (let i = antes; i < l.errores.length; i += 1) l.errores[i] = `negocio.${l.errores[i]}`;
  return r;
}

export type ResultadoNegocio =
  | { readonly ok: true; readonly negocio: NegocioSitio }
  | { readonly ok: false; readonly errores: readonly string[] };

/**
 * Valida los datos del negocio (JSON externo). `origenes` son los orígenes de medios aceptados para el logo y la foto de identidad
 * (además de rutas propias). Los errores nombran campos, nunca valores.
 */
export function validarNegocio(entrada: unknown, origenes: readonly (string | null)[] = []): ResultadoNegocio {
  const l = new Lector();
  const o = l.obj(entrada, 'negocio');
  const wa = (k: string): string | null => {
    const x = o[k];
    if (x === null) return null;
    if (typeof x !== 'string' || !RE_WA.test(x)) {
      l.falla(`negocio.${k}`, 'debe ser null o un número solo con dígitos y código de país');
      return null;
    }
    return x;
  };
  const mercados = l.lista(o['mercados'], 'negocio.mercados', 2, 1).filter((m): m is Mercado => m === 'BO' || m === 'AR');
  if (mercados.length === 0) l.falla('negocio.mercados', 'debe incluir BO o AR');
  const mercadoInicial = mercados.find((m) => m === o['mercadoInicial']) ?? mercados[0] ?? 'BO';
  if (!mercados.includes(o['mercadoInicial'] as Mercado)) l.falla('negocio.mercadoInicial', 'debe estar entre los mercados activos');
  const enlacesPermitidos = l.lista(o['enlacesPermitidos'], 'negocio.enlacesPermitidos', 20).map((h, i) => {
    if (typeof h !== 'string' || !RE_HOST.test(h)) {
      l.falla(`negocio.enlacesPermitidos[${i}]`, 'debe ser un nombre de anfitrión');
      return '';
    }
    return h;
  });
  const categorias: Record<string, { nombre: string; icono: IdIcono }> = {};
  if (o['categorias'] !== undefined) {
    const c = l.obj(o['categorias'], 'negocio.categorias');
    for (const [i, [id, x]] of Object.entries(c).entries()) {
      // Una clave inválida no se copia al error: se nombra por posición.
      const r = RE_SLUG.test(id) ? `negocio.categorias.${id}` : `negocio.categorias[${i}]`;
      if (!RE_SLUG.test(id)) l.falla(r, 'la clave no es un identificador válido');
      const e = l.obj(x, r);
      categorias[id] = { nombre: l.texto(e['nombre'], `${r}.nombre`, 1, 80), icono: l.icono(e['icono'], `${r}.icono`) };
    }
  }
  const destacados = o['destacados'] === undefined ? [] : l.lista(o['destacados'], 'negocio.destacados', LIMITES_SITIO.productos).map((d, i) => {
    const id = l.texto(d, `negocio.destacados[${i}]`, 1, 60);
    if (id !== '' && !RE_ID.test(id)) l.falla(`negocio.destacados[${i}]`, 'identificador inválido');
    return id;
  });
  const negocio: NegocioSitio = {
    nombre: l.texto(o['nombre'], 'negocio.nombre', 1, 80),
    lema: l.texto(o['lema'], 'negocio.lema', 0, 160),
    logo: o['logo'] === null ? null : leerFoto(l, o['logo'], 'negocio.logo', origenes),
    whatsappTienda: wa('whatsappTienda'),
    telefono: o['telefono'] === null ? null : l.texto(o['telefono'], 'negocio.telefono', 6, 30),
    correo: o['correo'] === null ? null : l.texto(o['correo'], 'negocio.correo', 5, 120),
    direccion: l.texto(o['direccion'], 'negocio.direccion', 1, 200),
    horario: l.textoONulo(o['horario'], 'negocio.horario', 200),
    mercados,
    mercadoInicial,
    enlacesPermitidos: enlacesPermitidos.filter((h) => h !== ''),
    portada: conPrefijo(l, () => leerPortada(l, o['portada'])),
    beneficios: conPrefijo(l, () => leerBeneficios(l, o['beneficios'])),
    identidad: conPrefijo(l, () => leerIdentidad(l, o['identidad'], origenes)),
    textoPrivacidad: l.lista(o['textoPrivacidad'], 'negocio.textoPrivacidad', 40, 1).map((p, i) => l.texto(p, `negocio.textoPrivacidad[${i}]`, 1, 2000)),
    categorias,
    destacados,
  };
  return l.errores.length > 0 ? { ok: false, errores: l.errores } : { ok: true, negocio };
}

/** Versión y fecha de la publicación de la que se compiló el sitio (opcional: el contenido de ejemplo no las trae). */
function leerPublicacion(l: Lector, v: unknown): Contenido['publicacion'] {
  if (v === undefined) return undefined;
  const o = l.obj(v, 'publicacion');
  let version: number | null = null;
  if (o['version'] !== null && o['version'] !== undefined) {
    version = l.numero(o['version'], 'publicacion.version', 0, 1_000_000_000);
    if (!Number.isInteger(version)) { l.falla('publicacion.version', 'debe ser un entero'); version = null; }
  }
  let publicadoEn: string | null = null;
  if (o['publicadoEn'] !== null && o['publicadoEn'] !== undefined) {
    publicadoEn = l.texto(o['publicadoEn'], 'publicacion.publicadoEn', 10, 40);
    if (publicadoEn !== '' && Number.isNaN(Date.parse(publicadoEn))) { l.falla('publicacion.publicadoEn', 'debe ser una fecha ISO'); publicadoEn = null; }
  }
  return { version, publicadoEn };
}

/** Valida y normaliza el contenido completo. No confía en ningún campo. */
export function validarContenido(entrada: unknown): ResultadoValidacion {
  const l = new Lector();
  const raiz = l.obj(entrada, 'contenido');
  const config = leerConfig(l, raiz['config']);
  const origenes = [config.origen, config.origenMedios];

  const portada = leerPortada(l, raiz['portada']);

  const beneficios = leerBeneficios(l, raiz['beneficios']);

  const idsCat = new Set<string>();
  const categorias = l.lista(raiz['categorias'], 'categorias', 40, 1).map((c, i) => {
    const o = l.obj(c, `categorias[${i}]`);
    const id = l.texto(o['id'], `categorias[${i}].id`, 1, 60);
    if (!RE_SLUG.test(id)) l.falla(`categorias[${i}].id`, 'identificador inválido');
    if (idsCat.has(id)) l.falla(`categorias[${i}].id`, `duplicado: ${id}`);
    idsCat.add(id);
    return { id, nombre: l.texto(o['nombre'], `categorias[${i}].nombre`, 1, 80), icono: l.icono(o['icono'], `categorias[${i}].icono`) };
  });

  const marcas = l.lista(raiz['marcas'], 'marcas', 40).map((m, i) => l.texto(m, `marcas[${i}]`, 1, 40));

  const identidad = leerIdentidad(l, raiz['identidad'], origenes);

  const ids = new Set<string>();
  const slugs = new Set<string>();
  const productos: Producto[] = l.lista(raiz['productos'], 'productos', LIMITES_SITIO.productos).map((p, i) => {
    const r = `productos[${i}]`;
    const o = l.obj(p, r);
    const id = l.texto(o['id'], `${r}.id`, 1, 60);
    if (!RE_ID.test(id)) l.falla(`${r}.id`, 'identificador inválido');
    if (ids.has(id)) l.falla(`${r}.id`, `duplicado: ${id}`);
    ids.add(id);
    const slug = l.texto(o['slug'], `${r}.slug`, 1, 80);
    if (!RE_SLUG.test(slug)) l.falla(`${r}.slug`, 'slug inválido');
    if (slugs.has(slug)) l.falla(`${r}.slug`, `duplicado: ${slug}`);
    slugs.add(slug);
    const categoria = l.texto(o['categoria'], `${r}.categoria`, 1, 60);
    if (!idsCat.has(categoria)) l.falla(`${r}.categoria`, `categoría inexistente: ${categoria}`);
    const pr = l.obj(o['precioUsd'], `${r}.precioUsd`);
    const seo = o['seo'] === undefined ? {} : l.obj(o['seo'], `${r}.seo`);
    const videoCrudo = o['video'];
    let video: Producto['video'] = null;
    if (videoCrudo !== null && videoCrudo !== undefined) {
      const v = l.obj(videoCrudo, `${r}.video`);
      const url = l.texto(v['url'], `${r}.video.url`, 1, 500);
      const poster = l.texto(v['poster'], `${r}.video.poster`, 1, 500);
      for (const [k, u] of [['url', url], ['poster', poster]] as const) {
        if (u !== '' && !urlMedioSegura(u, origenes)) l.falla(`${r}.video.${k}`, 'origen de medios no declarado');
      }
      video = { url, poster, titulo: l.texto(v['titulo'], `${r}.video.titulo`, 1, 120) };
    }
    return {
      id, slug, categoria,
      nombre: l.texto(o['nombre'], `${r}.nombre`, 1, 120),
      marca: l.texto(o['marca'], `${r}.marca`, 1, 40),
      descripcion: l.texto(o['descripcion'], `${r}.descripcion`, 1, 4000),
      garantia: l.textoONulo(o['garantia'], `${r}.garantia`, 120),
      precioUsd: { BO: l.numero(pr['BO'], `${r}.precioUsd.BO`, 0, 1_000_000), AR: l.numero(pr['AR'], `${r}.precioUsd.AR`, 0, 1_000_000) },
      disponible: l.bool(o['disponible'], `${r}.disponible`),
      fotos: l.lista(o['fotos'], `${r}.fotos`, LIMITES_SITIO.fotosPorProducto).map((f, j) => leerFoto(l, f, `${r}.fotos[${j}]`, origenes)),
      video,
      destacado: o['destacado'] === true,
      seo: {
        ...(typeof seo['titulo'] === 'string' ? { titulo: l.texto(seo['titulo'], `${r}.seo.titulo`, 1, 70) } : {}),
        ...(typeof seo['descripcion'] === 'string' ? { descripcion: l.texto(seo['descripcion'], `${r}.seo.descripcion`, 1, 200) } : {}),
      },
    };
  });

  const slugsSeccion = new Set<string>();
  const secciones: Seccion[] = l.lista(raiz['secciones'], 'secciones', LIMITES_SITIO.secciones).map((s, i) => {
    const r = `secciones[${i}]`;
    const o = l.obj(s, r);
    const slug = l.texto(o['slug'], `${r}.slug`, 1, 80);
    if (!RE_SLUG.test(slug)) l.falla(`${r}.slug`, 'slug inválido');
    if (slugsSeccion.has(slug)) l.falla(`${r}.slug`, `duplicado: ${slug}`);
    slugsSeccion.add(slug);
    return {
      id: l.texto(o['id'], `${r}.id`, 1, 60),
      slug,
      titulo: l.texto(o['titulo'], `${r}.titulo`, 1, 60),
      orden: l.numero(o['orden'], `${r}.orden`, 0, 1000),
      bloques: l.lista(o['bloques'], `${r}.bloques`, LIMITES_SITIO.bloquesPorSeccion, 1).map((b, j) => leerBloque(l, b, `${r}.bloques[${j}]`, config, origenes)),
    };
  });

  const car = l.obj(raiz['carruseles'], 'carruseles');
  const carruseles = {} as Record<IdPlantilla, readonly Foto[]>;
  for (const id of IDS_PLANTILLA) {
    carruseles[id] = l.lista(car[id], `carruseles.${id}`, LIMITES_SITIO.carruselesPorPlantilla, 1).map((f, i) => leerFoto(l, f, `carruseles.${id}[${i}]`, origenes, config.enlacesPermitidos));
  }

  const publicacion = leerPublicacion(l, raiz['publicacion']);

  if (l.errores.length > 0) return { ok: false, errores: l.errores };
  return { ok: true, contenido: { config, portada, beneficios, categorias, marcas, identidad, productos, secciones, carruseles, ...(publicacion !== undefined ? { publicacion } : {}) } };
}
