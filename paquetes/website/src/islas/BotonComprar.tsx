import { useEffect, useState } from 'preact/hooks';
import { cantidadDe } from '../lib/carrito.js';
import { EVENTOS, emitir } from '../lib/eventos.js';
import { enlaceWhatsApp, mensajeConsulta } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { agregarAlCarrito, cargarCarrito } from './carrito-store.js';
import { medicionGlobal } from './navegador.js';

interface Props {
  id: string;
  nombre: string;
  /** Disponibilidad al construir el sitio. */
  disponible: boolean;
  /** Número del asistente de NovuChat; con él, «Comprar» es un enlace a WhatsApp que funciona sin JavaScript. */
  whatsapp: string | null;
  /** Consulta `/api/disponibilidad` al cargar (ficha de producto). */
  verificar?: boolean;
  /** Muestra también «Agregar» al carrito de consulta. */
  conAgregar?: boolean;
  apiBase?: string;
}

/**
 * «Agregar» suma el producto a la consulta; «Comprar» lo suma y abre el carrito, desde donde se envía por WhatsApp.
 * Con número, «Comprar» es un enlace real a wa.me (sin JavaScript consulta ese producto); al hidratar, el clic lo reemplaza por el carrito.
 */
export default function BotonComprar({ id, nombre, disponible, whatsapp, verificar = false, conAgregar = true, apiBase = '' }: Props) {
  const [hay, setHay] = useState(disponible);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!verificar) return;
    let vivo = true;
    fetch(`${apiBase}/api/disponibilidad?ids=${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { disponibilidad?: Record<string, string> } | null) => {
        const estado = j?.disponibilidad?.[id];
        if (vivo && (estado === 'disponible' || estado === 'agotado')) setHay(estado === 'disponible');
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [id, verificar, apiBase]);

  const estado = verificar ? <p class="estado-disponibilidad" role="status">Disponibilidad: <strong>{hay ? 'Disponible' : 'Agotado'}</strong></p> : null;
  if (!hay) {
    return <div>{estado}<p class="etiqueta-agotado"><Icono nombre="prohibido" tamano={15} /> TEMPORALMENTE AGOTADO</p></div>;
  }
  const sumar = (): number => {
    const antes = cantidadDe(cargarCarrito(), id);
    const ahora = cantidadDe(agregarAlCarrito({ id, nombre }), id);
    if (antes > 0) setAviso(`Ya estaba en tu consulta: ahora ${ahora}`);
    else setAviso(`${nombre} agregado a tu consulta`);
    window.setTimeout(() => setAviso(''), 2500);
    return ahora;
  };
  const comprar = (): void => {
    medicionGlobal().evento('clic_comprar', { id, nombre });
    sumar();
    emitir(EVENTOS.abrirCarrito);
  };
  const enlace = enlaceWhatsApp(whatsapp, mensajeConsulta([{ id, nombre, cantidad: 1 }]));
  return (
    <div class="acciones-producto">
      {estado}
      {conAgregar && (
        <button type="button" class="boton boton-secundario" onClick={sumar}>
          <Icono nombre="bolsa" tamano={15} /> AGREGAR
        </button>
      )}
      {enlace === null ? (
        <button type="button" class="boton boton-cta" onClick={comprar}>
          <Icono nombre="telefono" tamano={15} /> COMPRAR
        </button>
      ) : (
        <a class="boton boton-cta" href={enlace} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); comprar(); }}>
          <Icono nombre="telefono" tamano={15} /> COMPRAR
        </a>
      )}
      <p class="aviso-estado" role="status">{aviso}</p>
    </div>
  );
}
