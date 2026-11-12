import { LimiteDelPlan, ContadorCorrupto, MERCADOS, PLANES, type Resumen, rutaContador, validarTenant, type TransaccionIdentidad } from '@novutienda/nucleo';
import { EntradaInvalida, EstadoInvalido, NoEncontrado } from './errores.js';
import { esDisponible, UBICACION_DISPONIBILIDAD } from './disponibilidad.js';
import { esProductoId, esSku, exigirProducto, exigirSegmento, exigirUbicacion, idExistencia, ruta } from './ids.js';
import { bajoMinimo, type Autor, type Datos, type Trabajo } from './motor.js';
import { ejecutarOperacion, exigirAutor, PERMISOS, type ResultadoOperacion } from './operacion.js';

export interface PrecioUSD {
  /** Centavos de USD por mercado (Bolivia, Argentina). */
  readonly bo: number;
  readonly ar: number;
}

export interface EntradaProducto {
  readonly id: string;
  readonly nombre: string;
  readonly categoria: string;
  /** Marca comercial (opcional): la propuesta exige filtrar el catálogo por marca. */
  readonly marca?: string;
  readonly sku: string;
  readonly activo?: boolean;
  readonly publicado?: boolean;
  readonly conSerie?: boolean;
  readonly garantiaMeses?: number;
  readonly minimo?: number;
  readonly precioUSD: PrecioUSD;
  readonly costoUSD?: number;
  /** `false` = el producto no controla stock (no tendrá `stockTotal`). Por defecto controla. */
  readonly controlaStock?: boolean;
}

const CLAVES_PRODUCTO = new Set([
  'id', 'nombre', 'categoria', 'marca', 'sku', 'activo', 'publicado', 'conSerie', 'garantiaMeses', 'minimo', 'precioUSD', 'costoUSD', 'controlaStock',
]);

const centavos = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= 100_000_000_00;
const texto = (x: unknown, nombre: string, max: number): string => {
  if (typeof x !== 'string' || x.trim() === '' || x.length > max) throw new EntradaInvalida(`${nombre} inválido`);
  return x;
};

function exigirPrecio(x: unknown): PrecioUSD {
  const p = x as Record<string, unknown> | null | undefined;
  if (typeof p !== 'object' || p === null || Array.isArray(p)) throw new EntradaInvalida('El precio debe indicar un valor por cada mercado');
  const salida: Record<string, number> = {};
  // Un precio por cada mercado del núcleo; ninguno puede faltar ni sobrar.
  for (const m of MERCADOS) {
    const clave = claveMercado(m);
    const v = p[clave];
    if (!centavos(v)) throw new EntradaInvalida(`Falta el precio del mercado ${m} o no es válido (centavos enteros de USD)`);
    salida[clave] = v;
  }
  for (const k of Object.keys(p)) if (!(k in salida)) throw new EntradaInvalida(`Mercado desconocido en el precio: ${k}`);
  return salida as unknown as PrecioUSD;
}

/** Clave del precio de un mercado (`BO` -> `bo`). */
const claveMercado = (m: string): string => m.toLowerCase();
/** Sufijo legible para la auditoría (`BO` -> `Bo`). */
const sufijoMercado = (m: string): string => m.charAt(0) + m.slice(1).toLowerCase();

/** Valida estrictamente una entrada de producto (claves desconocidas incluidas). */
export type ProductoValido = Required<Omit<EntradaProducto, 'garantiaMeses' | 'minimo' | 'costoUSD' | 'marca'>> &
  Pick<EntradaProducto, 'garantiaMeses' | 'minimo' | 'costoUSD' | 'marca'>;

export function validarEntradaProducto(x: EntradaProducto): ProductoValido {
  if (typeof x !== 'object' || x === null) throw new EntradaInvalida('producto inválido');
  for (const k of Object.keys(x)) if (!CLAVES_PRODUCTO.has(k)) throw new EntradaInvalida(`campo desconocido: ${k}`);
  if (!esProductoId(x.id)) throw new EntradaInvalida(`id de producto inválido: ${String(x.id)}`);
  if (!esSku(x.sku)) throw new EntradaInvalida('sku inválido');
  for (const k of ['activo', 'publicado', 'conSerie', 'controlaStock'] as const) {
    if (x[k] !== undefined && typeof x[k] !== 'boolean') throw new EntradaInvalida(`${k} debe ser booleano`);
  }
  if (x.garantiaMeses !== undefined && !(Number.isSafeInteger(x.garantiaMeses) && x.garantiaMeses >= 1 && x.garantiaMeses <= 120)) {
    throw new EntradaInvalida('garantiaMeses debe estar entre 1 y 120');
  }
  if (x.minimo !== undefined && !(Number.isSafeInteger(x.minimo) && x.minimo >= 0)) throw new EntradaInvalida('minimo inválido');
  if (x.costoUSD !== undefined && !centavos(x.costoUSD)) throw new EntradaInvalida('costoUSD inválido');
  const controlaStock = x.controlaStock ?? true;
  const conSerie = x.conSerie ?? false;
  if (conSerie && !controlaStock) throw new EntradaInvalida('un producto con serie debe controlar stock');
  return {
    id: x.id,
    nombre: texto(x.nombre, 'nombre', 120),
    categoria: texto(x.categoria, 'categoria', 60),
    sku: x.sku,
    activo: x.activo ?? true,
    publicado: x.publicado ?? false,
    conSerie,
    controlaStock,
    precioUSD: exigirPrecio(x.precioUSD),
    ...(x.marca !== undefined ? { marca: texto(x.marca, 'marca', 60) } : {}),
    ...(x.garantiaMeses !== undefined ? { garantiaMeses: x.garantiaMeses } : {}),
    ...(x.minimo !== undefined ? { minimo: x.minimo } : {}),
    ...(x.costoUSD !== undefined ? { costoUSD: x.costoUSD } : {}),
  };
}

/** Reserva `n` cupos del límite del plan (lecturas ahora, escritura del contador en el plan). */
export async function reservarLimite(t: Trabajo, clave: 'productos' | 'almacenes', n: number): Promise<void> {
  const tid = t.tenantId;
  const tenant = validarTenant(await t.lector.leerRuta(`tenants/${tid}`));
  if (!tenant.ok) throw new EstadoInvalido('Tenant inexistente o inválido');
  const tope = PLANES[tenant.valor.plan][clave];
  const datos = (await t.lector.leerRuta(rutaContador(tid))) ?? {};
  const usado = datos[clave] ?? 0;
  if (typeof usado !== 'number' || !Number.isSafeInteger(usado) || usado < 0) throw new ContadorCorrupto(clave, usado);
  if (usado + n > tope) throw new LimiteDelPlan(clave, tope);
  t.escribir({ ruta: rutaContador(tid), modo: 'set', datos: { ...datos, [clave]: usado + n } });
}

/** Lee lo necesario (producto y sku inexistentes) y registra las escrituras de un producto nuevo. */
export async function prepararProductoNuevo(
  t: Trabajo,
  e: ProductoValido,
  ubicaciones: readonly string[] = [],
): Promise<Datos> {
  const [previo, sku] = await Promise.all([t.lector.leer('productos', e.id), t.lector.leer('skus', e.sku)]);
  if (previo !== undefined) throw new EstadoInvalido(`El producto ${e.id} ya existe`);
  if (sku !== undefined) throw new EstadoInvalido(`El sku ${e.sku} ya está en uso`);
  const doc: Datos = {
    nombre: e.nombre,
    categoria: e.categoria,
    sku: e.sku,
    ...(e.marca !== undefined ? { marca: e.marca } : {}),
    activo: e.activo,
    publicado: e.publicado,
    conSerie: e.conSerie,
    precioUSD: { ...e.precioUSD },
    bajoMinimo: false,
    version: 1,
    ...(e.garantiaMeses !== undefined ? { garantiaMeses: e.garantiaMeses } : {}),
    ...(e.minimo !== undefined ? { minimo: e.minimo } : {}),
    ...(e.controlaStock ? { stockTotal: 0 } : {}),
  };
  doc['bajoMinimo'] = bajoMinimo(doc);
  t.sembrar(e.id, doc, ubicaciones, e.costoUSD);
  t.escribir({ ruta: ruta(t.tenantId, 'skus', e.sku), modo: 'create', datos: { productoId: e.id } });
  if (e.costoUSD !== undefined) t.escribir({ ruta: ruta(t.tenantId, 'costos', e.id), modo: 'create', datos: { costoUSD: e.costoUSD } });
  return doc;
}

export interface EntradaCrearProducto {
  readonly tenantId: string;
  readonly operacionId: string;
  readonly por: Autor;
  readonly producto: EntradaProducto;
}

/** Crea un producto (adm). Respeta el tope de 200 productos del plan. */
export async function crearProducto(tx: TransaccionIdentidad, e: EntradaCrearProducto): Promise<ResultadoOperacion<Datos>> {
  const producto = validarEntradaProducto(e.producto);
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'producto-crear',
    accion: 'inventarios.producto-crear',
    carga: producto,
    por: exigirAutor(e.por),
    roles: PERMISOS.producto,
    construir: async (t) => {
      await reservarLimite(t, 'productos', 1);
      await prepararProductoNuevo(t, producto);
      const resumen: Resumen = Object.fromEntries(
        MERCADOS.map((m) => [`precio${sufijoMercado(m)}`, (producto.precioUSD as unknown as Record<string, number>)[claveMercado(m)] ?? 0]),
      );
      return { resultado: { productoId: producto.id }, referencia: { tipo: 'producto', id: producto.id }, tipoMovimiento: 'ingreso', resumen };
    },
  });
}

/**
 * Cambios de una edición. `undefined` = sin cambio. `null` vacía un dato independiente (marca, garantía, mínimo,
 * costo); nombre, categoría y precios no se pueden vaciar.
 */
export interface CambiosProducto {
  readonly nombre?: string;
  readonly categoria?: string;
  readonly marca?: string | null;
  readonly activo?: boolean;
  readonly publicado?: boolean;
  readonly conSerie?: boolean;
  readonly garantiaMeses?: number | null;
  readonly minimo?: number | null;
  readonly precioUSD?: PrecioUSD;
  readonly costoUSD?: number | null;
}

/** Edita la ficha (adm). `conSerie` no cambia tras el primer movimiento. No toca el stock. */
export async function actualizarProducto(
  tx: TransaccionIdentidad,
  e: { tenantId: string; operacionId: string; por: Autor; productoId: string; cambios: CambiosProducto },
): Promise<ResultadoOperacion<Datos>> {
  const productoId = exigirProducto(e.productoId);
  // Una clave con `undefined` equivale a no enviarla.
  const c = Object.fromEntries(Object.entries(e.cambios).filter(([, v]) => v !== undefined)) as CambiosProducto;
  const permitidas = ['nombre', 'categoria', 'marca', 'activo', 'publicado', 'conSerie', 'garantiaMeses', 'minimo', 'precioUSD', 'costoUSD'];
  for (const k of Object.keys(c)) if (!permitidas.includes(k)) throw new EntradaInvalida(`campo no editable: ${k}`);
  if (Object.keys(c).length === 0) throw new EntradaInvalida('No hay cambios que guardar');
  const soloPrecio = Object.keys(c).length === 1 && c.precioUSD !== undefined;
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'producto-actualizar',
    accion: soloPrecio ? 'inventarios.producto-precio' : 'inventarios.producto-actualizar',
    carga: { productoId, c },
    por: exigirAutor(e.por),
    roles: PERMISOS.producto,
    construir: async (t) => {
      const prod = await t.lector.leer('productos', productoId);
      if (prod === undefined) throw new NoEncontrado(`Producto inexistente: ${productoId}`);
      const tienda = await t.lector.leer('existencias', idExistencia(productoId, UBICACION_DISPONIBILIDAD));
      const nuevo: Datos = { ...prod };
      if (c.nombre !== undefined) nuevo['nombre'] = texto(c.nombre, 'nombre', 120);
      if (c.categoria !== undefined) nuevo['categoria'] = texto(c.categoria, 'categoria', 60);
      if (c.marca === null) delete nuevo['marca'];
      else if (c.marca !== undefined) nuevo['marca'] = texto(c.marca, 'marca', 60);
      for (const k of ['activo', 'publicado'] as const) {
        if (c[k] !== undefined) {
          if (typeof c[k] !== 'boolean') throw new EntradaInvalida(`${k} debe ser booleano`);
          nuevo[k] = c[k];
        }
      }
      if (c.conSerie !== undefined && c.conSerie !== (prod['conSerie'] === true)) {
        if (typeof c.conSerie !== 'boolean') throw new EntradaInvalida('conSerie debe ser booleano');
        if (prod['conMovimientos'] === true) {
          throw new EstadoInvalido('No se puede cambiar si el producto se controla por número de serie: ya tiene movimientos de inventario.');
        }
        if (c.conSerie && typeof prod['stockTotal'] !== 'number') throw new EntradaInvalida('un producto con serie debe controlar stock');
        nuevo['conSerie'] = c.conSerie;
      }
      if (c.garantiaMeses === null) delete nuevo['garantiaMeses'];
      else if (c.garantiaMeses !== undefined) {
        if (!(Number.isSafeInteger(c.garantiaMeses) && c.garantiaMeses >= 1 && c.garantiaMeses <= 120)) throw new EntradaInvalida('garantiaMeses inválida');
        nuevo['garantiaMeses'] = c.garantiaMeses;
      }
      if (c.minimo === null) delete nuevo['minimo'];
      else if (c.minimo !== undefined) {
        if (!(Number.isSafeInteger(c.minimo) && c.minimo >= 0)) throw new EntradaInvalida('minimo inválido');
        nuevo['minimo'] = c.minimo;
      }
      const resumen: Record<string, number | string> = { campos: Object.keys(c).join(',') };
      if (c.precioUSD !== undefined) {
        const precio = exigirPrecio(c.precioUSD);
        const antes = (prod['precioUSD'] ?? {}) as Record<string, unknown>;
        for (const m of MERCADOS) {
          const k = claveMercado(m);
          const previo = antes[k];
          if (typeof previo === 'number') resumen[`antes${sufijoMercado(m)}`] = previo;
          resumen[`precio${sufijoMercado(m)}`] = (precio as unknown as Record<string, number>)[k] ?? 0;
        }
        nuevo['precioUSD'] = { ...precio };
      }
      nuevo['bajoMinimo'] = bajoMinimo(nuevo);
      nuevo['version'] = (typeof prod['version'] === 'number' ? prod['version'] : 0) + 1;
      t.escribir({ ruta: ruta(t.tenantId, 'productos', productoId), modo: 'set', datos: nuevo });
      // La disponibilidad pública depende de `activo`: se recalcula con la misma regla que el resto de operaciones.
      const stockTotal = nuevo['stockTotal'];
      const cantidadTienda = typeof tienda?.['cantidad'] === 'number' ? tienda['cantidad'] : 0;
      t.escribir({
        ruta: ruta(t.tenantId, 'existenciasPublicas', productoId),
        modo: 'set',
        datos: {
          productoId,
          disponible: esDisponible({ activo: nuevo['activo'] === true, ...(typeof stockTotal === 'number' ? { stockTotal } : {}) }, cantidadTienda),
          version: nuevo['version'],
        },
      });
      if (c.costoUSD === null) {
        // Vaciar el costo: el documento queda sin `costoUSD` (el plan solo escribe, no borra documentos).
        t.escribir({ ruta: ruta(t.tenantId, 'costos', productoId), modo: 'set', datos: {} });
      } else if (c.costoUSD !== undefined) {
        if (!centavos(c.costoUSD)) throw new EntradaInvalida('costoUSD inválido');
        t.escribir({ ruta: ruta(t.tenantId, 'costos', productoId), modo: 'set', datos: { costoUSD: c.costoUSD } });
      }
      return { resultado: { productoId }, referencia: { tipo: 'producto', id: productoId }, tipoMovimiento: 'ajuste', resumen };
    },
  });
}

/** Da de alta una ubicación (adm). Respeta el tope de 3 almacenes. */
export async function crearUbicacion(
  tx: TransaccionIdentidad,
  e: { tenantId: string; operacionId: string; por: Autor; ubicacionId: string; nombre: string },
): Promise<ResultadoOperacion<Datos>> {
  const ubicacionId = exigirUbicacion(e.ubicacionId);
  const nombre = texto(e.nombre, 'nombre', 60);
  exigirSegmento(e.operacionId, 'operacionId');
  return ejecutarOperacion(tx, {
    tenantId: e.tenantId,
    operacionId: e.operacionId,
    tipo: 'ubicacion-crear',
    accion: 'inventarios.ubicacion-crear',
    carga: { ubicacionId, nombre },
    por: exigirAutor(e.por),
    roles: PERMISOS.ubicacion,
    construir: async (t) => {
      if ((await t.lector.leer('ubicaciones', ubicacionId)) !== undefined) throw new EstadoInvalido(`La ubicación ${ubicacionId} ya existe`);
      await reservarLimite(t, 'almacenes', 1);
      t.escribir({ ruta: ruta(t.tenantId, 'ubicaciones', ubicacionId), modo: 'create', datos: { nombre, activa: true } });
      return { resultado: { ubicacionId }, referencia: { tipo: 'ubicacion', id: ubicacionId }, tipoMovimiento: 'ingreso' };
    },
  });
}
