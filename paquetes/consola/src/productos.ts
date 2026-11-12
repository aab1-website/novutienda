import { registrarAuditoria, type Actor, type TransaccionIdentidad } from '@novutienda/nucleo';
import { ErrorConsola } from './errores.js';
import { exigirRol, ROLES } from './permisos.js';
import type { BaseDatosConsola, CatalogoPuerto, DatosProducto, PrecioUSD, Reloj } from './puertos.js';
import { ID_PRODUCTO, rutaFicha, tenantValido } from './rutas.js';
import { esObjeto, soloClaves, textoPlano } from './validar.js';

export interface DepsProductos {
  readonly db: BaseDatosConsola;
  readonly catalogo: CatalogoPuerto;
  readonly reloj: Reloj;
}

const CLAVES_ALTA = ['nombre', 'categoria', 'marca', 'sku', 'activo', 'garantiaMeses', 'conSerie', 'minimo', 'publicado'] as const;
/** El SKU no se edita y `conSerie` solo se define al crear. */
const CLAVES_EDICION = ['nombre', 'categoria', 'marca', 'activo', 'garantiaMeses', 'minimo', 'publicado'] as const;
/** Mismo formato que el SKU de Inventarios. */
const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** Valida datos de producto (completos si `completo`, parciales si no). Lanza `entrada-invalida`. */
export function validarDatosProducto(x: unknown, completo: boolean): Partial<DatosProducto> {
  const errores: string[] = [];
  if (!esObjeto(x)) throw new ErrorConsola('entrada-invalida', 'Los datos del producto deben ser un objeto');
  if (!completo && x['sku'] !== undefined) errores.push('sku: no se edita una vez creado el producto');
  soloClaves(x, completo ? CLAVES_ALTA : [...CLAVES_EDICION, ...(x['sku'] !== undefined ? ['sku' as const] : [])], 'producto', errores);
  const d: { -readonly [k in keyof DatosProducto]?: DatosProducto[k] } = {};
  for (const [c, max, req] of [['nombre', 120, true], ['categoria', 60, true], ['marca', 60, false]] as const) {
    if (x[c] === undefined) {
      if (completo && req) errores.push(`${c}: es obligatorio`);
      continue;
    }
    const v = textoPlano(x[c], c, { min: req ? 1 : 0, max }, errores);
    if (v !== undefined && v !== '') d[c] = v;
  }
  if (completo && x['sku'] !== undefined) {
    if (typeof x['sku'] !== 'string' || !SKU.test(x['sku'])) errores.push('sku: inválido');
    else d.sku = x['sku'];
  }
  if (x['activo'] !== undefined) {
    if (typeof x['activo'] !== 'boolean') errores.push('activo: debe ser verdadero o falso');
    else d.activo = x['activo'];
  } else if (completo) d.activo = true;
  for (const c of ['conSerie', 'publicado'] as const) {
    if (x[c] === undefined) continue;
    if (typeof x[c] !== 'boolean') errores.push(`${c}: debe ser verdadero o falso`);
    else d[c] = x[c];
  }
  const g = x['garantiaMeses'];
  if (g !== undefined) {
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 1 || g > 120) errores.push('garantiaMeses: entero de 1 a 120');
    else d.garantiaMeses = g;
  }
  const m = x['minimo'];
  if (m !== undefined) {
    if (typeof m !== 'number' || !Number.isSafeInteger(m) || m < 0) errores.push('minimo: entero mayor o igual que 0');
    else d.minimo = m;
  }
  if (errores.length > 0) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', errores);
  return d;
}

/** Precio base en USD por mercado: 0 = «a consultar»; hasta 2 decimales. */
export function validarPrecioUSD(x: unknown): PrecioUSD {
  if (!esObjeto(x)) throw new ErrorConsola('entrada-invalida', 'El precio debe ser un objeto {bo, ar}');
  const errores: string[] = [];
  soloClaves(x, ['bo', 'ar'], 'precioUSD', errores);
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 9_999_999 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  if (!ok(x['bo'])) errores.push('precioUSD.bo: número en USD, 0 a 9 999 999, hasta 2 decimales');
  if (!ok(x['ar'])) errores.push('precioUSD.ar: número en USD, 0 a 9 999 999, hasta 2 decimales');
  if (errores.length > 0) throw new ErrorConsola('entrada-invalida', 'Hay datos inválidos', errores);
  return { bo: x['bo'] as number, ar: x['ar'] as number };
}

/**
 * Corre `escribir` (la operación de Inventarios) y, en la MISMA transacción, registra la auditoría: si cualquiera falla,
 * no queda ninguna. El cambio sin publicar del sitio NO se anota aquí: la biblioteca de Inventarios publica
 * `producto.cambiado` en esta misma transacción y lo cuenta `consumirProductoCambiado` (una sola vía, sin doble conteo).
 */
async function enTransaccion(
  deps: DepsProductos, t: string, actor: Actor, accion: string, productoId: string, resumen: Record<string, number | string>,
  escribir: (tx: TransaccionIdentidad) => Promise<void>,
): Promise<void> {
  await deps.db.runTransaction(async (tx) => {
    await escribir(tx);
    registrarAuditoria(tx, { tenantId: t, uid: actor.uid, rol: 'adm', accion, ruta: rutaFicha(t, productoId), resumenDespues: resumen });
  });
}

/** Crea un producto por el puerto (el tope de 200 lo aplica el catálogo; el error `LimiteDelPlan` se propaga). Solo adm. */
export async function crearProductoConsola(
  deps: DepsProductos, e: { tenantId: string; actor: Actor; productoId: string; datos: unknown; precioUSD: unknown },
): Promise<void> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.administrar);
  if (!ID_PRODUCTO.test(e.productoId)) throw new ErrorConsola('entrada-invalida', 'productoId inválido');
  const datos = validarDatosProducto(e.datos, true) as DatosProducto;
  const precio = validarPrecioUSD(e.precioUSD);
  await enTransaccion(deps, t, e.actor, 'producto.crear', e.productoId, { precioBo: precio.bo, precioAr: precio.ar }, (tx) =>
    deps.catalogo.crearProducto(tx, t, e.productoId, datos, precio, e.actor.uid),
  );
}

export async function editarProductoConsola(
  deps: DepsProductos, e: { tenantId: string; actor: Actor; productoId: string; cambios: unknown },
): Promise<void> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.administrar);
  const cambios = validarDatosProducto(e.cambios, false);
  if (Object.keys(cambios).length === 0) throw new ErrorConsola('entrada-invalida', 'No hay cambios');
  if ((await deps.catalogo.leerProducto(t, e.productoId)) === undefined) throw new ErrorConsola('no-encontrado', 'El producto no existe');
  await enTransaccion(deps, t, e.actor, 'producto.editar', e.productoId, { campos: Object.keys(cambios).length }, (tx) =>
    deps.catalogo.actualizarDatosProducto(tx, t, e.productoId, cambios, e.actor.uid),
  );
}

/** Cambia el precio USD por mercado a través de Inventarios. Solo adm: el precio compromete ingresos. */
export async function cambiarPrecioUSD(
  deps: DepsProductos, e: { tenantId: string; actor: Actor; productoId: string; precioUSD: unknown },
): Promise<void> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.administrar);
  const precio = validarPrecioUSD(e.precioUSD);
  const previo = await deps.catalogo.leerProducto(t, e.productoId);
  if (previo === undefined) throw new ErrorConsola('no-encontrado', 'El producto no existe');
  await enTransaccion(
    deps, t, e.actor, 'producto.precio', e.productoId,
    { antesBo: previo.precioUSD.bo, antesAr: previo.precioUSD.ar, precioBo: precio.bo, precioAr: precio.ar },
    (tx) => deps.catalogo.actualizarPrecioUSD(tx, t, e.productoId, precio, e.actor.uid),
  );
}
