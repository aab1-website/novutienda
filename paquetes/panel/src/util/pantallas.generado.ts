// GENERADO por scripts/registro-panel.mjs desde el registro de módulos (pnpm registro:generar).
// No se edita a mano: `pnpm registro:verificar` falla si difiere de lo generado.
import type { Rol } from '@novutienda/nucleo';

export interface PantallaGenerada {
  readonly id: string;
  readonly titulo: string;
  readonly roles: readonly Rol[];
  readonly orden: number;
  /** Módulo dueño de la pantalla (`panel` para las de Central). */
  readonly modulo: string;
  readonly tituloPorRol?: Partial<Record<Rol, string>>;
}

/** Pantallas del panel según el registro, por `orden`. */
export const PANTALLAS: readonly PantallaGenerada[] = [
  { id: 'venta', titulo: 'Venta', roles: ['caj', 'sup', 'adm'], orden: 10, modulo: 'pos' },
  { id: 'recibos', titulo: 'Recibos', roles: ['caj', 'sup', 'adm'], orden: 20, modulo: 'recibos', tituloPorRol: { caj: 'Mis recibos' } },
  { id: 'inventario', titulo: 'Inventario', roles: ['sup', 'adm'], orden: 30, modulo: 'inventarios' },
  { id: 'mermas', titulo: 'Mermas', roles: ['sup', 'adm'], orden: 40, modulo: 'inventarios' },
  { id: 'aprobaciones', titulo: 'Aprobaciones', roles: ['sup', 'adm'], orden: 50, modulo: 'pos' },
  { id: 'supervision', titulo: 'Supervisión', roles: ['sup', 'adm'], orden: 60, modulo: 'pos' },
  { id: 'catalogo', titulo: 'Catálogo y sitio', roles: ['sup', 'adm'], orden: 70, modulo: 'consola' },
  { id: 'usuarios', titulo: 'Usuarios', roles: ['adm'], orden: 80, modulo: 'panel' },
  { id: 'configuracion', titulo: 'Configuración', roles: ['adm'], orden: 90, modulo: 'panel' },
];
