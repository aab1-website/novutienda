import { useEffect, useState } from 'preact/hooks';
import { CLAVE_CARRITO, type Carrito } from '../lib/carrito.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { enlaceWhatsApp, mensajeConsulta } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { cargarCarrito } from './carrito-store.js';

const MENSAJE_GENERAL = 'Hola, tengo una consulta.';

/**
 * Botón flotante de WhatsApp. Sin productos en Mi pedido abre la consulta general; con productos envía el mismo
 * mensaje que el pedido. Sin JavaScript queda el enlace general que entrega el servidor.
 */
export default function WhatsAppFlotante({ whatsapp }: { whatsapp: string | null }) {
  const [carrito, setCarrito] = useState<Carrito>([]);
  useEffect(() => {
    setCarrito(cargarCarrito());
    const parar = escuchar<Carrito>(EVENTOS.carrito, setCarrito);
    const entreVentanas = (e: StorageEvent): void => {
      if (e.key === null || e.key === CLAVE_CARRITO) setCarrito(cargarCarrito());
    };
    window.addEventListener('storage', entreVentanas);
    return () => {
      parar();
      window.removeEventListener('storage', entreVentanas);
    };
  }, []);
  const enlace = enlaceWhatsApp(whatsapp, carrito.length === 0 ? MENSAJE_GENERAL : mensajeConsulta(carrito));
  if (enlace === null) return null;
  return (
    <a class="whatsapp-flotante" href={enlace} target="_blank" rel="noopener noreferrer" aria-label={carrito.length === 0 ? 'Escribir por WhatsApp' : 'Enviar mi pedido por WhatsApp'}>
      <Icono nombre="chat" tamano={28} />
    </a>
  );
}
