import { esObjeto, resultado, soloClaves, textoPlano, type Validacion } from './validar.js';

export const ESTADOS_FICHA = ['borrador', 'publicado', 'oculto'] as const;
export type EstadoFicha = (typeof ESTADOS_FICHA)[number];

export interface MedioFicha {
  readonly medioId: string;
  /** Texto alternativo: obligatorio en todo medio. */
  readonly alt: string;
}

export interface SeoFicha {
  readonly titulo: string;
  readonly descripcion: string;
}

/** `fichasWeb/{productoId}`: lo que el sitio muestra además de los datos del producto. */
export interface FichaWeb {
  readonly slug: string;
  readonly descripcion: string;
  readonly garantia: string;
  /** En orden de aparición. Hasta 5 fotos y 1 video (el tipo se verifica contra `medios/`). */
  readonly medios: readonly MedioFicha[];
  readonly seo: SeoFicha;
  readonly estado: EstadoFicha;
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ID_MEDIO = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_MEDIOS_FICHA = 6;

/** Valida la entrada de una ficha. La unicidad del slug y la existencia de los medios se verifican en la transacción. */
export function validarFichaWeb(x: unknown): Validacion<FichaWeb> {
  const errores: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la ficha debe ser un objeto'] };
  soloClaves(x, ['slug', 'descripcion', 'garantia', 'medios', 'seo', 'estado'], 'ficha', errores);

  const slug = x['slug'];
  if (typeof slug !== 'string' || slug.length < 2 || slug.length > 80 || !SLUG.test(slug)) {
    errores.push('slug: use minúsculas, números y guiones (2 a 80 caracteres)');
  }
  const descripcion = textoPlano(x['descripcion'], 'descripcion', { max: 4000, multilinea: true }, errores);
  const garantia = textoPlano(x['garantia'], 'garantia', { max: 300 }, errores);

  const estado = x['estado'];
  if (typeof estado !== 'string' || !(ESTADOS_FICHA as readonly string[]).includes(estado)) {
    errores.push('estado: debe ser borrador, publicado u oculto');
  } else if (estado === 'publicado' && descripcion === '') {
    errores.push('descripcion: es obligatoria para publicar');
  }

  const medios: MedioFicha[] = [];
  const crudos = x['medios'];
  if (!Array.isArray(crudos)) errores.push('medios: debe ser una lista');
  else if (crudos.length > MAX_MEDIOS_FICHA) errores.push('medios: máximo 5 fotos y 1 video');
  else {
    const vistos = new Set<string>();
    crudos.forEach((m: unknown, i: number) => {
      if (!esObjeto(m)) {
        errores.push(`medios[${String(i)}]: debe ser un objeto`);
        return;
      }
      soloClaves(m, ['medioId', 'alt'], `medios[${String(i)}]`, errores);
      const id = m['medioId'];
      if (typeof id !== 'string' || !ID_MEDIO.test(id)) errores.push(`medios[${String(i)}].medioId: inválido`);
      else if (vistos.has(id)) errores.push(`medios[${String(i)}].medioId: repetido`);
      else vistos.add(id);
      const alt = textoPlano(m['alt'], `medios[${String(i)}].alt`, { min: 1, max: 160 }, errores);
      if (typeof id === 'string' && alt !== undefined) medios.push({ medioId: id, alt });
    });
  }

  const seoCrudo = x['seo'];
  let seo: SeoFicha = { titulo: '', descripcion: '' };
  if (!esObjeto(seoCrudo)) errores.push('seo: debe ser un objeto');
  else {
    soloClaves(seoCrudo, ['titulo', 'descripcion'], 'seo', errores);
    const t = textoPlano(seoCrudo['titulo'], 'seo.titulo', { max: 70 }, errores);
    const d = textoPlano(seoCrudo['descripcion'], 'seo.descripcion', { max: 160 }, errores);
    if (t !== undefined && d !== undefined) seo = { titulo: t, descripcion: d };
  }

  return resultado(errores, {
    slug: typeof slug === 'string' ? slug : '',
    descripcion: descripcion ?? '',
    garantia: garantia ?? '',
    medios,
    seo,
    estado: (estado as EstadoFicha | undefined) ?? 'borrador',
  });
}
