# Panel único de gestión (decisión de Andres, 04/11/2026)

Riesgo señalado: el cliente no querrá entrar a varias plataformas para inventario, POS, administración web, etc.

Decisión: **una plataforma separada para los procesos internos**, fuera de la consola de NovuChat, con un solo inicio de sesión y un menú por rol. NovuChat sigue siendo el asistente de WhatsApp; su consola podrá **leer** información de inventarios y productos de esta plataforma, pero no la reemplaza ni la hospeda.

## Alcance del panel (solo lo contratado)
- Venta (POS): turno, terminal, cobro, descuentos, anulaciones, ingresos y egresos, créditos, cierre y supervisión.
- Inventario: productos, existencias por almacén, series, traspasos, mermas, conteo ciego, alertas.
- Catálogo y sitio: fichas, fotos y videos, plantillas, secciones, publicar.
- Recibos: archivo de comprobantes, reimpresión, enlace de WhatsApp, factura SUMA.
- Usuarios y configuración: tres usuarios, tres roles, datos del negocio, personalización del POS.
- Menú por rol: vendedor (venta, sus recibos), supervisor (+ inventario, mermas, aprobaciones), administrador (todo).

## Reglas
- Un solo proyecto web, un solo inicio de sesión (correo verificado y contraseña), sin mezclar con la consola de NovuChat.
- Es la fuente de verdad de productos, precios y stock. NovuChat consulta por API de solo lectura (catálogo, stock por almacén) y, al confirmar un pedido, llama al endpoint firmado.
- Más robusta que lo que hoy usa el cliente: todas las escrituras críticas del lado del servidor, idempotentes, con auditoría; pruebas de punta a punta; respaldo diario.
- Diseño con la identidad visual del cliente (la del sitio aprobado), claro y oscuro.
