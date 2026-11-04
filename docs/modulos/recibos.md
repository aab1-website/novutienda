# Módulo Recibos

Dueño de: comprobantes no fiscales, numeración, plantillas del tenant, archivo de comprobantes.

## Alcance (propuesta)
Comprobante no fiscal descargable e imprimible con número de serie, garantía, moneda, cotización usada y campo para referenciar la factura fiscal externa (SUMA). Envío por WhatsApp. No entra: facturación electrónica.

## Qué hace
Consume `venta.confirmada.v1` y `venta.anulada.v1`; arma el comprobante desde el evento (no lee datos del POS) y emite `recibo.emitido.v1`. Este módulo NO numera: el número lo asigna el POS dentro de la transacción de la venta y viaja en `venta.confirmada.v1` (`numeroRecibo`); el recibo lleva ese mismo número aunque los eventos lleguen desordenados. Id idempotente `recibo-{ventaId}`; un reintento no genera un segundo comprobante. La serie se configura solo en el POS (la plantilla no la tiene). Si `venta.anulada` llega antes que `venta.confirmada`, la anulación queda registrada (`anulaciones_pendientes_recibo`, solo servidor) y al llegar la venta el recibo se emite directamente ANULADO. Plantilla por tenant: logo, datos del negocio, pie de página, políticas de garantía y cambios. Archivo de comprobantes con búsqueda por número, fecha o cliente. PDF generado en el servidor con texto escapado; sin datos de pago sensibles. El comprobante anulado se marca ANULADO sin borrarse.

## Envío por WhatsApp
Define el puerto `EnviadorRecibo` (interfaz inyectable) con una implementación de enlace `wa.me` con el texto y el enlace al PDF (sin costo). El envío automático por la API de NovuChat/Meta tiene costo y requiere acuerdo con NovuChat: NO se implementa aquí; solo la interfaz y una implementación simulada para pruebas. El estado del envío queda en `envioWhatsapp.estado`.

## Datos
`recibos/{reciboId}` (ventaId, numero, moneda, cotizacion, lineas con serie y garantía, facturaSuma?, estado), `plantillas_recibo/main`, `anulaciones_pendientes_recibo/{ventaId}` (interna, lectura adm), solo servidor. Datos personales del cliente mínimos y solo si la venta los trae.

## Pruebas
Mismo evento dos veces = un recibo; el número del recibo es el del evento (también con entrega desordenada); anulación antes de la venta, en ambos órdenes y con duplicados; escape de texto en PDF; anulación marca sin borrar; aislamiento entre tenants.
