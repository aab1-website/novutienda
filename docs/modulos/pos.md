# Módulo POS

Dueño de: turnos, ventas, cobros por moneda, arqueo, descuentos, anulaciones, ingresos/egresos de caja, créditos, configuración del POS.

## Alcance (propuesta)
Terminal con buscador en tiempo real, filtro por categoría y carrito. Apertura/cierre de turno. Arqueo separado por moneda (BOB, USD, ARS). Cobro: efectivo (con cambio), QR (registro manual con referencia, mostrado como «registrado por <usuario>», nunca «verificado»), transferencia, crédito/préstamo aprobado y pago mixto en una misma moneda. Descuentos controlados (tope por rol, motivo, aprobación de supervisor). Supervisión de caja en tiempo real. Ingresos/egresos justificados. Anulaciones inmutables. Personalización (logo, colores, datos del negocio, medios habilitados, moneda por defecto, texto del recibo). No entra: depósitos bancarios, multas al personal, utilidad, varios POS, verificación bancaria del QR, ventas en espera, apartados, proformas, comisiones, promociones, modo sin conexión.

## Reglas decididas
- Tope de descuento sin permiso del vendedor: 5 % (configurable); por encima, `discount_approvals` de un solo uso, aprobada por sup/adm (nunca autoaprobada), con motivo.
- Anulación: la solicita el vendedor (con motivo), la aprueba sup/adm con su propio motivo (`aprobarAnulacion(ventaId, motivo)`, obligatorio; se guarda como `motivoAprobador` en `anulaciones/{ventaId}` y se audita junto al del solicitante) y nunca quien vendió ni quien solicitó anular (`autoaprobacion`); revierte stock y series (evento) y el reembolso entra en el turno abierto. El reembolso se devuelve por los medios con que se cobró (`reembolsos[]` en `venta.anulada.v1`, suma = lo realmente cobrado, incluidos los cobros de crédito; el crédito pendiente se cancela aparte y no se reembolsa): el efectivo sale de la caja de esa moneda (se rechaza si no alcanza); QR y transferencia se informan aparte y no restan del efectivo. Una venta no se anula dos veces (supuesto a confirmar).
- Créditos: aprobados por sup/adm, con nombre del deudor; el cobro posterior entra al turno en que se cobra (supuesto a confirmar).
- 1 caja activa por turno: usa `abrirCaja`/`cerrarCaja` del núcleo; cerrar solo si el turno está abierto, en la misma transacción (un doble cierre liberaría el cupo de otro turno).

## Datos (`tenants/{t}/...`, todo escrito solo por el servidor)
`pos_config/main`, `turnos/{id}` (estado abierto→cerrado|cerrado_forzado; apertura, contado, esperado y diferencia por moneda), `ventas/{ventaId}` (ventaId = requestId UUID del cliente → idempotente; items, descuento, pagos, cliente, cotización, receiptNo, estado), `anulaciones/{ventaId}` (solo creación), `aprobaciones_descuento/{id}`, `movimientos_caja/{requestId}` (ingreso|egreso, moneda, motivo, comprobante, turnoId), `creditos/{ventaId}` y `cobros_credito/{requestId}`, `contadores/recibo_{serie}` (correlativo dentro de la transacción de la venta). El POS es el único dueño del número del recibo: lo viaja en `venta.confirmada.v1` como `numeroRecibo` (p. ej. A-000001) y la serie se configura solo aquí (`pos_config`).
Arqueo por moneda m: `esperado[m] = apertura[m] + Σ efectivo neto de cambio[m] + Σ cobros de crédito en efectivo[m] + ingresos[m] − egresos[m] − reembolsos en efectivo[m]`; `diferencia = contado − esperado` SIN tope en cero (DemoMJ lo tapaba con Math.max). QR, transferencia y crédito se informan aparte y nunca suman al efectivo; un reembolso en QR o transferencia resta de su propio total, no del efectivo. Un egreso mayor al efectivo de esa moneda se rechaza en el servidor. El cierre forzado (solo adm) usa la misma fórmula que el normal.

## Callable `confirmarVenta(requestId, carrito, pagos, aprobacionId?)` — UNA transacción de Firestore
1) Si `ventas/{requestId}` existe, devolverla. 2) Turno abierto del usuario y caja activa. 3) Recalcular precios en el servidor desde el catálogo y la cotización vigente (el cliente no fija precios); validar descuento contra el tope o la aprobación; suma de pagos − cambio = total; cobro en una sola moneda (la de la venta); cambio solo en efectivo. 4) Descontar con `prepararSalida/aplicarSalida` de Inventarios (stock insuficiente o serie no disponible aborta todo). 5) Escribir venta, contador del recibo (el número formateado va en el evento como `numeroRecibo`), crédito si corresponde (con el desglose de sus cobros por medio), evento `venta.confirmada.v1` y auditoría. La lista de precios es la del mercado de la venta (BOL o ARG según la moneda elegida al abrir la venta) (supuesto a confirmar).

## Eventos
Emite `venta.confirmada.v1`, `venta.anulada.v1`, `turno.cerrado.v1`. Consume cotización vigente (núcleo) y existencias (lectura).

## Pantallas
Ingreso (correo y contraseña), apertura de turno (efectivo por moneda), terminal, cobro, solicitud/aprobación de descuento, recibo (vista, PDF, imprimir, WhatsApp, N.º de factura SUMA), ingresos y egresos, cobro de créditos, cierre con conteo por moneda, supervisión en vivo, anulaciones, auditoría y CSV, configuración del POS, usuarios (3).

## Pruebas obligatorias
Venta sin turno o con turno ajeno; segundo turno con la caja ocupada; precio o total alterado por el cliente; descuento sobre el tope sin aprobación o con aprobación reutilizada/vencida/autoaprobada; pagos ≠ total o en otra moneda; stock insuficiente o serie vendida; reintento con el mismo requestId descuenta una vez; egreso mayor al efectivo; anular dos veces; vendedor que anula; CSV con celdas que empiezan con = + - @; el arqueo con diferencia negativa no se tapa.
