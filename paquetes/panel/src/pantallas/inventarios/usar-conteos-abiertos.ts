import type { ConteoAbierto } from '../../api/tipos.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';

/**
 * Conteos abiertos del tenant, leídos con `listarConteos` (lo puede pedir todo rol). A diferencia de la marca de la lista de
 * productos, que el servidor no pone para `adm`, este aviso también le llega al administrador. Si la lectura falla no se
 * inventa un aviso: la pantalla sigue con lo suyo.
 */
export function useConteosAbiertos(): readonly ConteoAbierto[] {
  const { api } = useApp();
  const c = useCarga(() => api.llamar('listarConteos', {}), []);
  return (c.datos ?? []).filter((x) => x.estado === 'abierto').map((x): ConteoAbierto => ({ ubicacionId: x.ubicacionId, conteoId: x.conteoId, abiertoEn: x.fecha }));
}
