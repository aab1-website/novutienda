import type { FichaWeb } from '../../api/tipos.js';

/**
 * Revisión de la página de un producto antes de enviarla: el error de cada campo, con los mismos topes y reglas que el
 * servidor (`validarFichaWeb` de `@novutienda/consola`; lo compara `pruebas/consola/ficha-revision.test.ts`). Es una
 * comodidad para marcar el error junto al campo: el servidor vuelve a validar todo.
 */

export const TOPES_FICHA = {
  slugMin: 2,
  slugMax: 80,
  descripcion: 4000,
  garantia: 300,
  seoTitulo: 70,
  seoDescripcion: 160,
  alt: 160,
  medios: 6,
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ETIQUETA_HTML = /<\/?[a-zA-Z!][^>]*>/;

/** Mensajes por campo. Claves: `slug`, `descripcion`, `garantia`, `seo.titulo`, `seo.descripcion`, `medios`, `medios.<i>.alt`. */
export type ErroresFicha = Readonly<Record<string, string>>;

export const claveAlt = (i: number): string => `medios.${String(i)}.alt`;

function tieneControl(t: string, multilinea: boolean): boolean {
  for (const c of t) {
    const p = c.codePointAt(0) ?? 0;
    if (multilinea && (p === 10 || p === 9)) continue;
    if (p < 32 || p === 127) return true;
  }
  return false;
}

/** Falla de un texto plano (largo, caracteres de control, HTML), o `undefined` si es válido. */
function fallaDeTexto(v: string, max: number, multilinea: boolean): string | undefined {
  if (v.length > max) return `Máximo ${String(max)} caracteres.`;
  if (tieneControl(v, multilinea)) return 'Contiene caracteres que no se admiten.';
  if (ETIQUETA_HTML.test(v)) return 'Escriba texto simple, sin etiquetas HTML.';
  return undefined;
}

export function revisarFicha(f: FichaWeb): ErroresFicha {
  const e: Record<string, string> = {};
  if (f.slug.length < TOPES_FICHA.slugMin || f.slug.length > TOPES_FICHA.slugMax || !SLUG.test(f.slug)) {
    e['slug'] = `Use minúsculas, números y guiones, de ${String(TOPES_FICHA.slugMin)} a ${String(TOPES_FICHA.slugMax)} caracteres. Ejemplo: televisor-55.`;
  }
  const descripcion = fallaDeTexto(f.descripcion, TOPES_FICHA.descripcion, true);
  if (descripcion !== undefined) e['descripcion'] = descripcion;
  else if (f.estado === 'publicado' && f.descripcion === '') e['descripcion'] = 'Para publicar la página, escriba la descripción del producto.';
  const garantia = fallaDeTexto(f.garantia, TOPES_FICHA.garantia, false);
  if (garantia !== undefined) e['garantia'] = garantia;
  const titulo = fallaDeTexto(f.seo.titulo, TOPES_FICHA.seoTitulo, false);
  if (titulo !== undefined) e['seo.titulo'] = titulo;
  const descSeo = fallaDeTexto(f.seo.descripcion, TOPES_FICHA.seoDescripcion, false);
  if (descSeo !== undefined) e['seo.descripcion'] = descSeo;

  if (f.medios.length > TOPES_FICHA.medios) e['medios'] = 'Máximo 5 fotos y 1 video.';
  else {
    const vistos = new Set<string>();
    f.medios.forEach((m, i) => {
      if (vistos.has(m.medioId)) e['medios'] = 'Hay un archivo repetido en la lista.';
      vistos.add(m.medioId);
      if (m.alt.length < 1) e[claveAlt(i)] = 'Escriba una descripción: es el texto que leen los lectores de pantalla.';
      else {
        const falla = fallaDeTexto(m.alt, TOPES_FICHA.alt, false);
        if (falla !== undefined) e[claveAlt(i)] = falla;
      }
    });
  }
  return e;
}
