# Módulo Recibos

Dueño de: comprobantes no fiscales, numeración, plantillas del tenant, archivo de comprobantes.

## Alcance (propuesta)
Comprobante no fiscal descargable e imprimible con número de serie, garantía, moneda, cotización usada y campo para referenciar la factura fiscal externa (SUMA). Envío por WhatsApp. No entra: facturación electrónica.

## Qué hace
Consume `venta.confirmada.v1` y `venta.anulada.v1`; arma el comprobante desde el evento (no lee datos del POS) y emite `recibo.emitido.v1`. Numeración correlativa sin saltos por serie, asignada en la misma transacción que la venta (contador del POS) o por este módulo con id idempotente `recibo-{ventaId}`; un reintento no genera un segundo número. Plantilla por tenant: logo, datos del negocio, pie de página, políticas de garantía y cambios. Archivo de comprobantes con búsqueda por número, fecha o cliente. PDF generado en el servidor con texto escapado; sin datos de pago sensibles. El comprobante anulado se marca ANULADO sin borrarse.

## Envío por WhatsApp
Define el puerto `EnviadorRecibo` (interfaz inyectable) con una implementación de enlace `wa.me` con el texto y el enlace al PDF (sin costo). El envío automático por la API de NovuChat/Meta tiene costo y requiere acuerdo con NovuChat: NO se implementa aquí; solo la interfaz y una implementación simulada para pruebas. El estado del envío queda en `envioWhatsapp.estado`.

## Datos
`recibos/{reciboId}` (ventaId, numero, serie, moneda, cotizacion, lineas con serie y garantía, facturaSuma?, estado), `plantillas_recibo/main`, solo servidor. Datos personales del cliente mínimos y solo si la venta los trae.

## Pruebas
Mismo evento dos veces = un recibo; números sin saltos ni duplicados con concurrencia; escape de texto en PDF; anulación marca sin borrar; aislamiento entre tenants.
