// Doble de `inventarios.exportarTotal`: las cinco hojas con la forma del servidor (`paquetes/inventarios/src/exportacion-total.ts`), armadas
// con el estado en memoria. El panel no puede importar ese módulo (arrastra dependencias de servidor y no es dependencia del panel),
// así que aquí va una versión compacta. La paridad con la función real la verifica `pruebas/inventarios/exportacion-total-doble.test.ts`.
import { aCentavos, claveDePrecio, precioDeMercado } from '@novutienda/nucleo';
import { fallo, type Contexto } from '../estado.js';

type Celda = string | number;
const TOPE_MOVIMIENTOS = 5_000;
const TOPE_SERIES = 20_000;
const unidades = (c: number): number => c / 100;
const si = (v: boolean): string => (v ? 'sí' : 'no');
const ALMACEN: Readonly<Record<string, string>> = { tienda: 'Tienda', 'deposito-1': 'Depósito 1', 'deposito-2': 'Depósito 2' };
const TIPO: Readonly<Record<string, string>> = {
  ingreso: 'Ingreso', traspaso: 'Traspaso', ajuste: 'Ajuste', venta: 'Venta', anulacion: 'Anulación de venta', merma: 'Merma', conteo: 'Conteo', pedido: 'Pedido',
};
const ESTADO: Readonly<Record<string, string>> = { disponible: 'Disponible', vendida: 'Vendida', merma: 'Merma' };
const etiqueta = (t: Readonly<Record<string, string>>, k: string): string => t[k] ?? k;
const referencia = (r: string | undefined): string => (r === undefined || r === '' ? '' : etiqueta(TIPO, r.split(':')[0] ?? ''));
/** «AAAA-MM-DD HH:MM» en La Paz (UTC-4, sin horario de verano). */
function fechaHora(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms - 4 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') : '';
}

export function exportarTotalDoble(c: Contexto): { hojas: { nombre: string; filas: Celda[][] }[]; recortado: boolean; seriesRecortadas: boolean } {
  if (c.rol !== 'adm') throw fallo('no-autorizado', 'Solo el administrador descarga todo el inventario.');
  const { mercados, monedaCosto = 'USD' } = c.e.comercial;
  const productos = [...c.e.productos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const nombre = (id: string): string => c.e.productos.get(id)?.nombre ?? id;
  const claves = mercados.map((m) => claveDePrecio(m.id));

  const hojaProductos: Celda[][] = [
    ['nombre', 'categoria', 'marca', 'sku', 'conSerie', 'garantiaMeses', 'minimo', ...mercados.map((m) => `precio${m.id}`), 'costo', 'activo', 'publicado'],
    ...productos.map((p) => [
      p.nombre, p.categoria, p.marca ?? '', p.sku, si(p.conSerie), p.garantiaMeses ?? '', p.minimo ?? '',
      ...claves.map((k) => (p.precioUSD[k] === undefined ? '' : unidades(p.precioUSD[k]))), typeof p.costoUSD === 'number' ? unidades(p.costoUSD) : '', si(p.activo), si(p.publicado),
    ]),
  ];
  const existencias: Celda[][] = [['Producto', 'SKU', 'Almacén', 'Cantidad'],
    ...productos.flatMap((p) => Object.entries(p.existencias).sort(([x], [y]) => x.localeCompare(y, 'es')).map(([u, n]): Celda[] => [p.nombre, p.sku, ALMACEN[u] ?? u, n]))];
  const todasSeries = [...c.e.unidades.values()].sort((a, b) => nombre(a.productoId).localeCompare(nombre(b.productoId), 'es') || a.serie.localeCompare(b.serie, 'es'));
  const series: Celda[][] = [['Producto', 'Serie', 'Estado', 'Almacén', 'Fin de garantía'],
    ...todasSeries.slice(0, TOPE_SERIES).map((u): Celda[] => [nombre(u.productoId), u.serie, etiqueta(ESTADO, u.estado), ALMACEN[u.ubicacionId] ?? u.ubicacionId, u.garantiaHasta ?? ''])];
  const movs = [...c.e.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const movimientos: Celda[][] = [['Fecha', 'Tipo', 'Producto', 'Almacén', 'Cantidad', 'Referencia'],
    ...movs.slice(0, TOPE_MOVIMIENTOS).map((m): Celda[] => [fechaHora(m.fecha), etiqueta(TIPO, m.tipo), nombre(m.productoId), ALMACEN[m.ubicacionId] ?? m.ubicacionId, m.delta, referencia(m.referencia)])];

  const margenes: Celda[][] = [['Producto', 'SKU', 'Mercado', 'Moneda de venta', 'Precio de venta', 'Moneda del costo', 'Costo', 'Costo en moneda de venta', 'Margen (%)', 'Tipo de cambio', 'Fecha del tipo de cambio', 'Nota']];
  for (const p of productos) {
    for (const m of mercados) {
      const base = p.precioUSD[claveDePrecio(m.id)];
      if (base === undefined) continue;
      const k = c.e.cotizaciones[m.id] ?? null;
      const precio = precioDeMercado(base / 100, { id: m.id, monedaVenta: m.monedaVenta, monedaBase: m.monedaBase, tipoCambio: m.tieneTipoCambio ? { par: `${m.monedaVenta}/${m.monedaBase}`, fuentes: ['manual'] } : null, redondeo: c.e.redondeo[m.monedaVenta] ?? { tipo: 'decimales', decimales: 2, modo: 'cercano' } }, k === null ? null : { par: k.par, valor: k.valor });
      const cola: Celda[] = [k === null ? '' : k.valor, k === null ? '' : k.fecha];
      const conCosto = typeof p.costoUSD === 'number';
      const costo: Celda = conCosto ? unidades(p.costoUSD) : '';
      const costoConv = !conCosto ? null : monedaCosto === m.monedaVenta ? p.costoUSD : monedaCosto === m.monedaBase && k !== null ? aCentavos((p.costoUSD / 100) * k.valor) : null;
      const cab: Celda[] = [p.nombre, p.sku, m.nombre, m.monedaVenta];
      if (precio.tipo !== 'precio') margenes.push([...cab, '', monedaCosto, costo, '', '', ...cola, precio.tipo === 'invalido' && m.tieneTipoCambio && k === null ? 'Sin tipo de cambio vigente' : 'Sin precio']);
      else if (costoConv === null) margenes.push([...cab, unidades(precio.centavos), monedaCosto, costo, '', '', ...cola, !conCosto ? 'Sin costo' : `El costo está en ${monedaCosto} y no se puede llevar a ${m.monedaVenta}`]);
      else margenes.push([...cab, unidades(precio.centavos), monedaCosto, costo, unidades(costoConv), Math.round(((precio.centavos - costoConv) / precio.centavos) * 1000) / 10, ...cola, '']);
    }
  }
  return {
    hojas: [
      { nombre: 'Productos', filas: hojaProductos }, { nombre: 'Existencias por almacén', filas: existencias }, { nombre: 'Series', filas: series },
      { nombre: 'Movimientos', filas: movimientos }, { nombre: 'Costos y márgenes', filas: margenes },
    ],
    recortado: movs.length > TOPE_MOVIMIENTOS,
    seriesRecortadas: todasSeries.length > TOPE_SERIES,
  };
}
