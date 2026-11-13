// Jornada fija de caja del tenant de referencia: un turno con ventas en BOB, USD y ARS, pagos mixtos con vuelto y dos
// movimientos de caja. La comparten las pruebas de caja y de recibos. Reloj e ids inyectados.
import { abrirTurno, confirmarVenta, registrarMovimientoCaja, type Carrito } from '@novutienda/pos';
import { rutaPlantilla } from '@novutienda/recibos';
import { T, UUID, caj } from '../integracion/entorno.js';
import { crearEscenario } from './escenario.js';

export const TURNO = UUID(900);

/** Jornada con totales calculados a mano a partir de los precios fijos (centavos), no de la salida del sistema. */
export async function jornada() {
  const e = await crearEscenario();
  const d = e.depsReales;
  e.db.poner(rutaPlantilla(T), { negocio: { nombre: 'Tienda de Ejemplo', direccion: 'Calle Ficticia 123', telefono: '70000000', nit: '1000000000' }, pie: 'Gracias por su compra.', politicaGarantia: 'Garantía según ficha del producto.' });
  await abrirTurno(d, T, caj, TURNO, { BOB: 20000, USD: 5000, ARS: 100000 });

  // BOB: celular con serie (1 392,93) + 2 lápices (8,71 c/u) = 1 410,35; efectivo con vuelto + QR.
  const bob: Carrito = {
    mercado: 'BO', moneda: 'BOB', cliente: { nombre: 'Ana Pérez', telefono: '70000000' }, totalMostrado: 141035,
    lineas: [{ productoId: 'p-celular', cantidad: 1, series: ['A'] }, { productoId: 'p-lapiz', cantidad: 2 }],
  };
  await confirmarVenta(d, T, caj, UUID(1), bob, [
    { medio: 'efectivo', moneda: 'BOB', monto: 110000, cambio: 10000 },
    { medio: 'qr', moneda: 'BOB', monto: 41035, referencia: 'QR-0001' },
  ]);

  // USD: precio base sin conversión: 3 lápices (1,25) + cable (3,33) = 7,08; efectivo con vuelto en dólares + transferencia.
  const usd: Carrito = { mercado: 'BO', moneda: 'USD', totalMostrado: 708, lineas: [{ productoId: 'p-lapiz', cantidad: 3 }, { productoId: 'p-cable', cantidad: 1 }] };
  await confirmarVenta(d, T, caj, UUID(2), usd, [
    { medio: 'efectivo', moneda: 'USD', monto: 500, cambio: 92 },
    { medio: 'transferencia', moneda: 'USD', monto: 300 },
  ]);

  // ARS (mercado AR, lista AR): parlante 12 300 + 2 adaptadores a 5 300 = 22 900,00; efectivo con vuelto + transferencia.
  const ars: Carrito = { mercado: 'AR', moneda: 'ARS', totalMostrado: 2290000, lineas: [{ productoId: 'p-parlante', cantidad: 1 }, { productoId: 'p-adaptador', cantidad: 2 }] };
  await confirmarVenta(d, T, caj, UUID(3), ars, [
    { medio: 'efectivo', moneda: 'ARS', monto: 2100000, cambio: 100000 },
    { medio: 'transferencia', moneda: 'ARS', monto: 290000 },
  ]);

  // Venta en BOB de un producto sin control de stock y de otro al límite de redondeo hacia abajo.
  const servicio: Carrito = { mercado: 'BO', moneda: 'BOB', totalMostrado: 10448, lineas: [{ productoId: 'p-servicio', cantidad: 1 }] };
  await confirmarVenta(d, T, caj, UUID(4), servicio, [{ medio: 'efectivo', moneda: 'BOB', monto: 10448 }]);

  await registrarMovimientoCaja(d, T, caj, UUID(70), { tipo: 'egreso', moneda: 'USD', monto: 400, motivo: 'compra de insumos' });
  await registrarMovimientoCaja(d, T, caj, UUID(71), { tipo: 'ingreso', moneda: 'ARS', monto: 50000, motivo: 'fondo adicional' });
  return { e, d };
}
