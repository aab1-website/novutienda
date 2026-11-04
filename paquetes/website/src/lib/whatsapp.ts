/** Enlaces de WhatsApp. El número viene de la configuración; sin número no hay enlace (nunca uno roto). */

const RE_NUMERO = /^[1-9]\d{7,14}$/;
const MAX_MENSAJE = 1500;

export function enlaceWhatsApp(numero: string | null, mensaje: string): string | null {
  if (numero === null || !RE_NUMERO.test(numero)) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje.slice(0, MAX_MENSAJE))}`;
}

/** Mensaje prellenado del botón «Comprar»: nombre y código del producto. */
export const mensajeComprar = (nombre: string, id: string): string => `Hola, quiero comprar: ${nombre} (cód. ${id})`;

export interface LineaMensaje {
  readonly id: string;
  readonly nombre: string;
  readonly cantidad: number;
}

export function mensajeConsulta(lineas: readonly LineaMensaje[]): string {
  const items = lineas.map((l) => `- ${l.cantidad} x ${l.nombre} (cód. ${l.id})`);
  return ['Hola, quiero consultar por estos productos:', ...items].join('\n');
}
