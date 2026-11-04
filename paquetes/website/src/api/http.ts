import type { RespuestaHttp } from '@novutienda/nucleo';

export type { RespuestaHttp };

const JSON_UTF8 = 'application/json; charset=utf-8';

/** Respuesta JSON sin caché compartida y con tipo de contenido fijo. */
export function respuestaJson(status: number, cuerpo: unknown, extra: Readonly<Record<string, string>> = {}): RespuestaHttp {
  return {
    status,
    headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
    cuerpo,
  };
}

/** Quita caracteres de control (salvo salto de línea si se permite) y espacios de los extremos. */
export function limpiarTexto(t: string, permitirSaltos = false): string {
  // eslint-disable-next-line no-control-regex
  const re = permitirSaltos ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g;
  return t.replace(re, '').trim();
}
