// Doble de `inventarios.exportarTotal`: las cinco hojas con la forma del servidor (`paquetes/inventarios/src/exportacion-total.ts`), armadas
// con el estado en memoria. El panel no importa ese módulo (arrastra dependencias de servidor), así que aquí va una versión compacta.
import { aCentavos, claveDePrecio, precioDeMercado } from '@novutienda/nucleo';
import { fallo, type Contexto } from '../estado.js';

type Celda = string | number;
const TOPE_MOVIMIENTOS = 5_000;
const dec = (c: number): string => `${String(Math.floor(c / 100))}.${String(c % 100).padStart(2, '0')}`;
const si = (v: boolean): string => (v ? 'sí' : 'no');
const ALMACEN: Readonly<Record<string, string>> = { tienda: 'Tienda', 'deposito-1': 'Depósito 1', 'deposito-2': 'Depósito 2' };

export function exportarTotalDoble(c: Contexto): { hojas: { nombre: string; filas: Celda[][] }[]; recortado: boolean; seriesRecortadas: boolean } {
  if (c.rol !== 'adm') throw fallo('no-autorizado', 'Solo el administrador descarga todo el inventario.');
  const { mercados, monedaCosto = 'USD' } = c.e.comercial;
  const productos = [...c.e.productos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const nombre = (id: string): string => c.e.productos.get(id)?.nombre ?? id;
  const claves = mercados.map((m) => claveDePrecio(m.id));

  const hojaProductos: Celda[][] = [
    ['nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', ...mercados.map((m) => `precio${m.id}`), 'costo', 'activo', 'publicado'],
    ...productos.map((p) => [
      p.nombre, p.categoria, p.marca ?? '', p.sku, si(p.conSerie), p.garantiaMeses?.toString() ?? '', p.minimo?.toString() ?? '',
      ...claves.map((k) => (p.precioUSD[k] === undefined ? '' : dec(p.precioUSD[k]))), dec(p.costoUSD), si(p.activo), si(p.publicado),
    ]),
  ];
  const existencias: Celda[][] = [['Producto', 'SKU', 'Almacén', 'Cantidad'],
    ...productos.flatMap((p) => Object.entries(p.existencias).map(([u, n]): Celda[] => [p.nombre, p.sku, ALMACEN[u] ?? u, n]))];
  const series: Celda[][] = [['Producto', 'Serie', 'Estado', 'Almacén', 'Fin de garantía'],
    ...[...c.e.unidades.values()].map((u): Celda[] => [nombre(u.productoId), u.serie, u.estado, ALMACEN[u.ubicacionId] ?? u.ubicacionId, u.garantiaHasta ?? ''])];
  const movs = [...c.e.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const movimientos: Celda[][] = [['Fecha', 'Tipo', 'Producto', 'Almacén', 'Cantidad', 'Referencia'],
    ...movs.slice(0, TOPE_MOVIMIENTOS).map((m): Celda[] => [m.fecha, m.tipo, nombre(m.productoId), ALMACEN[m.ubicacionId] ?? m.ubicacionId, m.delta, m.referencia ?? ''])];

  const margenes: Celda[][] = [['Producto', 'SKU', 'Mercado', 'Moneda de venta', 'Precio de venta', 'Moneda del costo', 'Costo', 'Costo en moneda de venta', 'Margen (%)', 'Tipo de cambio', 'Fecha del tipo de cambio', 'Nota']];
  for (const p of productos) {
    for (const m of mercados) {
      const base = p.precioUSD[claveDePrecio(m.id)];
      if (base === undefined) continue;
      const k = c.e.cotizaciones[m.id] ?? null;
      const precio = precioDeMercado(base / 100, { id: m.id, monedaVenta: m.monedaVenta, monedaBase: m.monedaBase, tipoCambio: m.tieneTipoCambio ? { par: `${m.monedaVenta}/${m.monedaBase}`, fuentes: ['manual'] } : null, redondeo: c.e.redondeo[m.monedaVenta] ?? { tipo: 'decimales', decimales: 2, modo: 'cercano' } }, k === null ? null : { par: k.par, valor: k.valor });
      const cola = [k === null ? '' : String(k.valor), k === null ? '' : k.fecha];
      const costoConv = monedaCosto === m.monedaVenta ? p.costoUSD : monedaCosto === m.monedaBase && k !== null ? aCentavos((p.costoUSD / 100) * k.valor) : null;
      if (precio.tipo !== 'precio') margenes.push([p.nombre, p.sku, m.nombre, m.monedaVenta, '', monedaCosto, dec(p.costoUSD), '', '', ...cola, 'Sin tipo de cambio vigente']);
      else if (costoConv === null) margenes.push([p.nombre, p.sku, m.nombre, m.monedaVenta, dec(precio.centavos), monedaCosto, dec(p.costoUSD), '', '', ...cola, `El costo está en ${monedaCosto} y no se puede llevar a ${m.monedaVenta}`]);
      else margenes.push([p.nombre, p.sku, m.nombre, m.monedaVenta, dec(precio.centavos), monedaCosto, dec(p.costoUSD), dec(costoConv), Math.round(((precio.centavos - costoConv) / precio.centavos) * 1000) / 10, ...cola, '']);
    }
  }
  return {
    hojas: [
      { nombre: 'Productos', filas: hojaProductos }, { nombre: 'Existencias por almacén', filas: existencias }, { nombre: 'Series', filas: series },
      { nombre: 'Movimientos', filas: movimientos }, { nombre: 'Costos y márgenes', filas: margenes },
    ],
    recortado: movs.length > TOPE_MOVIMIENTOS,
    seriesRecortadas: false,
  };
}
