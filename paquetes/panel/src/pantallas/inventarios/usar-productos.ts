import type { ConteoAbierto, ProductoPanel } from '../../api/tipos.js';
import { marcaDe } from '../../api/marca.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';

/**
 * Productos del tenant para los selectores y las tablas del módulo. La marca de ocultamiento viaja como propiedad de la lista
 * del servidor: se lee antes de copiarla (el spread la pierde) y se guarda aparte.
 */
export function useProductos(): { lista: ProductoPanel[]; cargando: boolean; error: string | null; recargar: () => void; ocultas: boolean; conteos: readonly ConteoAbierto[] } {
  const { api } = useApp();
  const c = useCarga(() => api.llamar('listarProductos', {}), []);
  const marca = marcaDe(c.datos);
  return {
    lista: c.datos ? [...c.datos] : [],
    cargando: c.cargando,
    error: c.error,
    recargar: c.recargar,
    ocultas: marca !== undefined,
    conteos: marca?.conteosAbiertos ?? [],
  };
}
