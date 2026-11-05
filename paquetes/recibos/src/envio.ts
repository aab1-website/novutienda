import { registrarAuditoria } from '@novutienda/nucleo';
import { AccionNoPermitida, ErrorRecibo, ReciboNoEncontrado } from './errores.js';
import { esUrlHttps } from './plantilla.js';
import { rutaRecibo } from './rutas.js';
import { formatearMonto } from './vista.js';
import type { ActorAuditado, EjecutorRecibos, EstadoEnvio, Recibo } from './tipos.js';

export interface SolicitudEnvio {
  readonly tenantId: string;
  readonly reciboId: string;
  readonly numero: string;
  readonly nombreNegocio: string;
  readonly total: string;
  readonly telefono: string;
  /** URL https del PDF ya publicado por quien llama. */
  readonly enlacePdf: string;
}

export interface ResultadoEnvio {
  readonly estado: Exclude<EstadoEnvio, 'no_enviado' | 'sin_telefono'>;
  /** Enlace que debe abrir la persona (wa.me); no se guarda en el comprobante. */
  readonly enlace?: string;
}

/** Puerto de envío del comprobante. El envío automático por la API de NovuChat/Meta NO se implementa aquí. */
export interface EnviadorRecibo {
  enviar(solicitud: SolicitudEnvio): Promise<ResultadoEnvio>;
}

/** Texto plano del mensaje (se codifica al armar el enlace). */
export function textoMensaje(s: SolicitudEnvio): string {
  const negocio = s.nombreNegocio === '' ? '' : ` de ${s.nombreNegocio}`;
  return `Su recibo${negocio} N.º ${s.numero} por ${s.total}: ${s.enlacePdf}`;
}

/**
 * Enlace `wa.me` con el texto y el enlace al PDF; sin costo. Abre el chat con el
 * mensaje preparado: lo envía la persona, por eso el estado es `enlace_generado`, nunca `enviado`.
 */
export class EnviadorWaMe implements EnviadorRecibo {
  constructor(private readonly codigoPais: string = '591') {
    if (!/^\d{1,3}$/.test(codigoPais)) throw new ErrorRecibo('codigoPais inválido');
  }

  enviar(s: SolicitudEnvio): Promise<ResultadoEnvio> {
    if (!esUrlHttps(s.enlacePdf)) return Promise.resolve({ estado: 'fallido' });
    const digitos = s.telefono.replace(/\D/g, '');
    if (digitos.length < 6 || digitos.length > 15) return Promise.resolve({ estado: 'fallido' });
    // Un número local (hasta 8 dígitos) lleva el código de país por defecto.
    const numero = digitos.length <= 8 ? `${this.codigoPais}${digitos}` : digitos;
    return Promise.resolve({ estado: 'enlace_generado', enlace: `https://wa.me/${numero}?text=${encodeURIComponent(textoMensaje(s))}` });
  }
}

/** Implementación simulada para pruebas: registra las solicitudes y devuelve un resultado fijo. */
export class EnviadorSimulado implements EnviadorRecibo {
  readonly solicitudes: SolicitudEnvio[] = [];
  constructor(private readonly resultado: ResultadoEnvio = { estado: 'enviado' }) {}

  enviar(s: SolicitudEnvio): Promise<ResultadoEnvio> {
    this.solicitudes.push(s);
    return Promise.resolve(this.resultado);
  }
}

/**
 * Envía el comprobante por el puerto y registra `envioWhatsapp.estado` con lo que ocurrió de verdad:
 * `sin_telefono` si la venta no trajo teléfono (no se llama al puerto), `fallido` si el puerto falla.
 * No se envían comprobantes anulados. Devuelve el resultado, con el enlace si lo hay.
 */
export async function enviarRecibo(
  ejecutor: EjecutorRecibos,
  enviador: EnviadorRecibo,
  p: { tenantId: string; reciboId: string; actor: ActorAuditado; enlacePdf: string; ahora?: () => string },
): Promise<ResultadoEnvio | { estado: 'sin_telefono' }> {
  const ruta = rutaRecibo(p.tenantId, p.reciboId);
  const datos = await ejecutor.transaccion((tx) => tx.leer(ruta));
  if (datos === undefined) throw new ReciboNoEncontrado('Comprobante inexistente');
  const r = datos as unknown as Recibo;
  if (r.tenantId !== p.tenantId) throw new ReciboNoEncontrado('Comprobante inexistente');
  if (r.estado === 'ANULADO') throw new AccionNoPermitida('No se envía un comprobante anulado');

  let resultado: ResultadoEnvio | { estado: 'sin_telefono' };
  const telefono = r.cliente?.telefono;
  if (telefono === undefined) {
    resultado = { estado: 'sin_telefono' };
  } else {
    try {
      resultado = await enviador.enviar({
        tenantId: p.tenantId, reciboId: p.reciboId, numero: r.numero, nombreNegocio: r.plantilla.negocio.nombre,
        total: formatearMonto(r.total, r.moneda), telefono, enlacePdf: p.enlacePdf,
      });
    } catch {
      resultado = { estado: 'fallido' };
    }
  }
  const instante = (p.ahora ?? ((): string => new Date().toISOString()))();
  await ejecutor.transaccion(async (tx) => {
    tx.actualizar(ruta, { envioWhatsapp: { estado: resultado.estado, actualizadoEn: instante } });
    registrarAuditoria(tx, {
      tenantId: p.tenantId, uid: p.actor.uid, rol: p.actor.rol, accion: 'recibos.enviar', ruta,
      resumenDespues: { numero: r.numero, estadoEnvio: resultado.estado },
    });
  });
  return resultado;
}
