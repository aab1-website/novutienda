/**
 * POST /api/contacto — formulario de contacto. Función pura de manejo: App Check, reCAPTCHA,
 * límite de tasa y almacenamiento son PUERTOS inyectados (el coordinador los cablea a los
 * servicios reales). Orden: método, tipo, tamaño, límite de tasa, App Check, validación,
 * trampa para bots, reCAPTCHA y, solo entonces, guardar. Los registros no llevan datos personales.
 */
import type { Mercado } from '@plataforma/nucleo';
import { limpiarTexto, respuestaJson, type RespuestaHttp } from './http.js';
import type { LimiteTasa } from './limite-tasa.js';

export interface VerificadorRecaptcha {
  verificar(token: string, accion: string): Promise<{ readonly valido: boolean; readonly puntaje: number | null }>;
}
export interface VerificadorAppCheck {
  verificar(token: string): Promise<boolean>;
}

export interface ContactoValidado {
  /** Clave de idempotencia elegida por el navegador: reintentar el mismo envío no duplica nada. */
  readonly operacionId: string;
  readonly nombre: string;
  readonly correo: string | null;
  readonly telefono: string | null;
  readonly mensaje: string;
  readonly pais: Mercado | null;
  readonly productoId: string | null;
}

export interface GuardarContacto {
  guardar(c: ContactoValidado, recibidoEn: number): Promise<'creado' | 'repetido'>;
}

export interface DepsContacto {
  readonly recaptcha: VerificadorRecaptcha;
  readonly appCheck: VerificadorAppCheck;
  readonly limite: LimiteTasa;
  readonly almacen: GuardarContacto;
  readonly ahora: () => number;
  /** Puntaje mínimo aceptado de reCAPTCHA (0 a 1). */
  readonly puntajeMinimo?: number;
}

export interface PeticionContacto {
  readonly metodo: string;
  readonly cabeceras: Readonly<Record<string, string | undefined>>;
  readonly cuerpo: unknown;
  /** Identificador del origen de la petición para el límite de tasa (el cableado decide si lo transforma). */
  readonly origen: string;
}

export const ACCION_RECAPTCHA = 'contacto';
export const MAX_BYTES_CUERPO = 10_000;
export const CABECERA_APP_CHECK = 'x-firebase-appcheck';

const RE_ENVIO = /^[A-Za-z0-9_-]{16,64}$/;
const RE_CORREO = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
const RE_TEL = /^\+?[0-9 ()-]{6,20}$/;
const RE_PRODUCTO = /^[a-z0-9][a-z0-9-]{1,59}$/;

export type ResultadoValidacionContacto =
  | { readonly ok: true; readonly datos: ContactoValidado; readonly recaptchaToken: string; readonly trampa: boolean }
  | { readonly ok: false; readonly campos: readonly string[] };

export function validarContacto(cuerpo: unknown): ResultadoValidacionContacto {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return { ok: false, campos: ['cuerpo'] };
  const o = cuerpo as Record<string, unknown>;
  const campos: string[] = [];
  const texto = (k: string, min: number, max: number, saltos = false): string => {
    const v = o[k];
    if (typeof v !== 'string') {
      campos.push(k);
      return '';
    }
    const t = limpiarTexto(v, saltos);
    if (t.length < min || t.length > max) campos.push(k);
    return t;
  };
  const opcional = (k: string, max: number): string | null => {
    const v = o[k];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') {
      campos.push(k);
      return null;
    }
    const t = limpiarTexto(v);
    if (t.length > max) campos.push(k);
    return t === '' ? null : t;
  };

  const operacionId = typeof o['envioId'] === 'string' && RE_ENVIO.test(o['envioId']) ? o['envioId'] : (campos.push('envioId'), '');
  const nombre = texto('nombre', 2, 80);
  const correo = opcional('correo', 120);
  if (correo !== null && !RE_CORREO.test(correo)) campos.push('correo');
  const telefono = opcional('telefono', 20);
  if (telefono !== null && !RE_TEL.test(telefono)) campos.push('telefono');
  if (correo === null && telefono === null) campos.push('contacto');
  const mensaje = texto('mensaje', 5, 2000, true);
  const paisCrudo = o['pais'];
  let pais: Mercado | null = null;
  if (paisCrudo === 'BO' || paisCrudo === 'AR') pais = paisCrudo;
  else if (paisCrudo !== undefined && paisCrudo !== null && paisCrudo !== '') campos.push('pais');
  const productoId = opcional('productoId', 60);
  if (productoId !== null && !RE_PRODUCTO.test(productoId)) campos.push('productoId');
  if (o['aceptaPrivacidad'] !== true) campos.push('aceptaPrivacidad');
  const token = typeof o['recaptchaToken'] === 'string' && o['recaptchaToken'].length >= 20 && o['recaptchaToken'].length <= 4000 ? o['recaptchaToken'] : (campos.push('recaptchaToken'), '');
  const trampa = typeof o['sitioWeb'] === 'string' && o['sitioWeb'] !== '';
  if (o['sitioWeb'] !== undefined && typeof o['sitioWeb'] !== 'string') campos.push('sitioWeb');

  if (campos.length > 0) return { ok: false, campos: [...new Set(campos)] };
  return { ok: true, datos: { operacionId, nombre, correo, telefono, mensaje, pais, productoId }, recaptchaToken: token, trampa };
}

export async function manejarContacto(req: PeticionContacto, deps: DepsContacto): Promise<RespuestaHttp> {
  if (req.metodo.toUpperCase() !== 'POST') return respuestaJson(405, { error: 'metodo_no_permitido' }, { Allow: 'POST' });
  if (!(req.cabeceras['content-type'] ?? '').toLowerCase().startsWith('application/json')) return respuestaJson(415, { error: 'tipo_no_soportado' });
  let tamano: number;
  try {
    tamano = JSON.stringify(req.cuerpo ?? null).length;
  } catch {
    return respuestaJson(400, { error: 'validacion', campos: ['cuerpo'] });
  }
  if (tamano > MAX_BYTES_CUERPO) return respuestaJson(413, { error: 'cuerpo_demasiado_grande' });

  const ahora = deps.ahora();
  try {
    const lim = await deps.limite.intentar(`contacto:${req.origen}`, ahora);
    if (!lim.permitido) return respuestaJson(429, { error: 'demasiadas_solicitudes' }, { 'Retry-After': String(lim.reintentarEnSeg) });

    const tokenAppCheck = req.cabeceras[CABECERA_APP_CHECK];
    if (tokenAppCheck === undefined || tokenAppCheck === '' || !(await deps.appCheck.verificar(tokenAppCheck))) {
      return respuestaJson(401, { error: 'app_check' });
    }

    const v = validarContacto(req.cuerpo);
    if (!v.ok) return respuestaJson(400, { error: 'validacion', campos: v.campos });
    // Trampa para bots: se responde como si hubiera funcionado y no se guarda nada.
    if (v.trampa) return respuestaJson(200, { ok: true });

    const r = await deps.recaptcha.verificar(v.recaptchaToken, ACCION_RECAPTCHA);
    if (!r.valido || r.puntaje === null || r.puntaje < (deps.puntajeMinimo ?? 0.5)) return respuestaJson(403, { error: 'recaptcha' });

    const estado = await deps.almacen.guardar(v.datos, ahora);
    return respuestaJson(200, { ok: true, repetido: estado === 'repetido' });
  } catch {
    // Sin detalle: ni el mensaje de error ni los datos recibidos van a la respuesta.
    return respuestaJson(500, { error: 'error_interno' });
  }
}
