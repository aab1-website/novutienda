/**
 * Mapeo puro `Publicado` (respuesta firmada de `GET /api/sitio/v1/publicado`) + datos del negocio + entorno → `Contenido`.
 * No importa otros módulos: lee la respuesta como `unknown` y la valida. El resultado pasa por `validarContenido`; si algo
 * falla, el error lista campos y motivos, nunca valores (el contenido es del comercio y el log es público).
 */
import {
  IDS_PLANTILLA, LIMITES_SITIO,
  type Bloque, type Categoria, type ConfigAppCheck, type Contenido, type Foto, type IdIcono, type IdPlantilla,
  type Producto, type Seccion,
} from './tipos.js';
import { validarContenido, validarNegocio } from './validar.js';

export interface EntornoSitio {
  /** Origen público del sitio (https://…). */
  readonly origen: string;
  /** Origen público de los medios; las rutas de las versiones cuelgan de él. */
  readonly origenMedios: string;
  readonly appCheck: ConfigAppCheck | null;
  readonly recaptchaSiteKey: string | null;
  /** Por id de producto, de `/api/disponibilidad`; ausente = no disponible. */
  readonly disponibilidad: Readonly<Record<string, boolean>>;
}

export class ErrorContenidoPublicado extends Error {
  constructor(readonly errores: readonly string[]) {
    super(`Contenido publicado inválido:\n - ${errores.join('\n - ')}`);
    this.name = 'ErrorContenidoPublicado';
  }
}

type Obj = Readonly<Record<string, unknown>>;
const esObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const lista = (x: unknown): readonly unknown[] => (Array.isArray(x) ? x : []);
const cadena = (x: unknown): string => (typeof x === 'string' ? x : '');

interface VersionMedio { readonly clase: string; readonly lado: number; readonly formato: string; readonly ruta: string }

function versionesDe(medio: Obj): VersionMedio[] {
  return lista(medio['versiones']).filter(esObj).flatMap((v) =>
    typeof v['clase'] === 'string' && typeof v['lado'] === 'number' && typeof v['formato'] === 'string' && typeof v['ruta'] === 'string'
      ? [{ clase: v['clase'], lado: v['lado'], formato: v['formato'], ruta: v['ruta'] }]
      : []);
}

/** La versión más cercana a 960 px (mismo criterio que la API de NovuChat). */
const masCercana = (vs: readonly VersionMedio[]): VersionMedio | undefined =>
  [...vs].sort((a, b) => Math.abs(a.lado - 960) - Math.abs(b.lado - 960))[0];

function foto(medio: Obj, base: string): Foto | undefined {
  const webp = versionesDe(medio).filter((v) => v.clase === 'imagen' && v.formato === 'webp');
  const principal = masCercana(webp);
  if (principal === undefined) return undefined;
  const porAncho = new Map<number, VersionMedio>();
  for (const v of webp) if (!porAncho.has(v.lado)) porAncho.set(v.lado, v);
  const versiones = [...porAncho.values()].sort((a, b) => a.lado - b.lado).slice(0, 6).map((v) => ({ url: `${base}/${v.ruta}`, ancho: v.lado }));
  return { url: `${base}/${principal.ruta}`, alt: cadena(medio['alt']), versiones };
}

function video(medio: Obj, base: string): Producto['video'] {
  const vs = versionesDe(medio);
  const v = masCercana(vs.filter((x) => x.clase === 'video'));
  const p = masCercana(vs.filter((x) => x.clase === 'poster'));
  return v === undefined || p === undefined ? null : { url: `${base}/${v.ruta}`, poster: `${base}/${p.ruta}`, titulo: cadena(medio['alt']) };
}

const fotosDe = (medios: unknown, base: string, tope: number): Foto[] =>
  lista(medios).filter(esObj).filter((m) => m['tipo'] !== 'video').flatMap((m) => foto(m, base) ?? []).slice(0, tope);

/** Tabla genérica palabra clave → ícono (D4). Sin coincidencia: `cuadricula`. */
const ICONOS_POR_PALABRA: readonly (readonly [IdIcono, readonly string[]])[] = [
  ['parlante', ['parlante', 'audio', 'sonido', 'bocina']],
  ['microondas', ['microondas', 'horno']],
  ['televisor', ['televisor', 'tv', 'television', 'pantalla']],
  ['lavadora', ['lavadora', 'lavarropas', 'secadora']],
  ['aire', ['aire', 'climatizador', 'ventilador', 'acondicionado']],
  ['congelador', ['congelador', 'freezer']],
  ['heladera', ['heladera', 'refrigerador', 'nevera', 'frigobar']],
];

export function iconoDeCategoria(id: string): IdIcono {
  const partes = id.toLowerCase().split('-');
  const hallado = ICONOS_POR_PALABRA.find(([, palabras]) => partes.some((p) => palabras.some((w) => p.startsWith(w))));
  return hallado?.[0] ?? 'cuadricula';
}

export function nombreDeCategoria(id: string): string {
  const t = id.replace(/-+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function bloque(b: Obj, base: string): Bloque | undefined {
  switch (b['tipo']) {
    case 'texto':
      return { tipo: 'texto', ...(cadena(b['titulo']) === '' ? {} : { titulo: cadena(b['titulo']) }), parrafos: lista(b['parrafos']).map(cadena) };
    case 'imagen': {
      const f = esObj(b['medio']) ? foto(b['medio'], base) : undefined;
      return f === undefined ? undefined : { tipo: 'imagen', foto: f };
    }
    case 'carrusel':
      return { tipo: 'carrusel', fotos: fotosDe(lista(b['items']), base, LIMITES_SITIO.fotosPorCarrusel) };
    case 'enlaces':
      return { tipo: 'enlaces', items: lista(b['items']).filter(esObj).map((i) => ({ texto: cadena(i['texto']), url: cadena(i['url']) })) };
    default:
      return { tipo: 'desconocido' } as unknown as Bloque; // lo rechaza validarContenido (sin valores)
  }
}

/**
 * @throws ErrorContenidoPublicado si la respuesta, el negocio o el resultado no son válidos.
 */
export function contenidoDesdePublicado(respuesta: unknown, negocio: unknown, entorno: EntornoSitio): Contenido {
  const errores: string[] = [];
  const base = entorno.origenMedios.replace(/\/+$/, '');

  const n = validarNegocio(negocio, [entorno.origen, base]);
  if (!n.ok) errores.push(...n.errores);
  const neg = n.ok ? n.negocio : undefined;

  const docs = esObj(respuesta) && esObj(respuesta['documentos']) ? respuesta['documentos'] : undefined;
  if (docs === undefined) errores.push('respuesta.documentos: debe ser un objeto');
  const redondeo = esObj(respuesta) ? respuesta['redondeo'] : undefined;
  if (!esObj(redondeo)) errores.push('respuesta.redondeo: debe ser un objeto');
  const sitio = docs?.['sitio'];
  if (docs !== undefined && !esObj(sitio)) errores.push('documentos.sitio: falta o no es un objeto');
  const estado = docs?.['estado'];
  const entradas = Object.entries(docs ?? {});

  // Productos
  const productos: Producto[] = [];
  const destacados = new Set(neg?.destacados ?? []);
  for (const [clave, d] of entradas.filter(([k]) => k.startsWith('producto__')).sort(([, a], [, b]) => (cadena(esObj(a) ? a['id'] : '') < cadena(esObj(b) ? b['id'] : '') ? -1 : 1))) {
    const r = `documentos.${clave}`;
    if (!esObj(d)) { errores.push(`${r}: debe ser un objeto`); continue; }
    if (typeof d['marca'] !== 'string' || d['marca'].trim() === '') errores.push(`${r}.marca: falta (el sitio exige marca)`);
    const precio = esObj(d['precioUSD']) ? d['precioUSD'] : undefined;
    if (precio === undefined || typeof precio['bo'] !== 'number' || typeof precio['ar'] !== 'number') errores.push(`${r}.precioUSD: debe tener bo y ar numéricos`);
    const medios = lista(d['medios']).filter(esObj);
    const vid = medios.filter((m) => m['tipo'] === 'video').map((m) => video(m, base)).find((v) => v !== null) ?? null;
    const id = cadena(d['id']);
    const seo = esObj(d['seo']) ? d['seo'] : {};
    productos.push({
      id,
      slug: cadena(d['slug']),
      nombre: cadena(d['nombre']),
      categoria: cadena(d['categoria']),
      marca: cadena(d['marca']),
      descripcion: cadena(d['descripcion']),
      garantia: cadena(d['garantia']).trim() === '' ? null : cadena(d['garantia']),
      precioUsd: { BO: Number(precio?.['bo'] ?? 0), AR: Number(precio?.['ar'] ?? 0) },
      disponible: entorno.disponibilidad[id] === true,
      fotos: fotosDe(medios, base, LIMITES_SITIO.fotosPorProducto),
      video: vid,
      destacado: destacados.has(id),
      seo: {
        ...(cadena(seo['titulo']) === '' ? {} : { titulo: cadena(seo['titulo']) }),
        ...(cadena(seo['descripcion']) === '' ? {} : { descripcion: cadena(seo['descripcion']) }),
      },
    });
  }

  // Categorías (D4) y marcas
  const sobrescritas = neg?.categorias ?? {};
  const categorias: Categoria[] = [...new Set(productos.map((p) => p.categoria))].sort().map((id) => ({
    id,
    nombre: sobrescritas[id]?.nombre ?? nombreDeCategoria(id),
    icono: sobrescritas[id]?.icono ?? iconoDeCategoria(id),
  }));
  const marcas = [...new Set(productos.map((p) => p.marca).filter((m) => m !== ''))].sort().slice(0, 40);

  // Secciones, en el orden del estado
  const orden = esObj(estado) ? lista(estado['secciones']).filter((x): x is string => typeof x === 'string') : [];
  const secciones: Seccion[] = [];
  for (const id of orden) {
    const d = docs?.[`seccion__${id}`];
    if (!esObj(d)) { errores.push(`documentos.seccion__${id}: falta o no es un objeto`); continue; }
    secciones.push({
      id, slug: id, titulo: cadena(d['titulo']), orden: secciones.length,
      bloques: lista(d['bloques']).filter(esObj).flatMap((b) => bloque(b, base) ?? []),
    });
  }

  // Carruseles (D5): el cargado por el comercio o, si no hay, las primeras fotos de los destacados (o de los productos)
  const conFoto = productos.filter((p) => p.fotos.length > 0);
  const origenCarrusel = conFoto.filter((p) => destacados.has(p.id));
  const respaldo: Foto[] = (origenCarrusel.length > 0 ? origenCarrusel : conFoto)
    .slice(0, LIMITES_SITIO.fotosPorCarrusel).map((p) => ({ ...p.fotos[0]!, alt: p.fotos[0]!.alt === '' ? p.nombre : p.fotos[0]!.alt }));
  const carruseles = {} as Record<IdPlantilla, readonly Foto[]>;
  for (const p of IDS_PLANTILLA) {
    const d = docs?.[`carrusel__${p}`];
    const propias = esObj(d) ? fotosDe(d['items'], base, LIMITES_SITIO.fotosPorCarrusel) : [];
    carruseles[p] = propias.length > 0 ? propias : respaldo;
  }

  const s = esObj(sitio) ? sitio : {};
  const med = esObj(s['medicion']) ? s['medicion'] : {};
  const nulo = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);

  const candidato = {
    config: {
      nombre: neg?.nombre, lema: neg?.lema, logo: neg?.logo ?? null,
      origen: entorno.origen,
      plantilla: s['plantillaActiva'],
      whatsappNovuchat: nulo(s['whatsappNovuchat']),
      whatsappTienda: neg?.whatsappTienda ?? null,
      telefono: neg?.telefono ?? null, correo: neg?.correo ?? null,
      direccion: neg?.direccion, horario: neg?.horario ?? null,
      mercados: neg?.mercados, mercadoInicial: neg?.mercadoInicial,
      redondeo,
      medicion: { google: nulo(med['ga4']), searchConsole: nulo(med['searchConsole']), meta: nulo(med['metaPixel']), tiktok: nulo(med['tiktokPixel']) },
      recaptchaSiteKey: entorno.recaptchaSiteKey,
      appCheck: entorno.appCheck,
      origenMedios: base,
      enlacesPermitidos: neg?.enlacesPermitidos,
      textoPrivacidad: neg?.textoPrivacidad,
      esEjemplo: false,
    },
    portada: neg?.portada, beneficios: neg?.beneficios, categorias, marcas, identidad: neg?.identidad,
    productos, secciones, carruseles,
  };

  const r = validarContenido(candidato);
  if (!r.ok) errores.push(...r.errores);
  // Los errores de negocio ya vienen con su prefijo; los de validarContenido repetidos por campos ausentes se descartan.
  if (errores.length > 0 || !r.ok) throw new ErrorContenidoPublicado([...new Set(errores)]);
  return r.contenido;
}

