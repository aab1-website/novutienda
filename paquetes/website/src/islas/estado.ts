import { useEffect, useState } from 'preact/hooks';
import type { Mercado } from '@novutienda/nucleo';
import { configCliente } from '../lib/config-cliente.js';
import type { CotizacionCliente } from '../lib/cotizacion-cliente.js';
import { EVENTOS, emitir, escuchar } from '../lib/eventos.js';
import { guardarMercado, leerMercado } from '../lib/mercado.js';
import { almacenLocal, clienteCotizacion } from './navegador.js';

/** Mercado elegido: arranca con el inicial del sitio (igual en servidor y cliente) y se ajusta al montar. */
export function useMercado(inicial: Mercado, permitidos: readonly Mercado[]): readonly [Mercado, (m: Mercado) => void] {
  const [mercado, setMercado] = useState<Mercado>(inicial);
  useEffect(() => {
    setMercado(leerMercado(almacenLocal(), permitidos) ?? inicial);
    return escuchar<Mercado>(EVENTOS.mercado, setMercado);
    // Solo al montar: `inicial` y `permitidos` no cambian durante la vida de la isla.
  }, []);
  return [mercado, (m) => {
    guardarMercado(almacenLocal(), m);
    setMercado(m);
    emitir(EVENTOS.mercado, m);
  }];
}

/** `undefined` mientras carga; `null` si no hay cotización utilizable. */
export function useCotizacion(mercado: Mercado): CotizacionCliente | null | undefined {
  const [cot, setCot] = useState<CotizacionCliente | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    setCot(undefined);
    void clienteCotizacion().obtener(mercado).then((c) => vivo && setCot(c));
    return () => {
      vivo = false;
    };
  }, [mercado]);
  return cot;
}

export const mercadosDelSitio = (): readonly Mercado[] => configCliente().mercados;
