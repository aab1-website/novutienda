# Módulo Inventarios

Dueño de: productos, costos, ubicaciones, existencias, unidades con serie, movimientos, traspasos, mermas, conteos, existencias públicas, operaciones. Nadie más escribe stock.

## Alcance (propuesta)
Stock en tiempo real (venta, ingreso, ajuste), alerta de mínimo, 3 almacenes con traspasos (usuario, fecha, cantidad), conteo ciego, pérdidas y mermas inmutables con autorización de supervisor, bitácora de cada acción, series y garantía por unidad, costos/precios/márgenes, importar y exportar CSV. No entra: sugerencias de compra, órdenes a proveedor, Kardex avanzado, etiquetas, inventario cíclico, reservas.

## Datos (`tenants/{t}/...`, el navegador solo lee)
- `productos/{id}` (id `^[a-z0-9][a-z0-9-]{1,59}$`, se rechaza si no cumple): nombre, categoria, sku, activo, publicado, conSerie (inmutable tras el primer movimiento), garantiaMeses?, minimo?, precioUSD{bo,ar}, stockTotal (solo servidor; si falta, no controla stock), bajoMinimo, version. `costos/{id}` aparte (costoUSD). `skus/{sku}` garantiza unicidad.
- `ubicaciones/{tienda|deposito-1|deposito-2}`; `existencias/{productoId}__{ubicacionId}` (cantidad entero ≥ 0).
- `unidades/{productoId}__{serie}` (estado disponible|vendida|merma, ubicacionId, ventaRef, garantiaHasta).
- `movimientos/{operacionId}__{productoId}__{ubicacionId}` solo `create`: tipo, delta, saldoUbicacion, saldoTotal, series, costoUSDUnit, referencia, por, rol, fecha.
- `operaciones/{operacionId}` (tipo, hashCarga, resultado): bitácora e idempotencia. `traspasos/`, `mermas/` (estado solicitada→aprobada|rechazada una sola vez; quien aprueba ≠ quien solicita), `conteos/{id}` con `lineas/` y `teoricos/` (los teóricos no los lee quien cuenta), `existenciasPublicas/{productoId}` (disponible, para el sitio; sin cantidades exactas por defecto).
- Invariantes con prueba: suma de existencias = stockTotal; con serie, cantidad en un almacén = unidades disponibles ahí; ningún saldo negativo.

## Operaciones (callables; todas con operacionId y una transacción, hasta 50 líneas)
Leer `operaciones/{id}`: si existe con el mismo hash, devolver el resultado; con otro contenido, `already-exists`. Todas las lecturas antes de escribir. `prepararSalida/aplicarSalida` (y reversión) son las funciones que el POS invoca dentro de SU transacción para vender sin desincronizar. Venta: sin stock → `failed-precondition` (en mostrador no se vende lo que no hay). Serie vendida dos veces: falla la segunda. Traspaso inmediato (sin «en tránsito»), origen≠destino. Ajuste solo adm, motivo obligatorio, no en productos con serie. Ingreso: crea unidades con `create`. Merma: solicitar (no mueve stock) / resolver (aprobada descuenta y pasa series a merma). Conteo ciego: abrir (uno por ubicación), registrar línea (guarda el teórico en el servidor), cerrar (sup/adm, firmado; faltantes → mermas solicitadas; sobrantes → movimiento de conteo).
Pedido de WhatsApp confirmado: endpoint firmado (HMAC-SHA256, ventana de 5 min) `confirmarPedido{pedidoId, items[{productoId,cantidad}], confirmadoEn}`, operacionId `nc-{pedidoId}`, descuenta SIEMPRE de `tienda`, productos con serie: asigna la unidad más antigua; sin stock: rechaza y devuelve faltantes. Reversión `nc-anula-{pedidoId}`.

## Eventos
Emite `stock.cambiado.v1`, `stock.bajo.v1`. Consume `venta.confirmada.v1`, `venta.anulada.v1` (revierte stock y series con las líneas del evento), `pedido.confirmado.v1`.

## Consola de inventario (pantallas)
Productos y existencias por almacén, ficha, alertas de mínimo, ingreso con series, traspasos, ajuste (adm), mermas, conteo ciego, búsqueda por serie (estado, venta, vencimiento de garantía), registro de acciones con filtros y CSV, importar/exportar CSV (el CSV no toca stock salvo carga inicial; neutralizar celdas que empiezan con = + - @), márgenes por mercado.

## Pruebas obligatorias
Misma operacionId dos veces = un movimiento; misma id con otro contenido = error; dos ventas de la misma serie: una gana; quien solicitó una merma no la aprueba; no se resuelve dos veces; producto 201 rechazado; ajuste en producto con serie rechazado; aislamiento entre tenants y roles en el emulador (matriz del núcleo).
