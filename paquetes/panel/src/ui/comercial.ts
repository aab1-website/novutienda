import { useEffect, useState } from 'preact/hooks';
import type { ClienteApi } from '../api/cliente.js';
import { mensajeDeError } from '../api/errores.js';
import type { VistaComercial } from '../api/tipos.js';
import { useApp } from './contexto.js';

/** Estado de la configuración comercial: nunca hay una por defecto; sin ella, quien la usa no muestra montos ni mercados. */
export type EstadoComercial =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error'; readonly mensaje: string }
  | { readonly estado: 'lista'; readonly comercial: VistaComercial };

// Una sola petición por sesión (por cliente de la API). Un error no se guarda: el siguiente montaje reintenta.
const porSesion = new WeakMap<ClienteApi, Promise<VistaComercial>>();

/** Pide la configuración comercial una vez por sesión; las llamadas repetidas comparten la misma respuesta. */
export function cargarComercial(api: ClienteApi): Promise<VistaComercial> {
  let p = porSesion.get(api);
  if (p === undefined) {
    p = api.llamar('configuracionComercial', {});
    porSesion.set(api, p);
    p.catch(() => {
      if (porSesion.get(api) === p) porSesion.delete(api);
    });
  }
  return p;
}

/** Configuración comercial del comercio de la sesión. Falla cerrado: ante un error queda en `error`, sin valores inventados. */
export function useConfiguracionComercial(): EstadoComercial {
  const { api } = useApp();
  const [e, setE] = useState<EstadoComercial>({ estado: 'cargando' });
  useEffect(() => {
    let vivo = true;
    setE({ estado: 'cargando' });
    cargarComercial(api).then(
      (comercial) => { if (vivo) setE({ estado: 'lista', comercial }); },
      (err: unknown) => { if (vivo) setE({ estado: 'error', mensaje: mensajeDeError(err) }); },
    );
    return () => { vivo = false; };
  }, [api]);
  return e;
}
