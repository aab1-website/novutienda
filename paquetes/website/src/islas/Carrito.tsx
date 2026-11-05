import { useEffect, useState } from 'preact/hooks';
import type { Carrito as TipoCarrito } from '../lib/carrito.js';
import { totalUnidades } from '../lib/carrito.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { enlaceWhatsApp, mensajeConsulta } from '../lib/whatsapp.js';
import { Dialogo } from './Dialogo.js';
import { Icono } from './Icono.js';
import { cambiarEnCarrito, cargarCarrito, quitarDelCarrito, vaciarCarrito } from './carrito-store.js';

/** Carrito de consulta: reúne productos y los envía por WhatsApp a la tienda. No cobra ni muestra totales. */
export default function Carrito({ whatsapp }: { whatsapp: string | null }) {
  const [abierto, setAbierto] = useState(false);
  const [carrito, setCarrito] = useState<TipoCarrito>([]);

  useEffect(() => {
    setCarrito(cargarCarrito());
    const paradas = [
      escuchar<TipoCarrito>(EVENTOS.carrito, setCarrito),
      escuchar<void>(EVENTOS.abrirCarrito, () => setAbierto(true)),
    ];
    const entreVentanas = (e: StorageEvent): void => {
      if (e.key === null || e.key === 'cb.carrito') setCarrito(cargarCarrito());
    };
    window.addEventListener('storage', entreVentanas);
    return () => {
      paradas.forEach((p) => p());
      window.removeEventListener('storage', entreVentanas);
    };
  }, []);

  const unidades = totalUnidades(carrito);
  const enlace = enlaceWhatsApp(whatsapp, mensajeConsulta(carrito));
  return (
    <>
      <button type="button" class="boton-icono boton-carrito" aria-label={`Carrito de consulta, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}`} aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <Icono nombre="carrito" />
        {unidades > 0 && <span class="insignia" aria-hidden="true">{unidades}</span>}
      </button>
      {abierto && (
        <Dialogo titulo="Mi carrito de consulta" variante="lateral" onCerrar={() => setAbierto(false)}>
          {carrito.length === 0 ? (
            <div class="carrito-vacio">
              <Icono nombre="bolsa" tamano={40} grosor={1.5} />
              <p>Tu carrito está vacío.</p>
              <a class="boton boton-secundario" href="/productos">VER CATÁLOGO</a>
            </div>
          ) : (
            <>
              <ul class="lista-carrito">
                {carrito.map((l) => (
                  <li key={l.id} class="linea-carrito">
                    <span class="linea-nombre">{l.nombre}</span>
                    <span class="cantidad" role="group" aria-label={`Cantidad de ${l.nombre}`}>
                      <button type="button" class="boton-icono boton-borde" aria-label={`Quitar una unidad de ${l.nombre}`} onClick={() => cambiarEnCarrito(l.id, -1)}><Icono nombre="menos" tamano={14} /></button>
                      <output aria-live="polite">{l.cantidad}</output>
                      <button type="button" class="boton-icono boton-borde" aria-label={`Agregar una unidad de ${l.nombre}`} onClick={() => cambiarEnCarrito(l.id, 1)}><Icono nombre="mas" tamano={14} /></button>
                    </span>
                    <button type="button" class="boton-icono" aria-label={`Eliminar ${l.nombre} del carrito`} onClick={() => quitarDelCarrito(l.id)}><Icono nombre="basura" tamano={16} /></button>
                  </li>
                ))}
              </ul>
              <p class="dialogo-texto">El precio y el envío se confirman en la conversación de WhatsApp.</p>
              {enlace !== null ? (
                <a class="boton boton-cta boton-ancho" href={enlace} target="_blank" rel="noopener noreferrer"><Icono nombre="chat" tamano={18} /> CONSULTAR POR WHATSAPP</a>
              ) : (
                <p class="aviso-estado">El envío por WhatsApp no está disponible por ahora. Usa el formulario de <a href="/contacto">contacto</a>.</p>
              )}
              <button type="button" class="enlace-boton" onClick={() => vaciarCarrito()}>Vaciar carrito</button>
            </>
          )}
        </Dialogo>
      )}
    </>
  );
}
