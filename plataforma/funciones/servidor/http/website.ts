// Borde HTTP del módulo website: rutas públicas del sitio (cotización, disponibilidad, contacto). El enrutador
// solo compone; el enlace con `@novutienda/website` (`despacharApi`) vive aquí.
import type { LimiteTasa } from '@novutienda/nucleo';
import {
  despacharApi, lectorCotizacion, type DepsContacto, type VerificadorAppCheck, type VerificadorRecaptcha,
} from '@novutienda/website';
import type { Entorno } from '../entorno.js';
import type { PeticionHttp, RespuestaApi } from './tipos.js';

/** Lo que el borde de website necesita de la configuración del enrutador. */
export interface ConfigWebsite {
  readonly limiteContacto: LimiteTasa;
  readonly recaptcha: VerificadorRecaptcha;
  readonly appCheck: VerificadorAppCheck;
}

export async function manejarSitioPublico(e: Entorno, req: PeticionHttp, ruta: string, cfg: ConfigWebsite, tenantId: string): Promise<RespuestaApi> {
  const contacto: DepsContacto = {
    recaptcha: cfg.recaptcha, appCheck: cfg.appCheck, limite: cfg.limiteContacto, almacen: e.guardarContacto(tenantId), ahora: e.ahora,
  };
  const r = await despacharApi(
    { metodo: req.metodo, ruta, consulta: req.consulta, cabeceras: req.cabeceras, cuerpo: req.cuerpo, origen: req.origen },
    { leerCotizacion: lectorCotizacion(e.almacenCotizaciones, tenantId, e.ahora), leerDisponibilidad: e.leerDisponibilidad(tenantId), contacto },
  );
  return { status: r.status, headers: r.headers, cuerpo: r.cuerpo };
}
