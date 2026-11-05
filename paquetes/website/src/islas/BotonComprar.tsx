import { useEffect, useState } from 'preact/hooks';
import { enlaceWhatsApp, mensajeComprar } from '../lib/whatsapp.js';
import { Icono } from './Icono.js';
import { agregarAlCarrito } from './carrito-store.js';
import { medicionGlobal } from './navegador.js';

interface Props {
  id: string;
  nombre: string;
  /** Disponibilidad al construir el sitio. */
  disponible: boolean;
  /** Número del asistente de NovuChat; sin número no se muestra el botón «Comprar». */
  whatsapp: string | null;
  /** Consulta `/api/disponibilidad` al cargar (ficha de producto). */
  verificar?: boolean;
  /** Muestra también «Agregar» al carrito de consulta. */
  conAgregar?: boolean;
  apiBase?: string;
}

/** «Comprar» abre el chat de WhatsApp con el mensaje «Hola, quiero comprar: <nombre> (cód. <id>)». */
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
  const enlace = enlaceWhatsApp(whatsapp, mensajeComprar(nombre, id));
  return (
    <div class="acciones-producto">
      {estado}
      {conAgregar && (
        <button type="button" class="boton boton-secundario" onClick={() => { agregarAlCarrito({ id, nombre }); setAviso(`${nombre} agregado a tu consulta`); window.setTimeout(() => setAviso(''), 2500); }}>
          <Icono nombre="bolsa" tamano={15} /> AGREGAR
        </button>
      )}
      {enlace !== null && (
        <a class="boton boton-cta" href={enlace} target="_blank" rel="noopener noreferrer" onClick={() => medicionGlobal().evento('clic_comprar', { id, nombre })}>
          <Icono nombre="telefono" tamano={15} /> COMPRAR
        </a>
      )}
      <p class="aviso-estado" role="status">{aviso}</p>
    </div>
  );
}
