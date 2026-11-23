import { useEffect, useState } from 'preact/hooks';
import type { Carrito } from '../lib/carrito.js';
import { configCliente } from '../lib/config-cliente.js';
import { totalReferencial, type PreciosProductos, type TotalReferencial } from '../lib/total-referencial.js';
import { enlaceWhatsApp, mensajePedido } from '../lib/whatsapp.js';
import { useCotizacion, useMercado } from './estado.js';

/**
 * Precios del pedido: los precios base se piden una vez a un archivo estático del sitio (solo si `activo`) y se pasan
 * por `totalReferencial` (la misma cuenta que `Precio.tsx`). Lo que se ve y lo que viaja en el mensaje sale de aquí.
 */
export function usePedido(carrito: Carrito, activo = true): { readonly t: TotalReferencial | null; readonly fallo: boolean } {
  const cfg = configCliente();
  const [mercado] = useMercado(cfg.mercadoInicial, cfg.mercados);
  const cot = useCotizacion(mercado);
  const [precios, setPrecios] = useState<PreciosProductos | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    if (!activo || precios !== null) return;
    let vivo = true;
    fetch('/precios-productos.json', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('precios'))))
      .then((j: PreciosProductos) => vivo && setPrecios(j))
      .catch(() => vivo && setFallo(true));
    return () => {
      vivo = false;
    };
  }, [activo]);
  return { t: precios === null ? null : totalReferencial(carrito, precios, mercado, cot, cfg.redondeo), fallo };
}

/** Enlace de WhatsApp del pedido: con precios y total cuando hay total; si no, sin montos. */
export function enlacePedido(whatsapp: string | null, carrito: Carrito, t: TotalReferencial | null): string | null {
  const conTotal = t?.tipo === 'total' ? t : null;
  return enlaceWhatsApp(whatsapp, mensajePedido(carrito, conTotal?.lineas ?? null, conTotal?.texto ?? null));
}
