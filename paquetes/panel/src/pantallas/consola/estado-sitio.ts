/** Texto para el comercio sobre la última publicación del sitio. Función pura. */
import { MAX_CATEGORIAS_SITIO } from '@novutienda/nucleo';

export interface CausaSitioVista { codigo: string; mercado?: string; producto?: string }
export interface UltimaReconstruccionVista {
  estado: 'completada' | 'fallida';
  version: number;
  en: string;
  etapa: string | null;
  enCurso: boolean;
  causas: readonly CausaSitioVista[];
}

/** Límite declarado: solo se traducen BO y AR; los demás mercados se muestran con su código. */
const MERCADOS: Record<string, string> = { BO: 'Bolivia', AR: 'Argentina' };
const MAX_FRASES = 5;
const TECNICO = 'No se pudo actualizar el sitio por un problema técnico. Vuelva a publicar en unos minutos; si sigue igual, avise a NovuTienda.';

function frase(c: CausaSitioVista): string | null {
  const prod = c.producto ? `«${c.producto}»` : null;
  if (c.codigo === 'precio_fuera_de_tope') {
    const m = c.mercado ? ` en ${MERCADOS[c.mercado] ?? c.mercado}` : '';
    return `${prod ? `el producto ${prod}` : 'un producto'} tiene un precio fuera del tope${m}`;
  }
  if (c.codigo === 'categoria_invalida') {
    return `la categoría ${prod ? `del producto ${prod}` : 'de un producto'} no es válida`;
  }
  if (c.codigo === 'demasiadas_categorias') return `hay más de ${MAX_CATEGORIAS_SITIO} categorías`;
  return null;
}

export function textoUltimaReconstruccion(
  u: UltimaReconstruccionVista | null | undefined,
  versionPublicada?: number,
  cambiosSinPublicar = 0,
): string {
  if (!u) {
    return versionPublicada !== undefined && versionPublicada > 0
      ? `Última publicación: versión ${versionPublicada}. El estado del sitio aparecerá tras la próxima actualización.`
      : 'Todavía no se publicó el sitio.';
  }
  if (u.enCurso) return `Publicando la versión ${versionPublicada ?? u.version}: el sitio se actualiza en unos minutos.`;
  if (u.estado === 'completada') {
    if (cambiosSinPublicar > 0) return 'Hay cambios sin publicar: se verán en el sitio al publicar.';
    return `El sitio está al día (versión ${u.version}).`;
  }
  if (u.etapa !== null && u.etapa !== 'generar') return TECNICO;
  const frases: string[] = [];
  for (const c of u.causas) {
    const f = frase(c);
    if (f && !frases.includes(f)) frases.push(f);
  }
  if (frases.length === 0) return TECNICO;
  const visibles = frases.slice(0, MAX_FRASES);
  const resto = frases.length - visibles.length;
  const cuerpo = visibles.join('; ') + (resto > 0 ? ` y ${resto} más` : '');
  return `La última publicación no llegó al sitio: ${cuerpo}.`;
}
