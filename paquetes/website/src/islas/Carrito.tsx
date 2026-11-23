import { useEffect, useState } from 'preact/hooks';
import type { Carrito as TipoCarrito } from '../lib/carrito.js';
import { totalUnidades } from '../lib/carrito.js';
import { EVENTOS, escuchar } from '../lib/eventos.js';
import { type TotalReferencial } from '../lib/total-referencial.js';
import { LEYENDA_TOTAL } from '../lib/whatsapp.js';
import { Dialogo } from './Dialogo.js';
import { Icono } from './Icono.js';
import { enlacePedido, usePedido } from './pedido.js';
import { cambiarEnCarrito, cargarCarrito, quitarDelCarrito, vaciarCarrito } from './carrito-store.js';

export { LEYENDA_TOTAL };

/** «Total referencial» en pantalla. */
function TotalPedido({ t, fallo }: { t: TotalReferencial | null; fallo: boolean }) {
  return (
    <div class="total-pedido" aria-live="polite">
      {t?.tipo === 'total' && (
        <p class="total-linea">
          <span>Total referencial</span> <strong>{t.texto}</strong>
          {t.sinPrecio > 0 && <span class="total-aviso"> + {t.sinPrecio} con precio a consultar</span>}
        </p>
      )}
      {t?.tipo === 'a_consultar' && <p class="total-linea"><span>Total referencial</span> <strong>A consultar</strong></p>}
      {t?.tipo === 'sin_cotizacion' && <p class="total-linea"><span>Total referencial</span> <strong>Total no disponible por ahora</strong></p>}
      {(t === null || t.tipo === 'cargando') && !fallo && <p class="total-linea"><span>Total referencial</span> <strong>Calculando…</strong></p>}
      {fallo && <p class="total-linea"><span>Total referencial</span> <strong>Total no disponible por ahora</strong></p>}
      <p class="dialogo-texto">{LEYENDA_TOTAL}</p>
    </div>
  );
}

/** Total y envío del pedido: el mensaje de WhatsApp lleva los mismos precios y el mismo total que se ven aquí. */
function ResumenPedido({ carrito, whatsapp }: { carrito: TipoCarrito; whatsapp: string | null }) {
  const { t, fallo } = usePedido(carrito);
  const enlace = enlacePedido(whatsapp, carrito, t);
  return (
    <>
      <TotalPedido t={t} fallo={fallo} />
      {enlace !== null ? (
        <a class="boton boton-cta boton-ancho" href={enlace} target="_blank" rel="noopener noreferrer"><Icono nombre="chat" tamano={18} /> ENVIAR PEDIDO POR WHATSAPP</a>
      ) : (
        <p class="aviso-estado">El envío por WhatsApp no está disponible por ahora. Usa el formulario de <a href="/contacto">contacto</a>.</p>
      )}
    </>
  );
}

/** Mi pedido: el único carrito del cliente. Reúne productos y los envía por WhatsApp a la tienda; el total es referencial. */
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
  return (
    <>
      <button type="button" class="boton-icono boton-carrito" aria-label={`Mi pedido, ${unidades} ${unidades === 1 ? 'producto' : 'productos'}`} aria-haspopup="dialog" onClick={() => setAbierto(true)}>
        <Icono nombre="carrito" />
        {unidades > 0 && <span class="insignia" aria-hidden="true">{unidades}</span>}
      </button>
      <div class="barra-carrito" role="region" aria-label="Tu pedido">
        <span>{unidades === 0 ? 'Tu pedido está vacío' : `${unidades} ${unidades === 1 ? 'producto' : 'productos'}`}</span>
        <button type="button" class="boton boton-cta" aria-haspopup="dialog" onClick={() => setAbierto(true)}>VER PEDIDO</button>
      </div>
      {abierto && (
        <Dialogo titulo="Mi pedido" variante="lateral" onCerrar={() => setAbierto(false)}>
          {carrito.length === 0 ? (
            <div class="carrito-vacio">
              <Icono nombre="bolsa" tamano={40} grosor={1.5} />
              <p>Tu pedido está vacío.</p>
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
                    <button type="button" class="boton-icono" aria-label={`Eliminar ${l.nombre} del pedido`} onClick={() => quitarDelCarrito(l.id)}><Icono nombre="basura" tamano={16} /></button>
                  </li>
                ))}
              </ul>
              <ResumenPedido carrito={carrito} whatsapp={whatsapp} />
              <button type="button" class="enlace-boton" onClick={() => vaciarCarrito()}>Vaciar pedido</button>
            </>
          )}
        </Dialogo>
      )}
    </>
  );
}
