# Integración con NovuChat: contrato propuesto (04/11/2026)

Estado: propuesta de la plataforma Casa Bermejo para acordar con la sesión de NovuChat. Nada de esto está implementado del lado de NovuChat. Alcance: solo la propuesta comercial firmada (catálogo hacia el asistente; cobro por el asistente; pedido registrado en la consola de NovuChat; descuento de stock al confirmar el pedido).

## 1. Catálogo (NovuChat lee de la plataforma)
`GET /api/novuchat/v1/catalogo?mercado=BO|AR` con `Authorization: Bearer <token del tenant>` (el tenant sale del token; el token se guarda como credencial de n8n y en la plataforma solo su SHA-256; rotación con dos hashes vigentes).
Respuesta 200: `{ version: 1, mercado, moneda: "BOB"|"ARS", generadoEn, cotizacion: { id, par, valor, fecha, fuente, estado: "vigente"|"ultimo_verificado" }, items: [...] }`.
Cada ítem: `id` (`^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$`, estable, nunca reutilizado), `nombre`, `precio` (unidades) y `precioCentavos` (mismo entero), `moneda`, `stock` (disponible para WhatsApp = almacén `tienda`, entero ≥ 0; `null` si el producto no controla stock), `disponible` (booleano: activo y, si controla stock, existencia en `tienda` > 0; **es el campo que decide si se ofrece**), `stockPorAlmacen`, `foto` (https), `fotos[]`, `activo: true`, `area`, `descripcion`, `urlProducto`. Solo productos publicados con precio en ese mercado; máximo 200. «Publicado» tiene una sola definición, la misma del sitio (13/11/2026): el producto tiene copia publicada (la escribe la publicación de la consola: ficha publicada y producto activo y existente en Inventario) y sigue existiendo y activo en Inventario; la marca `publicado` del producto ya no se lee. El precio, el nombre y el área son los vivos de Inventario. Un producto desactivado o borrado sale del catálogo de inmediato; del sitio, en la siguiente publicación. El formato de la respuesta no cambia.
Errores: 401 `sin_credencial`/`credencial_invalida`, 400 `mercado_invalido`, 429 `limite`, 503 `sin_cotizacion` (el flujo pasa la conversación al vendedor), 500 `interno`. Caché: `ETag` y `Cache-Control: private, max-age=60`.

## 2. Pedidos (de servidor a servidor, Functions de NovuChat hacia la plataforma)
Confirmar: `POST /api/novuchat/v1/pedidos/confirmar` con cuerpo `{ pedidoId, items: [{ productoId, cantidad }], confirmadoEn }`. Firma: `X-Marca-Tiempo` (milisegundos Unix) y `X-Firma` = HMAC-SHA256 hexadecimal de `"{marca}.{cuerpo exacto}"` con un secreto por tenant (Secret Manager de cada lado), ventana de 5 minutos.
Respuestas: 200 aplicada o ya aplicada (idempotente por `pedidoId`: operación `nc-{pedidoId}`), 400, 401, 409 (stock insuficiente: devuelve `faltantes`; no escribe nada y se puede reintentar al reponer).
Regla de negocio decidida: se descuenta SIEMPRE del almacén `tienda`; en productos con serie se asigna la unidad más antigua. Cancelar: operación `nc-anula-{pedidoId}` (reversión idempotente).
La plataforma ya implementa y prueba esto (módulo Inventarios: `confirmarPedidoFirmado`).

## 3. Lo que falta del lado de NovuChat (según su diseño del 31/10)
1. Que el adaptador del flujo apunte a esta API de catálogo (hoy la fuente es Wegic).
2. Que el carrito común (`vcVendibles`) acepte `moneda` ARS, `stock` y `foto` (afecta a Walisuma: lleva prueba de contrato).
3. Que `armarPedidoWa` tome precios de la fuente externa y admita ARS, o un camino propio para este tenant.
4. Evento que cree el pedido de Argentina (cobro por alias en pesos).
5. Acción «Confirmar» en la consola de NovuChat que llame a `pedidos/confirmar`.
6. Servidor del alias ARS y cotejo con moneda; excepción de 61 nodos.

## 4. Preguntas para NovuChat (responder por mensaje)
- P1. ¿Aceptan una fuente de catálogo externa con este contrato y extender el carrito y el armado de pedidos para ARS?
- P2. ¿Dónde se confirma el pedido: consola de NovuChat (llamada saliente) o consola de la plataforma?
- P3. ¿Qué evento crea el pedido de Argentina?
- P4. ¿El pedido lo envía el servidor de NovuChat firmado con HMAC (propuesto) o el flujo n8n?
- P5. ¿Qué datos de entrega viajan a la plataforma (DNI/CI, dirección)? Mínimos, solo si la confirmación ocurre en la plataforma.
- P6. Si el BNA falla, ¿se usa el A 3500 o el último valor del BNA?
- P7. ¿Cuántos días hábiles puede tener el último valor verificado antes de pasar al vendedor?
- P8. ¿Se mantiene Wegic como fuente transitoria hasta que salga el sitio nuevo, y quién mantiene ese adaptador?
- P9. El botón «Comprar» del sitio abre el chat con «Hola, quiero comprar: <nombre> (cód. <id>)»: ¿el flujo extrae el código con una expresión fija? ¿Qué número de WhatsApp?
- P10. El recibo se envía hoy como enlace `wa.me`. La propuesta dice «envío automático»: ¿pueden enviarlo por el número del asistente, y con qué costo?

## 5. Lectura desde la consola de NovuChat (decisión de Andres, 04/11/2026)
El panel único de gestión de Casa Bermejo es independiente de la consola de NovuChat (ver docs/panel-unico.md). La consola de NovuChat podrá recuperar información de inventarios y productos de la plataforma con endpoints de solo lectura, con el mismo token por tenant que el catálogo: `GET /api/novuchat/v1/catalogo` (precio final y stock) y, si se necesita más detalle, `GET /api/novuchat/v1/inventario` (existencias por almacén). No se escribe en la plataforma salvo la confirmación de pedido firmada del §2.

## 6. Propiedades de producto (v1.1 aditiva)
Especificación acordada con NovuChat el 05/11/2026: `docs/contratos/propiedades-de-producto-v1.1.md`. No construida aún; el alcance para `casa-bermejo` es decisión aparte de Andres.

**Destino de la llamada (PR B).** El tenant del pedido firmado sale del host, no de la firma: NovuChat configura `baseUrl` con el dominio del sitio del tenant (por ejemplo `https://tienda-a.test`), nunca con la URL directa de la función (sin `x-forwarded-host` responde `404`). El host debe estar mapeado en `dominios` (`docs/produccion/dominios-de-tenant.md`).

## 7. Encendido por tenant y esta API
El encendido de módulos por tenant rige para callables, menú, programadas y también para la API HTTP (`/api/*`, incluidos los endpoints de NovuChat), desde L3. Con el módulo dueño de la ruta apagado, la API responde `401 credencial_invalida` en los endpoints de NovuChat (indistinguible de un token inválido; el motivo queda solo en el log de la plataforma) y `404 no_encontrado` en las rutas del sitio. El control corre después de autenticar el token o la firma, y falla cerrado si el tenant no tiene documento. Por la caché de módulos (60 s) y la caché HTTP de las respuestas (`max-age=60`), apagar un módulo puede tardar hasta unos 120 s en notarse del lado de NovuChat. No hay cambio de contrato: los códigos ya estaban en la lista de errores.
