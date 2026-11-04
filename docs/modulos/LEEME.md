# Especificaciones de módulos (ola 2)

Alcance: solo la propuesta comercial firmada y su Anexo A. Lo que no está ahí no se construye en esta entrega.

Reglas comunes a todos los módulos:
- Datos bajo `tenants/{tenantId}/...`. El navegador no escribe ventas, stock, movimientos, cotizaciones ni auditoría: solo el servidor (callables o Functions). Las reglas de Firestore se generan desde el manifiesto del módulo.
- Un solo dueño por dato. Un módulo no importa el interior de otro: se comunica por eventos v1 (`paquetes/nucleo/src/eventos`) o por la API pública de `@plataforma/nucleo`.
- Cada operación lleva un `operacionId` determinista; reintentar no duplica nada (transacción única, `create()` para los movimientos).
- Montos en enteros de centavos. Monedas: BOB, USD, ARS. Cada venta guarda la cotización usada (`CopiaCotizacion`).
- Roles: `caj` (vendedor), `sup` (supervisor), `adm` (administrador). Máximo 3 usuarios, 1 caja activa por turno, 200 productos, 3 almacenes (`tienda`, `deposito-1`, `deposito-2`). Todos inician sesión con correo verificado y contraseña.
- El módulo entrega: `src/manifiesto.ts` (ManifiestoModulo), lógica pura con interfaces mínimas inyectables (como `limites/` e `identidad/` del núcleo), pruebas negativas y de idempotencia, y NO registra su manifiesto: lo registra el coordinador en `plataforma/registro.ts`.
- Decisiones de Andres vigentes: 3 roles; descuento del vendedor hasta 5 % sin permiso, más con aprobación de supervisor y motivo; pedidos de WhatsApp descuentan siempre de `tienda`. Supuestos a confirmar: la anulación la solicita el vendedor y la aprueba sup/adm; los créditos los aprueba sup/adm.
