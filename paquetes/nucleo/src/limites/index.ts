export type { ClaveLimite, PlanId, TopesPlan } from './planes.js';
export { esPlanId, PLANES } from './planes.js';
export type { BaseDatosMin, DocLeido, TransaccionMin } from './transaccion.js';
export {
  abrirCaja,
  cerrarCaja,
  ContadorCorrupto,
  LimiteDelPlan,
  liberar,
  rutaContador,
  verificarYReservar,
} from './verificar.js';
