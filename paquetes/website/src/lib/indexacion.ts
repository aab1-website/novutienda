/** Indexación por ambiente: solo producción se indexa; staging y desarrollo llevan `noindex` y `Disallow: /`. */
export const esProduccion = (ambiente: string | undefined): boolean => ambiente === 'production';

export function textoRobots(ambiente: string | undefined): string {
  return esProduccion(ambiente)
    ? 'User-agent: *\nAllow: /\nDisallow: /api/\n'
    : 'User-agent: *\nDisallow: /\n';
}

/** ¿La página lleva `noindex`? Sí si la página lo pide, el contenido es de ejemplo o el ambiente no es producción. */
export const debeNoIndexar = (ambiente: string | undefined, esEjemplo: boolean, pedido = false): boolean =>
  pedido || esEjemplo || !esProduccion(ambiente);
