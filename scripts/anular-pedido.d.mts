export const RE_PROYECTO: RegExp;
export const RE_PEDIDO: RegExp;
export function leerSecretoGcloud(proyecto: string): string;
export function firmar(secreto: string, marca: string, cuerpo: string): string;
export function ejecutar(
  args: string[],
  env?: Record<string, string | undefined>,
  deps?: { leerSecreto?: (p: string) => string; ahora?: () => number; fetchFn?: typeof fetch },
): Promise<{ codigo: number; salida?: string; error?: string }>;
