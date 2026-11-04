import { validarEnlace } from './enlaces.js';
import { ID_MEDIO } from './fichas.js';
import { ID_SECCION } from './rutas.js';
import { esObjeto, resultado, soloClaves, textoPlano, type Validacion } from './validar.js';

export interface ItemImagen {
  readonly medioId: string;
  readonly alt: string;
}
export interface ItemEnlace {
  readonly texto: string;
  readonly url: string;
}

/** Bloques tipados: nunca HTML libre. El sitio los dibuja con componentes propios. */
export type Bloque =
  | { readonly tipo: 'texto'; readonly titulo: string; readonly parrafos: readonly string[] }
  | { readonly tipo: 'imagen'; readonly medioId: string; readonly alt: string }
  | { readonly tipo: 'carrusel'; readonly items: readonly ItemImagen[] }
  | { readonly tipo: 'enlaces'; readonly items: readonly ItemEnlace[] };

/** `secciones/{id}`: una sección del menú del sitio (hasta 5 por tenant). */
export interface Seccion {
  readonly id: string;
  /** Texto del menú. */
  readonly titulo: string;
  readonly visible: boolean;
  readonly bloques: readonly Bloque[];
}

const MAX_BLOQUES = 10;
const MAX_ITEMS = 8;

function imagen(x: unknown, ruta: string, errores: string[]): ItemImagen | undefined {
  if (!esObjeto(x)) {
    errores.push(`${ruta}: debe ser un objeto`);
    return undefined;
  }
  soloClaves(x, ['medioId', 'alt'], ruta, errores);
  const id = x['medioId'];
  const idOk = typeof id === 'string' && ID_MEDIO.test(id);
  if (!idOk) errores.push(`${ruta}.medioId: inválido`);
  const alt = textoPlano(x['alt'], `${ruta}.alt`, { min: 1, max: 160 }, errores);
  return idOk && alt !== undefined ? { medioId: id, alt } : undefined;
}

function lista(x: unknown, ruta: string, errores: string[]): readonly unknown[] {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_ITEMS) {
    errores.push(`${ruta}: debe tener de 1 a ${String(MAX_ITEMS)} elementos`);
    return [];
  }
  return x as unknown[];
}

function bloque(b: unknown, ruta: string, errores: string[]): Bloque | undefined {
  if (!esObjeto(b)) {
    errores.push(`${ruta}: debe ser un objeto`);
    return undefined;
  }
  const n = errores.length;
  switch (b['tipo']) {
    case 'texto': {
      soloClaves(b, ['tipo', 'titulo', 'parrafos'], ruta, errores);
      const titulo = b['titulo'] === undefined ? '' : textoPlano(b['titulo'], `${ruta}.titulo`, { max: 80 }, errores);
      const parrafos: string[] = [];
      const ps = b['parrafos'];
      if (!Array.isArray(ps) || ps.length < 1 || ps.length > 6) errores.push(`${ruta}.parrafos: de 1 a 6 párrafos`);
      else {
        ps.forEach((p: unknown, i: number) => {
          const t = textoPlano(p, `${ruta}.parrafos[${String(i)}]`, { min: 1, max: 1000, multilinea: true }, errores);
          if (t !== undefined) parrafos.push(t);
        });
      }
      return errores.length === n ? { tipo: 'texto', titulo: titulo ?? '', parrafos } : undefined;
    }
    case 'imagen': {
      soloClaves(b, ['tipo', 'medioId', 'alt'], ruta, errores);
      const i = imagen({ medioId: b['medioId'], alt: b['alt'] }, ruta, errores);
      return i !== undefined && errores.length === n ? { tipo: 'imagen', ...i } : undefined;
    }
    case 'carrusel': {
      soloClaves(b, ['tipo', 'items'], ruta, errores);
      const items: ItemImagen[] = [];
      lista(b['items'], `${ruta}.items`, errores).forEach((it, i) => {
        const v = imagen(it, `${ruta}.items[${String(i)}]`, errores);
        if (v !== undefined) items.push(v);
      });
      return errores.length === n ? { tipo: 'carrusel', items } : undefined;
    }
    case 'enlaces': {
      soloClaves(b, ['tipo', 'items'], ruta, errores);
      const items: ItemEnlace[] = [];
      lista(b['items'], `${ruta}.items`, errores).forEach((it, i) => {
        const r = `${ruta}.items[${String(i)}]`;
        if (!esObjeto(it)) {
          errores.push(`${r}: debe ser un objeto`);
          return;
        }
        soloClaves(it, ['texto', 'url'], r, errores);
        const texto = textoPlano(it['texto'], `${r}.texto`, { min: 1, max: 60 }, errores);
        const e = validarEnlace(it['url']);
        if (!e.ok) errores.push(`${r}.url: ${e.error}`);
        if (texto !== undefined && e.ok) items.push({ texto, url: e.valor });
      });
      return errores.length === n ? { tipo: 'enlaces', items } : undefined;
    }
    default:
      errores.push(`${ruta}.tipo: debe ser texto, imagen, carrusel o enlaces`);
      return undefined;
  }
}

/** Valida una sección. El tope de 5 secciones se aplica en la transacción de guardado. */
export function validarSeccion(x: unknown): Validacion<Seccion> {
  const errores: string[] = [];
  if (!esObjeto(x)) return { ok: false, errores: ['la sección debe ser un objeto'] };
  soloClaves(x, ['id', 'titulo', 'visible', 'bloques'], 'seccion', errores);
  const id = x['id'];
  if (typeof id !== 'string' || !ID_SECCION.test(id)) errores.push('id: use minúsculas, números y guiones (hasta 30 caracteres)');
  const titulo = textoPlano(x['titulo'], 'titulo', { min: 1, max: 30 }, errores);
  if (typeof x['visible'] !== 'boolean') errores.push('visible: debe ser verdadero o falso');
  const bloques: Bloque[] = [];
  const bs = x['bloques'];
  if (!Array.isArray(bs) || bs.length > MAX_BLOQUES) errores.push(`bloques: lista de hasta ${String(MAX_BLOQUES)} bloques`);
  else {
    bs.forEach((b: unknown, i: number) => {
      const v = bloque(b, `bloques[${String(i)}]`, errores);
      if (v !== undefined) bloques.push(v);
    });
  }
  return resultado(errores, {
    id: typeof id === 'string' ? id : '',
    titulo: titulo ?? '',
    visible: x['visible'] === true,
    bloques,
  });
}

/** Identificadores de medios que una sección referencia (para verificar que existen y para impedir borrarlos en uso). */
export function mediosDeSeccion(s: Seccion): string[] {
  const ids: string[] = [];
  for (const b of s.bloques) {
    if (b.tipo === 'imagen') ids.push(b.medioId);
    else if (b.tipo === 'carrusel') ids.push(...b.items.map((i) => i.medioId));
  }
  return ids;
}
