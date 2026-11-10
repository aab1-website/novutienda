/** Indexación por ambiente: solo producción se indexa; staging y desarrollo llevan `noindex` y `Disallow: /`. */
export const esProduccion = (ambiente: string | undefined): boolean => ambiente === 'production';

export function textoRobots(ambiente: string | undefined): string {
  return esProduccion(ambiente)
    ? 'User-agent: *\nAllow: /\nDisallow: /api/\n'
    : 'User-agent: *\nDisallow: /\n';
}
