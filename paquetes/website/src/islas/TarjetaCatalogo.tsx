import type { Mercado, Redondeo } from '@novutienda/nucleo';
import BotonComprar from './BotonComprar.js';
import { Icono } from './Icono.js';
import Precio from './Precio.js';
import { TAMANOS_TARJETA } from '../lib/medios.js';

export interface EntradaCatalogo {
  readonly i: string;
  readonly nombre: string;
  readonly marca: string;
  readonly categoria: string;
  readonly ruta: string;
  readonly c: string;
  readonly p: Readonly<Record<Mercado, number>>;
  readonly r?: string;
  readonly u?: string;
  readonly s?: string;
}

interface Props {
  e: EntradaCatalogo;
  inicial: Mercado;
  mercados: readonly Mercado[];
  redondeo: Redondeo;
  whatsapp: string | null;
}

/** La misma tarjeta de `TarjetaProducto.astro`, pintada en el navegador con los datos del índice (solo hay productos a la venta). */
export function TarjetaCatalogo({ e, inicial, mercados, redondeo, whatsapp }: Props) {
  return (
    <article class="tarjeta" data-producto-id={e.i}>
      <div class="tarjeta-imagen">
        {e.u !== undefined ? (
          <img src={e.u} srcset={e.s} sizes={TAMANOS_TARJETA} alt="" loading="lazy" decoding="async" width="600" height="600" />
        ) : (
          <span class="tarjeta-sin-imagen"><Icono nombre="cuadricula" tamano={32} />IMAGEN DEL PRODUCTO</span>
        )}
        <span class="tarjeta-etiqueta">{e.categoria}</span>
      </div>
      <div class="tarjeta-cuerpo">
        <h3 class="tarjeta-titulo"><a href={e.ruta}>{e.nombre}</a></h3>
        <p class="tarjeta-descripcion">{e.r ?? ''}</p>
        <span class="tarjeta-detalle" aria-hidden="true">Ver más detalles</span>
        <div class="tarjeta-pie">
          <Precio usd={e.p} inicial={inicial} mercados={mercados} redondeo={redondeo} />
          <BotonComprar id={e.i} nombre={e.nombre} disponible whatsapp={whatsapp} />
        </div>
      </div>
    </article>
  );
}
