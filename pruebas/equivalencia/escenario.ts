// Escenario fijo con la FORMA del tenant de referencia: tres monedas (BOB, USD, ARS), mercados Bolivia y Argentina, precios
// base en USD (centavos), cotizaciones BO y AR, la política de redondeo vigente y un reloj fijo. Todo es ficticio:
// nombres, ids y series inventados; ningún dato del cliente. Reloj e ids se inyectan: la suite no usa tiempo real,
// red ni aleatoriedad.
import { crearUbicacion, ingresar, crearProducto, actualizarProducto, type EntradaProducto } from '@novutienda/inventarios';
import { cargarManual, type Redondeo } from '@novutienda/nucleo';
import { almacenCotizacionesDesde } from '../../plataforma/coordinador/index.js';
import { REDONDEO_POR_DEFECTO } from '../../plataforma/funciones/servidor/redondeo.js';
import { ADM, AHORA, SUP, T, UUID, crearEntorno, op, type Entorno } from '../integracion/entorno.js';

export { ADM, AHORA, SUP, T, UUID };

/** Política vigente del tenant de referencia: BOB a dos decimales, ARS al múltiplo de 100 más cercano. */
export const REDONDEO: Redondeo = REDONDEO_POR_DEFECTO;

/** Cotizaciones con decimales que provocan redondeos hacia arriba y hacia abajo en ambos mercados. */
export const COTIZACION_BO = 6.965;
export const COTIZACION_AR = 1187.35;
export const FECHA = '2026-11-04';

export const TENANT = {
  estado: 'activo', plan: 'base',
  modulos: { consola: { version: '0.1.0', submodulos: [] }, inventarios: { version: '0.1.0', submodulos: [] }, pos: { version: '0.1.0', submodulos: [] }, recibos: { version: '0.1.0', submodulos: [] }, website: { version: '0.1.0', submodulos: [] } },
  zonaHoraria: 'America/La_Paz',
  monedas: ['BOB', 'USD', 'ARS'],
};

interface Fila {
  readonly producto: EntradaProducto;
  readonly tienda?: number;
  readonly deposito?: number;
  readonly series?: readonly string[];
  /** Descripción de la copia publicada (`publicado/producto__id`); sin ella el producto no aparece en el catálogo público. */
  readonly publicado?: { readonly slug: string; readonly descripcion: string; readonly categoria: string; readonly marca: string };
}

const base = (id: string, nombre: string, precioUSD: { bo: number; ar: number }, extra: Partial<EntradaProducto> = {}): EntradaProducto => ({
  id, nombre, categoria: 'general', sku: `SKU-${id}`, precioUSD, publicado: true, ...extra,
});

/** Productos representativos (precios en centavos de USD). */
export const PRODUCTOS: readonly Fila[] = [
  { producto: base('p-lapiz', 'Lápiz HB', { bo: 125, ar: 133 }), tienda: 10, deposito: 5, publicado: { slug: 'lapiz-hb', descripcion: 'Lápiz de grafito.', categoria: 'papeleria', marca: 'Marca Ejemplo' } },
  { producto: base('p-celular', 'Celular X1', { bo: 19999, ar: 20999 }, { conSerie: true, garantiaMeses: 12, minimo: 1, marca: 'Marca Ejemplo' }), tienda: 3, series: ['A', 'B', 'C'], publicado: { slug: 'celular-x1', descripcion: 'Celular de ejemplo.', categoria: 'celulares', marca: 'Marca Ejemplo' } },
  { producto: base('p-cable', 'Cable USB', { bo: 333, ar: 0 }), tienda: 7, publicado: { slug: 'cable-usb', descripcion: 'Solo con precio en Bolivia.', categoria: 'accesorios', marca: 'Marca Ejemplo' } },
  { producto: base('p-adaptador', 'Adaptador', { bo: 0, ar: 450 }), tienda: 4, publicado: { slug: 'adaptador', descripcion: 'Solo con precio en Argentina.', categoria: 'accesorios', marca: 'Marca Ejemplo' } },
  { producto: base('p-parlante', 'Parlante portátil', { bo: 1999, ar: 1033 }), tienda: 2, deposito: 6, publicado: { slug: 'parlante-portatil', descripcion: 'Decimales incómodos.', categoria: 'audio', marca: 'Marca Ejemplo' } },
  { producto: base('p-televisor', 'Televisor 50"', { bo: 45050, ar: 45050 }), deposito: 2, publicado: { slug: 'televisor-50', descripcion: 'Solo en depósito.', categoria: 'audio', marca: 'Marca Ejemplo' } },
  { producto: base('p-agotado', 'Cargador agotado', { bo: 1500, ar: 1500 }), publicado: { slug: 'cargador-agotado', descripcion: 'Sin existencias.', categoria: 'accesorios', marca: 'Marca Ejemplo' } },
  { producto: base('p-inactivo', 'Producto retirado', { bo: 800, ar: 800 }), tienda: 4, publicado: { slug: 'retirado', descripcion: 'Dado de baja.', categoria: 'accesorios', marca: 'Marca Ejemplo' } },
  { producto: base('p-servicio', 'Instalación', { bo: 1500, ar: 1500 }, { controlaStock: false }), publicado: { slug: 'instalacion', descripcion: 'No controla stock.', categoria: 'servicios', marca: 'Marca Ejemplo' } },
  { producto: base('p-borrador', 'Borrador sin publicar', { bo: 500, ar: 500 }, { publicado: false }), tienda: 9 },
];

export interface Escenario extends Entorno {
  /** Redondeo vigente: se usa en las ventas del POS en lugar del de pruebas de integración. */
  readonly depsReales: Entorno['deps'];
}

/** Entorno con el tenant, los almacenes, las cotizaciones, los productos y su stock, todo con el reloj y los ids fijos. */
export async function crearEscenario(): Promise<Escenario> {
  const e = crearEntorno();
  e.db.poner(`tenants/${T}`, TENANT);
  for (const u of ['tienda', 'deposito-1', 'deposito-2'] as const) {
    await e.db.runTransaction((tx) => crearUbicacion(tx, { tenantId: T, operacionId: op('ubic'), por: ADM, ubicacionId: u, nombre: u }));
  }
  const almacen = almacenCotizacionesDesde(e.db);
  for (const [mercado, valor] of [['BO', COTIZACION_BO], ['AR', COTIZACION_AR]] as const) {
    await cargarManual(almacen, { mercado, valor, fecha: FECHA, actor: { uid: 'u-adm', rol: 'adm', proveedor: 'password' }, ahoraMs: AHORA }, { tenantId: T });
  }
  for (const f of PRODUCTOS) {
    await e.db.runTransaction((tx) => crearProducto(tx, { tenantId: T, operacionId: op('prod'), por: ADM, producto: f.producto }));
    for (const [almacenId, cantidad] of [['tienda', f.tienda], ['deposito-1', f.deposito]] as const) {
      if (cantidad === undefined || cantidad <= 0) continue;
      await e.db.runTransaction((tx) =>
        ingresar(tx, { tenantId: T, operacionId: op('ing'), por: SUP, ubicacionId: almacenId, lineas: [{ productoId: f.producto.id, cantidad, ...(f.series !== undefined && almacenId === 'tienda' ? { series: [...f.series] } : {}) }] }),
      );
    }
    if (f.publicado !== undefined) {
      e.db.poner(`tenants/${T}/publicado/producto__${f.producto.id}`, {
        id: f.producto.id, slug: f.publicado.slug, nombre: f.producto.nombre, categoria: f.publicado.categoria, marca: f.publicado.marca,
        descripcion: f.publicado.descripcion, garantia: f.producto.conSerie === true ? '12 meses' : '',
        medios: [{ tipo: 'foto', alt: f.producto.nombre, ancho: 1000, alto: 800, versiones: [
          { clase: 'imagen', lado: 480, formato: 'webp', ruta: `tenants/${T}/publico/medios/${f.producto.id}/aaa-imagen480.webp` },
          { clase: 'imagen', lado: 960, formato: 'webp', ruta: `tenants/${T}/publico/medios/${f.producto.id}/bbb-imagen960.webp` },
        ] }],
        seo: {}, precioUSD: { bo: f.producto.precioUSD.bo / 100, ar: f.producto.precioUSD.ar / 100 },
      });
    }
  }
  await e.db.runTransaction((tx) => actualizarProducto(tx, { tenantId: T, operacionId: op('baja'), por: ADM, productoId: 'p-inactivo', cambios: { activo: false } }));
  return { ...e, depsReales: { ...e.deps, redondeo: REDONDEO } };
}
