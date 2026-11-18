/**
 * Datos del negocio del sitio (`sitio/negocio`): lectura y guardado con control de versión. El guardado es solo del
 * administrador (D-S6-3); la lectura, de supervisor y administrador. Cuenta como cambio sin publicar.
 */
import { registrarAuditoria, type Actor, type TransaccionIdentidad } from '@novutienda/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';
import { ErrorConsola } from './errores.js';
import {
  campoDeError, CAMPOS_NEGOCIO, camposCambiados, canonico, enlacePermitidoEnSitio, evaluarNegocioSitio, rutasDeErrores, type NegocioSitioDatos,
} from './negocio.js';
import { exigirRol, ROLES } from './permisos.js';
import { PLANTILLAS } from './plantillas.js';
import type { BaseDatosConsola, Reloj } from './puertos.js';
import { rutaCarrusel, rutaSeccion, rutaSitio, tenantValido } from './rutas.js';
import { leerMedios } from './servicio-sitio.js';
import { esObjeto } from './validar.js';

export interface DepsNegocio {
  readonly db: BaseDatosConsola;
  readonly reloj: Reloj;
}

/** Documento `sitio/negocio`: los datos más la versión, la fecha y el autor. */
export type DocumentoNegocio = NegocioSitioDatos & { readonly version: number; readonly actualizadoEn: string; readonly por: string };

export interface LecturaNegocio {
  /** `null` si aún no se guardó o si lo guardado no cumple ni la regla heredada (ver `invalido`). */
  readonly negocio: NegocioSitioDatos | null;
  /** 0 si aún no se guardó; si el documento es inválido, su versión cruda (para poder guardar una corrección con ella). */
  readonly version: number;
  readonly enlacesPermitidos: readonly string[];
  /** Rutas de los campos que no cumplen la regla heredada; ausente o vacío cuando está bien. Nunca valores. */
  readonly invalido?: readonly string[];
}

export interface ResultadoGuardadoNegocio {
  /** La nueva versión; si no hubo cambios, la vigente. */
  readonly version: number;
  /** Enlaces ya guardados en secciones VISIBLES y carruseles que la lista nueva deja fuera (solo se cuenta; no se modifican). */
  readonly afectados: number;
}

/** Lo guardado en `sitio/negocio`, separado de los campos del documento. Nunca lanza: si no cumple la regla heredada, `negocio` es `null`. */
export interface DocumentoNegocioLeido {
  readonly negocio: NegocioSitioDatos | null;
  readonly invalido: readonly string[];
  readonly version: number;
  readonly actualizadoEn: string;
}

/** Separa los datos del negocio de los campos del documento y los valida con el nivel `heredado` (paridad con el sitio). */
export function leerDocumentoNegocio(d: Readonly<Record<string, unknown>> | undefined): DocumentoNegocioLeido | undefined {
  if (d === undefined) return undefined;
  const { version, actualizadoEn } = d;
  const datos = Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'version' && k !== 'actualizadoEn' && k !== 'por'));
  const ev = evaluarNegocioSitio(datos, 'heredado');
  return {
    negocio: ev.negocio, invalido: ev.negocio === null ? rutasDeErrores(ev.errores) : [],
    version: typeof version === 'number' && Number.isSafeInteger(version) && version >= 0 ? version : 0,
    actualizadoEn: typeof actualizadoEn === 'string' ? actualizadoEn : '',
  };
}

/** Lee los datos del negocio. Roles: sup y adm. Un documento guardado inválido no lanza: se devuelve `invalido` para poder corregirlo. */
export async function leerNegocioSitio(deps: Pick<DepsNegocio, 'db'>, tenantId: string, actor: Actor): Promise<LecturaNegocio> {
  const t = tenantValido(tenantId);
  exigirRol(actor, t, ROLES.consultar);
  const d = await deps.db.runTransaction(async (tx) => (await tx.get(rutaSitio(t, 'negocio'))).data());
  const l = leerDocumentoNegocio(d);
  if (l === undefined) return { negocio: null, version: 0, enlacesPermitidos: [] };
  return {
    negocio: l.negocio, version: l.version, enlacesPermitidos: l.negocio?.enlacesPermitidos ?? [],
    ...(l.invalido.length > 0 ? { invalido: l.invalido } : {}),
  };
}

const texto = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);

/** Cuenta los enlaces guardados en secciones visibles y carruseles que la lista de anfitriones dada no admite. Lecturas dentro de la transacción. */
async function contarEnlacesFuera(tx: TransaccionIdentidad, t: string, permitidos: readonly string[]): Promise<number> {
  let fuera = 0;
  const cuenta = (url: unknown): void => { if (typeof url === 'string' && url !== '' && !enlacePermitidoEnSitio(url, permitidos)) fuera += 1; };
  for (const id of texto((await tx.get(rutaSitio(t, 'indice'))).data()?.['secciones'])) {
    const sec = (await tx.get(rutaSeccion(t, id))).data();
    // Solo las secciones visibles: son las que la publicación filtraría.
    if (sec?.['visible'] !== true || !Array.isArray(sec['bloques'])) continue;
    for (const b of sec['bloques']) {
      if (!esObjeto(b) || b['tipo'] !== 'enlaces' || !Array.isArray(b['items'])) continue;
      for (const i of b['items']) if (esObjeto(i)) cuenta(i['url']);
    }
  }
  for (const p of PLANTILLAS) {
    const items = (await tx.get(rutaCarrusel(t, p))).data()?.['items'];
    if (Array.isArray(items)) for (const i of items) if (esObjeto(i) && i['enlace'] !== undefined) cuenta(i['enlace']);
  }
  return fuera;
}

/**
 * Guarda los datos del negocio (solo adm). Compara `versionEsperada` con la guardada (0 si no existe) y, si no coincide, lanza
 * `conflicto` sin escribir. Un documento guardado que ya no cumple la regla (`invalido`) se puede reemplazar con su versión cruda.
 *
 * Regla de transición: todo lo que llega debe cumplir el nivel `heredado`; el nivel `estricto` se exige SOLO a los campos de primer
 * nivel que cambian respecto de lo guardado (`camposCambiados`). Un campo que la persona no tocó y que ya estaba guardado se acepta
 * como está, así un dato heredado no impide corregir otro campo. Los errores del documento entero (clave desconocida, tamaño) y
 * todo, si no había nada válido guardado, se exigen siempre. Sin cambios: no sube la versión, no anota cambio ni audita.
 * La foto de identidad por dirección web solo se admite si es la que ya estaba guardada.
 * Audita `sitio.negocio.guardar` con los NOMBRES de los campos que cambiaron.
 */
export async function guardarNegocioSitio(
  deps: DepsNegocio, tenantId: string, actor: Actor, e: { readonly negocio: unknown; readonly versionEsperada: number },
): Promise<ResultadoGuardadoNegocio> {
  const t = tenantValido(tenantId);
  const rol = exigirRol(actor, t, ROLES.administrar);
  if (!Number.isSafeInteger(e.versionEsperada) || e.versionEsperada < 0) throw new ErrorConsola('entrada-invalida', 'versionEsperada inválida');
  const heredado = evaluarNegocioSitio(e.negocio, 'heredado');
  if (heredado.negocio === null) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', heredado.errores);
  const nuevo = heredado.negocio;
  const estricto = evaluarNegocioSitio(e.negocio, 'estricto').errores;
  const ahora = new Date(deps.reloj.ahora()).toISOString();
  return deps.db.runTransaction(async (tx) => {
    // Lo ya guardado se lee sin exigir la regla estricta ni lanzar: un documento inválido debe poder reemplazarse.
    const cruda = (await tx.get(rutaSitio(t, 'negocio'))).data();
    const previa = leerDocumentoNegocio(cruda);
    const version = previa?.version ?? 0;
    if (version !== e.versionEsperada) throw new ErrorConsola('conflicto', 'Otra persona cambió los datos del negocio; vuelva a cargarlos');
    const cambiados = camposCambiados(previa?.negocio ?? null, nuevo);
    const aExigir = estricto.filter((m) => { const c = campoDeError(m); return !(CAMPOS_NEGOCIO as readonly string[]).includes(c) || cambiados.includes(c as (typeof CAMPOS_NEGOCIO)[number]); });
    if (aExigir.length > 0) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', aExigir);
    const foto = nuevo.identidad.foto;
    if (foto !== null && 'url' in foto) {
      const previaFoto = previa?.negocio?.identidad.foto ?? null;
      if (previaFoto === null || canonico(previaFoto) !== canonico(foto)) {
        throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', ['identidad.foto: use una foto de la consola; no se admite una dirección web nueva']);
      }
    } else if (foto !== null && cambiados.includes('identidad')) {
      await leerMedios(tx, t, [foto.medioId], { soloFotos: true });
    }
    const afectados = await contarEnlacesFuera(tx, t, nuevo.enlacesPermitidos);
    if (cambiados.length === 0) return { version, afectados };
    const estado = await leerEstadoSitio(tx, t);

    const siguiente = version + 1;
    tx.set(rutaSitio(t, 'negocio'), { ...nuevo, version: siguiente, actualizadoEn: ahora, por: actor.uid });
    anotarCambio(tx, t, estado, ahora);
    registrarAuditoria(tx, {
      tenantId: t, uid: actor.uid, rol, accion: 'sitio.negocio.guardar', ruta: rutaSitio(t, 'negocio'),
      resumenDespues: { campos: cambiados, version: siguiente },
    });
    return { version: siguiente, afectados };
  });
}
