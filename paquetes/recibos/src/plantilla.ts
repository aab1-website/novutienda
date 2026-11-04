import { registrarAuditoria } from '@plataforma/nucleo';
import { AccionNoPermitida, PlantillaInvalida } from './errores.js';
import { rutaPlantilla } from './rutas.js';
import type { ActorAuditado, DatosNegocio, EjecutorRecibos, PlantillaRecibo } from './tipos.js';

export const SERIE_POR_DEFECTO = 'A';
const SERIE = /^[A-Z0-9]{1,6}$/;
const LIMITE_TEXTO = 2000;

/** Plantilla usada mientras el tenant no configure la suya: la venta nunca se bloquea por esto. */
export const PLANTILLA_POR_DEFECTO: PlantillaRecibo = { serie: SERIE_POR_DEFECTO, negocio: { nombre: '' } };

/** URL https sin espacios ni caracteres de HTML; evita `javascript:` y similares. */
export const esUrlHttps = (v: string): boolean => /^https:\/\/[^\s"'<>`\\]{1,490}$/i.test(v);

function textoOpcional(v: unknown, campo: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw new PlantillaInvalida(`${campo} debe ser texto no vacío de hasta ${max} caracteres`);
  return v;
}

/** Valida y normaliza la plantilla; lanza `PlantillaInvalida`. Rechaza campos desconocidos. */
export function validarPlantilla(x: unknown): PlantillaRecibo {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new PlantillaInvalida('La plantilla debe ser un objeto');
  const o = x as Record<string, unknown>;
  const permitidos = ['serie', 'logoUrl', 'negocio', 'pie', 'politicaGarantia', 'politicaCambios'];
  for (const k of Object.keys(o)) if (!permitidos.includes(k)) throw new PlantillaInvalida(`Campo desconocido: ${k}`);
  if (typeof o['serie'] !== 'string' || !SERIE.test(o['serie'])) throw new PlantillaInvalida('serie inválida (A-Z y 0-9, hasta 6 caracteres)');
  const n = o['negocio'];
  if (typeof n !== 'object' || n === null || Array.isArray(n)) throw new PlantillaInvalida('negocio requerido');
  const no = n as Record<string, unknown>;
  for (const k of Object.keys(no)) if (!['nombre', 'direccion', 'telefono', 'nit'].includes(k)) throw new PlantillaInvalida(`negocio.${k} desconocido`);
  if (typeof no['nombre'] !== 'string' || no['nombre'].trim() === '' || no['nombre'].length > 120) throw new PlantillaInvalida('negocio.nombre requerido');
  const direccion = textoOpcional(no['direccion'], 'negocio.direccion', 200);
  const telefono = textoOpcional(no['telefono'], 'negocio.telefono', 40);
  const nit = textoOpcional(no['nit'], 'negocio.nit', 40);
  const negocio: DatosNegocio = {
    nombre: no['nombre'],
    ...(direccion !== undefined && { direccion }),
    ...(telefono !== undefined && { telefono }),
    ...(nit !== undefined && { nit }),
  };
  const logoUrl = textoOpcional(o['logoUrl'], 'logoUrl', 500);
  if (logoUrl !== undefined && !esUrlHttps(logoUrl)) throw new PlantillaInvalida('logoUrl debe ser una URL https');
  const pie = textoOpcional(o['pie'], 'pie', LIMITE_TEXTO);
  const politicaGarantia = textoOpcional(o['politicaGarantia'], 'politicaGarantia', LIMITE_TEXTO);
  const politicaCambios = textoOpcional(o['politicaCambios'], 'politicaCambios', LIMITE_TEXTO);
  return {
    serie: o['serie'],
    negocio,
    ...(logoUrl !== undefined && { logoUrl }),
    ...(pie !== undefined && { pie }),
    ...(politicaGarantia !== undefined && { politicaGarantia }),
    ...(politicaCambios !== undefined && { politicaCambios }),
  };
}

/** Plantilla vigente del tenant; si no existe o es inválida, la plantilla por defecto. */
export function plantillaVigente(datos: Readonly<Record<string, unknown>> | undefined): PlantillaRecibo {
  if (datos === undefined) return PLANTILLA_POR_DEFECTO;
  const contenido: Record<string, unknown> = { ...datos };
  delete contenido['actualizadoEn'];
  try {
    return validarPlantilla(contenido);
  } catch {
    return PLANTILLA_POR_DEFECTO;
  }
}

/**
 * Guarda la plantilla del tenant (solo `sup` o `adm`) y audita el cambio.
 * La auditoría lista solo los campos modificados, nunca los textos.
 */
export async function guardarPlantilla(
  ejecutor: EjecutorRecibos,
  p: { tenantId: string; actor: ActorAuditado; plantilla: unknown },
): Promise<void> {
  if (p.actor.rol === 'caj') throw new AccionNoPermitida('Solo supervisión o administración editan la plantilla');
  const nueva = validarPlantilla(p.plantilla);
  const ruta = rutaPlantilla(p.tenantId);
  await ejecutor.transaccion(async (tx) => {
    const previa = await tx.leer(ruta);
    const antes = plantillaVigente(previa) as unknown as Record<string, unknown>;
    const despues = nueva as unknown as Record<string, unknown>;
    const cambiados = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter(
      (k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]),
    );
    tx.set(ruta, { ...nueva, actualizadoEn: tx.marcaTiempoServidor() });
    registrarAuditoria(tx, {
      tenantId: p.tenantId, uid: p.actor.uid, rol: p.actor.rol, accion: 'recibos.plantilla.guardar', ruta,
      resumenDespues: { camposCambiados: cambiados },
    });
  });
}
