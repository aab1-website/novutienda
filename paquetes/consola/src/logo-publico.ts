import type { TransaccionIdentidad } from '@novutienda/nucleo';
import { avanzarPublicadoVivo } from './publicar.js';
import type { DisparadorSitio, Reloj } from './puertos.js';
import { rutaPublicado } from './rutas.js';
import { esObjeto } from './validar.js';

/** Logo tal como lo lee el sitio: `publicado/sitio.logo`. Sin bytes ni identificadores internos. */
export interface LogoPublicado {
  readonly ancho: number;
  readonly alto: number;
  readonly versiones: readonly { readonly formato: 'png' | 'webp'; readonly lado: number; readonly ruta: string }[];
}

/**
 * Proyección pública del documento `sitio/logo`. Lista blanca EXACTA de la ruta: solo `tenants/{t}/publico/medios/_negocio/<archivo>`
 * (sin subcarpetas ni `..`); cualquier otra versión se descarta. Sin versiones válidas, no hay logo (`undefined`).
 */
export function proyectarLogoPublico(t: string, doc: Readonly<Record<string, unknown>> | undefined): LogoPublicado | undefined {
  if (doc === undefined || typeof doc['ancho'] !== 'number' || typeof doc['alto'] !== 'number' || !Array.isArray(doc['versiones'])) return undefined;
  const prefijo = `tenants/${t}/publico/medios/_negocio/`;
  const versiones = doc['versiones'].filter(esObjeto).flatMap((v): LogoPublicado['versiones'][number][] => {
    const { formato, lado, ruta } = v;
    if ((formato !== 'png' && formato !== 'webp') || typeof lado !== 'number' || typeof ruta !== 'string') return [];
    if (!ruta.startsWith(prefijo) || ruta.length === prefijo.length || ruta.slice(prefijo.length).includes('/') || ruta.includes('..')) return [];
    return [{ formato, lado, ruta }];
  });
  return versiones.length === 0 ? undefined : { ancho: doc['ancho'], alto: doc['alto'], versiones };
}

export interface LecturaPublicado {
  readonly estado: Readonly<Record<string, unknown>> | undefined;
  readonly sitio: Readonly<Record<string, unknown>> | undefined;
}

/** Lecturas de «logo vivo»: van ANTES de cualquier escritura de la transacción. */
export async function leerPublicadoParaLogo(tx: TransaccionIdentidad, t: string): Promise<LecturaPublicado> {
  return {
    estado: (await tx.get(rutaPublicado(t, 'estado'))).data(),
    sitio: (await tx.get(rutaPublicado(t, 'sitio'))).data(),
  };
}

/**
 * Logo vivo: si el comercio ya tiene algo publicado, pone (o quita, con `logo` indefinido) SOLO `publicado/sitio.logo`, sube la
 * versión de `publicado/estado` y de `publicado/sitio` (+1, siguen iguales) y agenda la reconstrucción con la misma ventana que una
 * publicación. Devuelve la hora a agendar (el disparador se llama tras el commit) o `null` si no hay nada que agendar; `aplicado`
 * dice si se actualizó lo publicado (en tal caso el cambio NO cuenta como «sin publicar»).
 */
export function escribirLogoVivo(
  tx: TransaccionIdentidad, t: string, lectura: LecturaPublicado, logo: LogoPublicado | undefined, reloj: Reloj,
): { readonly aplicado: boolean; readonly programar: number | null } {
  const { estado, sitio } = lectura;
  if (estado === undefined || sitio === undefined) return { aplicado: false, programar: null };
  const ahora = reloj.ahora();
  const { version, reconstruccion, programar } = avanzarPublicadoVivo(estado, ahora);
  const sinLogo: Record<string, unknown> = { ...sitio };
  delete sinLogo['logo'];
  tx.set(rutaPublicado(t, 'sitio'), { ...sinLogo, version, ...(logo === undefined ? {} : { logo }) });
  tx.set(rutaPublicado(t, 'estado'), {
    ...estado, version, logoVivoEn: new Date(ahora).toISOString(), reconstruccion,
  });
  return { aplicado: true, programar };
}

export async function agendarLogoVivo(disparador: DisparadorSitio | undefined, t: string, para: number | null): Promise<void> {
  if (para !== null && disparador !== undefined) await disparador.programar(t, para);
}
