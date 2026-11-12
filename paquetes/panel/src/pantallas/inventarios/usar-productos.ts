import type { ProductoPanel } from '../../api/tipos.js';
import { useApp } from '../../ui/contexto.js';
import { useCarga } from '../../ui/hooks.js';

/** Productos del tenant para los selectores y las tablas del módulo. */
export function useProductos(): { lista: ProductoPanel[]; cargando: boolean; error: string | null; recargar: () => void } {
  const { api } = useApp();
  const c = useCarga(() => api.llamar('listarProductos', {}), []);
  return { lista: c.datos ? [...c.datos] : [], cargando: c.cargando, error: c.error, recargar: c.recargar };
}
