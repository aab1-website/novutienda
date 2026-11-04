// Forma común de las peticiones y respuestas HTTP de la API, independiente de Express: así el enrutador se
// prueba como función pura y la Cloud Function solo traduce.
export interface PeticionHttp {
  readonly metodo: string;
  /** Ruta sin consulta, p. ej. `/api/cotizacion`. */
  readonly ruta: string;
  /** Ruta con consulta tal como llegó (`req.url`); es lo que firman los endpoints firmados. */
  readonly url: string;
  readonly consulta: Readonly<Record<string, string | undefined>>;
  /** Cabeceras en minúsculas. */
  readonly cabeceras: Readonly<Record<string, string | undefined>>;
  /** Cuerpo exacto recibido (texto), el que se firma. */
  readonly cuerpoCrudo: string;
  /** Cuerpo ya interpretado como JSON (solo si el tipo de contenido lo era). */
  readonly cuerpo: unknown;
  /** Identificador del origen para el límite de tasa. */
  readonly origen: string;
}

export interface RespuestaApi {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** `undefined` = sin cuerpo (304). */
  readonly cuerpo?: unknown;
}

export const JSON_UTF8 = 'application/json; charset=utf-8';

export function json(status: number, cuerpo: unknown, extra: Readonly<Record<string, string>> = {}): RespuestaApi {
  return { status, headers: { 'Content-Type': JSON_UTF8, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }, cuerpo };
}
