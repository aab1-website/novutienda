import type { Mercado, Redondeo } from '@novutienda/nucleo';
import { vistaPrecio } from '../lib/precio-vista.js';
import { useCotizacion, useMercado } from './estado.js';

interface Props {
  /** Precio base en USD por mercado (0 = consultar). */
  usd: Readonly<Record<Mercado, number>>;
  inicial: Mercado;
  mercados: readonly Mercado[];
  redondeo: Redondeo;
  /** Texto de la etiqueta («Precio»); vacío para no mostrarla. */
  etiqueta?: string;
}

/** Precio final con la cotización oficial: la misma función `precioFinal` que usa el servidor. */
export default function Precio({ usd, inicial, mercados, redondeo, etiqueta = 'PRECIO' }: Props) {
  const [mercado] = useMercado(inicial, mercados);
  const cot = useCotizacion(mercado);
  const v = vistaPrecio(usd[mercado], mercado, cot, redondeo);
  return (
    <div class="precio" aria-live="polite">
      {etiqueta !== '' && <span class="precio-etiqueta">{etiqueta}</span>}
      {v.tipo === 'precio' && <span class="precio-valor">{v.texto}</span>}
      {v.tipo === 'consultar' && <span class="precio-valor precio-consultar">Consultar</span>}
      {v.tipo === 'cargando' && <span class="precio-valor precio-cargando">Calculando…</span>}
      {v.tipo === 'sin_cotizacion' && <span class="precio-valor precio-consultar">Precio no disponible por ahora. Consúltalo por WhatsApp.</span>}
      {v.tipo === 'precio' && v.aviso !== null && <span class="precio-aviso">{v.aviso}</span>}
    </div>
  );
}
