import { registrarAuditoria, type Actor } from '@plataforma/nucleo';
import { anotarCambio, leerEstadoSitio } from './cambios.js';
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

const CLAVES_DATOS = ['nombre', 'categoria', 'marca', 'sku', 'activo', 'garantiaMeses'] as const;

/** Valida datos de producto (completos si `completo`, parciales si no). Lanza `entrada-invalida`. */
export function validarDatosProducto(x: unknown, completo: boolean): Partial<DatosProducto> {
  const errores: string[] = [];
  if (!esObjeto(x)) throw new ErrorConsola('entrada-invalida', 'Los datos del producto deben ser un objeto');
  soloClaves(x, CLAVES_DATOS, 'producto', errores);
  const d: { -readonly [k in keyof DatosProducto]?: DatosProducto[k] } = {};
  for (const [c, max, req] of [['nombre', 120, true], ['categoria', 60, true], ['marca', 60, false]] as const) {
    if (x[c] === undefined) {
      if (completo && req) errores.push(`${c}: es obligatorio`);
      continue;
    }
    const v = textoPlano(x[c], c, { min: req ? 1 : 0, max }, errores);
    if (v !== undefined && v !== '') d[c] = v;
  }
  if (x['sku'] !== undefined) {
    if (typeof x['sku'] !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(x['sku'])) errores.push('sku: inválido');
    else d.sku = x['sku'];
  }
  if (x['activo'] !== undefined) {
    if (typeof x['activo'] !== 'boolean') errores.push('activo: debe ser verdadero o falso');
    else d.activo = x['activo'];
  } else if (completo) d.activo = true;
  const g = x['garantiaMeses'];
  if (g !== undefined) {
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 0 || g > 120) errores.push('garantiaMeses: entero de 0 a 120');
    else d.garantiaMeses = g;
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

async function registrar(deps: DepsProductos, t: string, actor: Actor, accion: string, productoId: string, resumen: Record<string, number | string>): Promise<void> {
  const ahora = new Date(deps.reloj.ahora()).toISOString();
  await deps.db.runTransaction(async (tx) => {
    const estado = await leerEstadoSitio(tx, t);
    anotarCambio(tx, t, estado, ahora);
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
  await deps.catalogo.crearProducto(t, e.productoId, datos, precio, e.actor.uid);
  await registrar(deps, t, e.actor, 'producto.crear', e.productoId, { precioBo: precio.bo, precioAr: precio.ar });
}

export async function editarProductoConsola(
  deps: DepsProductos, e: { tenantId: string; actor: Actor; productoId: string; cambios: unknown },
): Promise<void> {
  const t = tenantValido(e.tenantId);
  exigirRol(e.actor, t, ROLES.administrar);
  const cambios = validarDatosProducto(e.cambios, false);
  if (Object.keys(cambios).length === 0) throw new ErrorConsola('entrada-invalida', 'No hay cambios');
  if ((await deps.catalogo.leerProducto(t, e.productoId)) === undefined) throw new ErrorConsola('no-encontrado', 'El producto no existe');
  await deps.catalogo.actualizarDatosProducto(t, e.productoId, cambios, e.actor.uid);
  await registrar(deps, t, e.actor, 'producto.editar', e.productoId, { campos: Object.keys(cambios).length });
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
  await deps.catalogo.actualizarPrecioUSD(t, e.productoId, precio, e.actor.uid);
  await registrar(deps, t, e.actor, 'producto.precio', e.productoId, {
    antesBo: previo.precioUSD.bo, antesAr: previo.precioUSD.ar, precioBo: precio.bo, precioAr: precio.ar,
  });
}
