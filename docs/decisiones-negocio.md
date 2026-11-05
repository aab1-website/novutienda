# Decisiones de negocio vigentes (Andres, 04/11/2026)

Fuente única para los agentes. Lo que no está aquí ni en la propuesta comercial no se construye.

| Tema | Decisión |
|---|---|
| Alcance | Solo la propuesta comercial del 03/11/2026 y su Anexo A. Prevalece sobre acuerdos previos con NovuChat. |
| Roles | Tres: `caj` (vendedor), `sup` (supervisor), `adm` (administrador). No existe «dirección». |
| Descuento del vendedor | Hasta 5 % sin permiso; por encima, aprobación de `sup`/`adm` con motivo. Configurable en el POS. |
| Anulación de venta | La solicita el vendedor, la aprueba `sup`/`adm` con motivo. Reembolso por los medios con que se cobró. |
| Pedido de WhatsApp | Al confirmarlo, descuenta stock en la plataforma, siempre del almacén `tienda`; serie más antigua. |
| Recibo | Lleva el nombre del producto. Envío por WhatsApp como enlace `wa.me` que la persona envía (sin costo); el automático se cotiza aparte. |
| Redondeo | BOB: dos decimales. ARS: múltiplo de 100 más cercano. |
| Panel único | Una sola plataforma interna (POS, inventario, catálogo y sitio, recibos, usuarios), un inicio de sesión, menú por rol, separada de la consola de NovuChat. NovuChat solo lee por API. |
| Repositorio | Público; nada de PDF, IDs de proyecto ni datos del cliente en el historial. |
| Nube | Región `us-east1` para todo. Staging: proyecto propio con facturación y alerta de 5 USD; producción: proyecto del cliente. Los IDs van en variables de GitHub, no en el repo. |
| Disponibilidad pública | Un producto está disponible si está activo y tiene existencia en `tienda` > 0. |
| Garantía | Se calcula por calendario en `America/La_Paz`. |
