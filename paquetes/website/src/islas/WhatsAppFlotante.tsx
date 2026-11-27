import { useEffect, useState } from 'preact/hooks';
import { CLAVE_CARRITO, type Carrito } from '../lib/carrito.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { enlaceWhatsApp } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { cargarCarrito, cargarNota } from './carrito-store.js';
import { CLAVE_NOTA } from '../lib/nota.js';
import { enlaceSegunPrecios } from '../lib/enlace-pedido.js';
import { usePedido } from './pedido.js';

const MENSAJE_GENERAL = 'Hola, tengo una consulta.';

/**
 * Botón flotante de WhatsApp. Sin productos en Mi pedido abre la consulta general; con productos envía el mismo
 * mensaje que el pedido (con precios y total, de `usePedido`). Sin JavaScript queda el enlace general que entrega el servidor.
 */
export default function WhatsAppFlotante({ whatsapp }: { whatsapp: string | null }) {
  const [carrito, setCarrito] = useState<Carrito>([]);
  const [nota, setNota] = useState('');
  useEffect(() => {
    setCarrito(cargarCarrito());
    setNota(cargarNota());
    const paradas = [escuchar<Carrito>(EVENTOS.carrito, setCarrito), escuchar<string>(EVENTOS.nota, setNota)];
    const entreVentanas = (e: StorageEvent): void => {
      if (e.key === null || e.key === CLAVE_CARRITO) setCarrito(cargarCarrito());
      if (e.key === null || e.key === CLAVE_NOTA) setNota(cargarNota());
    };
    window.addEventListener('storage', entreVentanas);
    return () => {
      paradas.forEach((p) => p());
      window.removeEventListener('storage', entreVentanas);
    };
  }, []);
  // `usePedido` lee la configuración del documento: solo existe en el navegador, y el carrito solo se llena allí.
  if (carrito.length > 0) return <FlotanteConPedido whatsapp={whatsapp} carrito={carrito} nota={nota} />;
  return <Boton enlace={enlaceWhatsApp(whatsapp, MENSAJE_GENERAL)} etiqueta="Escribir por WhatsApp" />;
}

function FlotanteConPedido({ whatsapp, carrito, nota }: { whatsapp: string | null; carrito: Carrito; nota: string }) {
  const { t, fallo } = usePedido(carrito);
  const r = enlaceSegunPrecios(whatsapp, carrito, t, fallo, nota);
  // Sin precios todavía no se envía nada: un mensaje sin montos saldría «en silencio». Si la carga falló, se degrada a sin montos.
  if (r.estado === 'cargando') {
    return (
      <button type="button" class="whatsapp-flotante" disabled aria-busy="true" aria-label="Preparando tu pedido con precios…">
        <Icono nombre="chat" tamano={28} />
      </button>
    );
  }
  return <Boton enlace={r.enlace} etiqueta="Enviar mi pedido por WhatsApp" />;
}

function Boton({ enlace, etiqueta }: { enlace: string | null; etiqueta: string }) {
  if (enlace === null) return null;
  return (
    <a class="whatsapp-flotante" href={enlace} target="_blank" rel="noopener noreferrer" aria-label={etiqueta}>
      <Icono nombre="chat" tamano={28} />
    </a>
  );
}
