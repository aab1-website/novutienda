import { agregar, cambiarCantidad, CLAVE_CARRITO, leerCarrito, quitar, serializarCarrito, type Carrito } from '../lib/carrito.js';
import { guardarSeguro, leerSeguro } from '../lib/almacen.js';
import { EVENTOS, emitir } from '../lib/eventos.js';
import { almacenLocal } from './navegador.js';

export const cargarCarrito = (): Carrito => leerCarrito(leerSeguro(almacenLocal(), CLAVE_CARRITO));

/** Guarda y avisa a las demás islas: así «Agregar» funciona aunque el carrito aún no haya hidratado. */
export function guardarCarrito(c: Carrito): Carrito {
  guardarSeguro(almacenLocal(), CLAVE_CARRITO, serializarCarrito(c));
  emitir(EVENTOS.carrito, c);
  return c;
}

export const agregarAlCarrito = (item: { id: string; nombre: string }): Carrito => guardarCarrito(agregar(cargarCarrito(), item));
export const cambiarEnCarrito = (id: string, delta: number): Carrito => guardarCarrito(cambiarCantidad(cargarCarrito(), id, delta));
export const quitarDelCarrito = (id: string): Carrito => guardarCarrito(quitar(cargarCarrito(), id));
export const vaciarCarrito = (): Carrito => guardarCarrito([]);
