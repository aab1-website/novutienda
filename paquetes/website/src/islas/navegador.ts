/** Piezas del navegador compartidas por las islas (singletons por página). */
import type { AlmacenClaveValor } from '../lib/almacen.js';
import { configCliente } from '../lib/config-cliente.js';
import { crearClienteCotizacion, type ClienteCotizacion } from '../lib/cotizacion-cliente.js';
import { leerConsentimiento } from '../medicion/consentimiento.js';
import { crearMedicion, type Medicion } from '../medicion/medicion.js';

function almacen(tipo: 'localStorage' | 'sessionStorage'): AlmacenClaveValor | null {
  try {
    return typeof window === 'undefined' ? null : window[tipo];
  } catch {
    return null;
  }
}
export const almacenLocal = (): AlmacenClaveValor | null => almacen('localStorage');
export const almacenSesion = (): AlmacenClaveValor | null => almacen('sessionStorage');

let cliente: ClienteCotizacion | null = null;
/** Cliente de cotización de la página: una sola petición compartida por todas las islas. */
export function clienteCotizacion(): ClienteCotizacion {
  cliente ??= crearClienteCotizacion({
    fetch: (url) => fetch(url, { headers: { Accept: 'application/json' } }),
    sesion: almacenSesion(),
    ahora: () => Date.now(),
    base: configCliente().apiBase,
  });
  return cliente;
}

let medicion: Medicion | null = null;
/** Medición de la página; al crearse aplica el consentimiento guardado (sin él, no carga nada). */
export function medicionGlobal(): Medicion {
  if (medicion === null) {
    medicion = crearMedicion(configCliente().medicion, {
      ventana: window as unknown as Record<string, unknown>,
      cargarScript: (src) => {
        const s = document.createElement('script');
        s.async = true;
        s.src = src;
        document.head.appendChild(s);
      },
    });
    medicion.iniciar(leerConsentimiento(almacenLocal()));
  }
  return medicion;
}
