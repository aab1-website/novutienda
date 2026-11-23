import type { PrecioLinea } from './total-referencial.js';

/** Enlaces de WhatsApp. El número viene de la configuración; sin número no hay enlace (nunca uno roto). */

const RE_NUMERO = /^[1-9]\d{7,14}$/;
export const MAX_MENSAJE = 1500;

export function enlaceWhatsApp(numero: string | null, mensaje: string): string | null {
  if (numero === null || !RE_NUMERO.test(numero)) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje.slice(0, MAX_MENSAJE))}`;
}

export interface LineaMensaje {
  readonly id: string;
  readonly nombre: string;
  readonly cantidad: number;
}

export function mensajeConsulta(lineas: readonly LineaMensaje[]): string {
  const items = lineas.map((l) => `${l.cantidad} x ${l.nombre} (cód. ${l.id})`);
  return ['Hola, quiero comprar estos productos:', ...items].join('\n');
}

export const LEYENDA_TOTAL = 'El precio final y el envío se confirman por WhatsApp';
const ENCABEZADO = 'Hola, quiero comprar estos productos:';

/**
 * Mensaje del pedido con precios. `precios` y `total` vienen de `totalReferencial` (la misma fuente que la pantalla):
 * aquí solo se redacta. Sin total (cotización o precios no disponibles) el mensaje no lleva montos.
 * Cabe siempre en `MAX_MENSAJE`: si no entra, recorta líneas del final y conserva el total y la leyenda.
 */
export function mensajePedido(
  lineas: readonly (LineaMensaje & { readonly cantidad: number })[],
  precios: readonly PrecioLinea[] | null,
  total: string | null,
): string {
  const items = lineas.map((l) => {
    const base = `${l.cantidad} x ${l.nombre} (cód. ${l.id})`;
    const p = precios?.find((x) => x.id === l.id);
    if (p === undefined) return base;
    if (p.unitario === null || p.subtotal === null) return `${base}: precio a consultar`;
    return `${base}: ${p.unitario} c/u, subtotal ${p.subtotal}`;
  });
  const pie = [...(total !== null ? [`Total referencial: ${total}`] : []), LEYENDA_TOTAL];
  const armar = (visibles: readonly string[]): string => {
    const omitidas = items.length - visibles.length;
    const resto = omitidas > 0 ? [`… y ${omitidas} ${omitidas === 1 ? 'producto más' : 'productos más'} (se detallan por WhatsApp)`] : [];
    return [ENCABEZADO, ...visibles, ...resto, ...pie].join('\n');
  };
  let n = items.length;
  while (n > 0 && armar(items.slice(0, n)).length > MAX_MENSAJE) n -= 1;
  return armar(items.slice(0, n));
}

/** Mensaje del formulario de contacto: recorta el texto de la persona, nunca el saludo. */
export function mensajeContacto(nombre: string, mensaje: string): string {
  const cabecera = `Hola, soy ${nombre.trim().slice(0, 80)}.\n`;
  return cabecera + mensaje.trim().slice(0, Math.max(0, MAX_MENSAJE - cabecera.length));
}
