# Módulo Inventarios

Dueño de: productos, costos, ubicaciones, existencias, unidades con serie, movimientos, traspasos, mermas, conteos, existencias públicas, operaciones. Nadie más escribe stock.

## Alcance (propuesta)
Stock en tiempo real (venta, ingreso, ajuste), alerta de mínimo, 3 almacenes con traspasos (usuario, fecha, cantidad), conteo ciego, pérdidas y mermas inmutables con autorización de supervisor, bitácora de cada acción, series y garantía por unidad, costos/precios/márgenes, importar y exportar CSV. No entra: sugerencias de compra, órdenes a proveedor, Kardex avanzado, etiquetas, inventario cíclico, reservas.

## Datos (`tenants/{t}/...`, el navegador solo lee)
- `productos/{id}` (id `^[a-z0-9][a-z0-9-]{1,59}$`, se rechaza si no cumple): nombre, categoria, marca? (opcional, filtro del catálogo), sku (único, no editable), activo, publicado, conSerie (inmutable tras el primer movimiento), garantiaMeses? (entero 1..120), minimo?, precioUSD{bo,ar} (**centavos enteros de USD**; la conversión a dólares decimales es solo de los adaptadores de la plataforma), stockTotal (solo servidor; si falta, no controla stock), bajoMinimo, version. `costos/{id}` aparte (costoUSD). `skus/{sku}` garantiza unicidad.
- `ubicaciones/{tienda|deposito-1|deposito-2}`; `existencias/{productoId}__{ubicacionId}` (cantidad entero ≥ 0).
- `unidades/{productoId}__{serie}` (estado disponible|vendida|merma, ubicacionId, ventaRef, garantiaHasta).
- `movimientos/{operacionId}__{productoId}__{ubicacionId}` solo `create`: tipo, delta, saldoUbicacion, saldoTotal, series, costoUSDUnit, referencia, por, rol, fecha.
- `operaciones/{operacionId}` (tipo, hashCarga, resultado): bitácora e idempotencia. `traspasos/`, `mermas/` (estado solicitada→aprobada|rechazada una sola vez; quien aprueba ≠ quien solicita), `conteos/{id}`, `conteoLineas/{id}` y `conteoTeoricos/{id}` (colecciones de primer nivel, no subcolecciones; los teóricos no los lee quien cuenta), `existenciasPublicas/{productoId}` (disponible, para el sitio; sin cantidades exactas por defecto).
- Invariantes con prueba: suma de existencias = stockTotal; con serie, cantidad en un almacén = unidades disponibles ahí; ningún saldo negativo.

## Regla de disponibilidad pública (única)
Un producto está **disponible** si está **activo** y su existencia en el almacén **`tienda`** es **mayor que cero**. Los pedidos descuentan siempre de `tienda`; el stock de los depósitos llega a la tienda por traspaso, así que no cuenta. Un producto que no controla stock (sin `stockTotal`) figura disponible mientras esté activo. Solo se publica disponible/agotado, nunca cantidades. La define `esDisponible` (exportada por el módulo) y `existenciasPublicas` se recalcula con ella en cada operación que mueve stock y al editar el producto (por ejemplo, al inactivarlo). La consola no la duplica: recibe `disponible` ya calculado por el adaptador del catálogo con `esDisponible`.

## Regla de garantía
`garantiaHasta` de una unidad vendida se calcula con **fecha de calendario en la zona `America/La_Paz`** (la misma regla que usa Recibos), no en UTC: se toma el día de calendario del instante de la venta en esa zona y se suman `garantiaMeses` (si el día no existe en el mes destino, el último día del mes). Una venta a las 22:00 en La Paz (02:00 UTC del día siguiente) cuenta el día de La Paz. La zona es un parámetro de `prepararSalida` (`{ zonaHoraria }`) con ese valor por defecto.

## API pública de lectura
`leerProducto`, `leerDocumentoProducto`, `leerExistencias`, `rutaColeccionProductos` y el tipo `ProductoLeido` (con `marca`, `minimo`, `publicado` y `precioCentavos`). Los adaptadores no escriben rutas a mano. `skuDesdeId(id)` deriva el SKU de forma determinista cuando quien da de alta (la consola) no lo informa: el id si cabe en 40 caracteres; si no, 31 caracteres del id + «-» + 8 del SHA-256 del id.

Alta y edición desde la consola: las operaciones de Inventarios corren dentro de la transacción de la consola, junto con la anotación de cambio del sitio y la auditoría (si una falla, ninguna queda). Las funciones reciben la transacción del llamador; las lecturas van antes de las escrituras.

## Operaciones (callables; todas con operacionId y una transacción, hasta 50 líneas)
Leer `operaciones/{id}`: si existe con el mismo hash, devolver el resultado; con otro contenido, `already-exists`. Todas las lecturas antes de escribir. `prepararSalida/aplicarSalida` (y reversión) son las funciones que el POS invoca dentro de SU transacción para vender sin desincronizar. Venta: sin stock → `failed-precondition` (en mostrador no se vende lo que no hay). Serie vendida dos veces: falla la segunda. Traspaso inmediato (sin «en tránsito»), origen≠destino. Ajuste solo adm, motivo obligatorio, no en productos con serie. Ingreso: crea unidades con `create`. Merma: solicitar (no mueve stock) / resolver (aprobada descuenta y pasa series a merma). Conteo ciego: abrir (uno por ubicación), registrar línea (guarda el teórico en el servidor), cerrar (sup/adm, firmado; faltantes → mermas solicitadas; sobrantes → movimiento de conteo). Conteo ciego completo: al cerrar, los productos con existencia en la ubicación que nadie contó (los consulta el callable en `existencias` y los pasa como `productosConExistencia`; máximo 50 productos entre contados y sin contar) se tratan como contados en 0: generan una merma solicitada a nombre de quien cierra (otro sup/adm la resuelve) y el resultado del cierre los lista en `sinContar` con un aviso en `avisos`. Registrar una serie NO verifica su estado (una vendida, en merma, de otro almacén o inexistente se acepta como «hallada» sin error, para no revelar a quien cuenta lo que el sistema espera); el cierre reporta a sup/adm las series halladas que no figuraban como disponibles en la ubicación como `sobrantesConSerie` (con aviso) y NO las mueve. `sinContar`, `sobrantesConSerie` y `avisos` van solo en el resultado del cierre, no en el documento `conteos` que también lee quien cuenta.
Pedido de WhatsApp confirmado: endpoint firmado (HMAC-SHA256, ventana de 5 min) `confirmarPedido{pedidoId, items[{productoId,cantidad}], confirmadoEn}`, operacionId `nc-{pedidoId}`, descuenta SIEMPRE de `tienda`, productos con serie: asigna la unidad más antigua; sin stock: rechaza y devuelve faltantes. Reversión `nc-anula-{pedidoId}`.

## Eventos
Emite `stock.cambiado.v1`, `stock.bajo.v1`. Consume `venta.confirmada.v1`, `venta.anulada.v1` (revierte stock y series con las líneas del evento), `pedido.confirmado.v1`.

## Consola de inventario (pantallas)
Productos y existencias por almacén, ficha, alertas de mínimo, ingreso con series, traspasos, ajuste (adm), mermas, conteo ciego, búsqueda por serie (estado, venta, vencimiento de garantía), registro de acciones con filtros y CSV, importar/exportar CSV (el CSV no toca stock salvo carga inicial; neutralizar celdas que empiezan con = + - @), márgenes por mercado.

## Pruebas obligatorias
Misma operacionId dos veces = un movimiento; misma id con otro contenido = error; dos ventas de la misma serie: una gana; quien solicitó una merma no la aprueba; no se resuelve dos veces; producto 201 rechazado; ajuste en producto con serie rechazado; aislamiento entre tenants y roles en el emulador (matriz del núcleo).
