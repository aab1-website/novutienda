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

// Una sola petición por sesión: la entrada de cada cliente de la API lleva la clave (uid, tenant y rol) de quien la pidió. Si la
// clave cambia (otro usuario o tenant en la misma página), la entrada se descarta. Un error no se guarda: el siguiente montaje reintenta.
interface Entrada { readonly clave: string; readonly p: Promise<VistaComercial> }
const porSesion = new WeakMap<ClienteApi, Entrada>();

/** Pide la configuración comercial una vez por sesión (uid, tenant y rol); las llamadas repetidas de la misma sesión comparten la respuesta. */
export function cargarComercial(api: ClienteApi, uid: string, tenantId: string, rol: string): Promise<VistaComercial> {
  const clave = `${tenantId}\u0000${uid}\u0000${rol}`;
  const previa = porSesion.get(api);
  if (previa?.clave === clave) return previa.p;
  const p = api.llamar('configuracionComercial', {});
  const entrada: Entrada = { clave, p };
  porSesion.set(api, entrada);
  p.catch(() => {
    if (porSesion.get(api) === entrada) porSesion.delete(api);
  });
  return p;
}

/** Configuración comercial del comercio de la sesión. Falla cerrado: ante un error queda en `error`, sin valores inventados. */
export function useConfiguracionComercial(): EstadoComercial {
  const { api, usuario } = useApp();
  const { uid, tenantId, rol } = usuario;
  const [e, setE] = useState<EstadoComercial>({ estado: 'cargando' });
  useEffect(() => {
    let vivo = true;
    setE({ estado: 'cargando' });
    cargarComercial(api, uid, tenantId, rol).then(
      (comercial) => { if (vivo) setE({ estado: 'lista', comercial }); },
      (err: unknown) => { if (vivo) setE({ estado: 'error', mensaje: mensajeDeError(err) }); },
    );
    return () => { vivo = false; };
  }, [api, uid, tenantId, rol]);
  return e;
}
