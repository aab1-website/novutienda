import { useEffect, useState } from 'preact/hooks';
import { CLAVE_CARRITO, type Carrito } from '../lib/carrito.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { enlaceWhatsApp } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { cargarCarrito } from './carrito-store.js';
import { enlacePedido, usePedido } from './pedido.js';

const MENSAJE_GENERAL = 'Hola, tengo una consulta.';

/**
 * Botón flotante de WhatsApp. Sin productos en Mi pedido abre la consulta general; con productos envía el mismo
 * mensaje que el pedido (con precios y total, de `usePedido`). Sin JavaScript queda el enlace general que entrega el servidor.
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
  // `usePedido` lee la configuración del documento: solo existe en el navegador, y el carrito solo se llena allí.
  if (carrito.length > 0) return <FlotanteConPedido whatsapp={whatsapp} carrito={carrito} />;
  return <Boton enlace={enlaceWhatsApp(whatsapp, MENSAJE_GENERAL)} etiqueta="Escribir por WhatsApp" />;
}

function FlotanteConPedido({ whatsapp, carrito }: { whatsapp: string | null; carrito: Carrito }) {
  const { t } = usePedido(carrito);
  return <Boton enlace={enlacePedido(whatsapp, carrito, t)} etiqueta="Enviar mi pedido por WhatsApp" />;
}

function Boton({ enlace, etiqueta }: { enlace: string | null; etiqueta: string }) {
  if (enlace === null) return null;
  return (
    <a class="whatsapp-flotante" href={enlace} target="_blank" rel="noopener noreferrer" aria-label={etiqueta}>
      <Icono nombre="chat" tamano={28} />
    </a>
  );
}
