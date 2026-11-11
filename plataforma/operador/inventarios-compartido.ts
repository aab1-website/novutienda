// Compuerta D-B1: mientras el secreto de firma de pedidos sea compartido, dos tenants con `inventarios` y host propio permitirían
// repetir una firma válida de uno contra el host del otro. La usan el mapeo de dominios y el alta. Se retira con el PR D
// (secreto por tenant). Lógica pura: el lector llega por inyección; los mensajes no llevan identificadores.

/** Lectura mínima (dentro de una transacción): un documento y los de una colección. */
export interface LectorCompuerta {
  get(ruta: string): Promise<{ readonly existe: boolean; data(): Readonly<Record<string, unknown>> | undefined }>;
  listar(coleccion: string): Promise<readonly { readonly ruta: string; data(): Readonly<Record<string, unknown>> | undefined }[]>;
}

export const MENSAJE_INVENTARIOS_COMPARTIDO =
  'otro tenant con inventarios ya tiene un host mapeado: no se admite un segundo mientras el secreto de firma de pedidos sea compartido';

/** Misma fuente que el servidor (`tenants/{t}.modulos`, claves = módulos encendidos). */
export function tieneInventarios(datos: Readonly<Record<string, unknown>> | undefined): boolean {
  const m = datos?.['modulos'];
  return typeof m === 'object' && m !== null && !Array.isArray(m) && Object.hasOwn(m, 'inventarios');
}

/**
 * `true` si otro tenant distinto de `tenantId` tiene `inventarios` y algún host mapeado. `ignorar` es la ruta de un host que
 * se está moviendo (no cuenta). Con `exigirHostPropio`, solo vale si `tenantId` ya tiene algún host (caso del alta).
 * Cuenta cualquier tenant con la clave, aunque esté suspendido o de baja: es lo más estricto.
 */
export async function otroConInventariosYHost(
  lector: LectorCompuerta,
  tenantId: string,
  o: { readonly ignorar?: string; readonly exigirHostPropio?: boolean } = {},
): Promise<boolean> {
  const docs = await lector.listar('dominios');
  const duenos = docs.filter((d) => d.ruta !== o.ignorar).map((d) => d.data()?.['tenantId']);
  if (o.exigirHostPropio === true && !duenos.includes(tenantId)) return false;
  for (const otro of new Set(duenos)) {
    if (typeof otro !== 'string' || otro === tenantId) continue;
    const ot = await lector.get(`tenants/${otro}`);
    if (ot.existe && tieneInventarios(ot.data())) return true;
  }
  return false;
}
