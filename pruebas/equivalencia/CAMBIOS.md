# Registro de cambios de las referencias de equivalencia

Cada vez que cambian las referencias de `referencias/` (porque cambió el comportamiento del tenant de referencia) se agrega una
entrada que explica **qué cambió y por qué es intencional**. `registro.test.ts` falla si el sello de las referencias no
tiene su entrada, o si el motivo sigue en «PENDIENTE». Entradas en orden cronológico; la última es la vigente.
Formato de cada entrada: un título `## …`, una línea `Sello: <sha256>` y una línea `Motivo: <texto>`.
Cómo regenerar: `pnpm equivalencia:actualizar` (nunca en CI); ver `README.md`.

## Línea base

Sello: 4e289d42ea6d0d6dc13c7dddb3a47d20715da799790f16c2b2752a3b4bb2e2c3
Motivo: Línea base. Fotografía del comportamiento del tenant de referencia en el estado en que se creó la batería, antes de tocar el modelo de mercados y monedas.

## Ampliación de cobertura del catálogo de NovuChat 3103c927af56

Sello: 3103c927af563c92d30758bc7bc73e534dfc01db6fcbdc6efd711d076af152d2
Motivo: Se amplía la cobertura, no cambió el comportamiento. Se agregan tres referencias nuevas del catálogo del asistente con config/redondeo en «ninguno», en «decimales: 3» y con un precio menor a un centavo. Se generaron con el código de main previo a la migración de mercados por tenant (oráculo) y las demás referencias quedan idénticas.

## Una sola regla de redondeo (D7) f153070a8101

Sello: f153070a810191653c8972bb10c683ba542715f0e9699281322ec5255f27094a
Motivo: Cambio de comportamiento deliberado, decisión D7 del dueño (13/11/2026): el redondeo admite solo 0, 1 o 2 decimales o un múltiplo de al menos 0,01; desaparecen el modo «ninguno» y los decimales mayores a 2. Cambian solo tres referencias, las del catálogo de NovuChat con reglas ahora prohibidas (redondeo-ninguno, redondeo-decimales3 y redondeo-subcentavo): ya no recogen precios sino el fallo cerrado del conector (RedondeoInvalido, que el manejador api convierte en 500 «interno», sin precios). El tenant de referencia cumple la regla nueva, comprobado en staging en solo lectura, así que sus demás referencias quedan idénticas.

## Regeneración 479878bdf7d0

Sello: 479878bdf7d0c128abf2b7c5fedc27b5ff1c3eb423b91eec6f6724eb41f6bc93
Motivo: Cambio de comportamiento deliberado, decisión del dueño del producto del 16/11/2026 («Actualizar esas 3 referencias»): la clave interna del producto es automática y oculta, la planilla exportada sale sin la columna id y la importación reconoce cada producto por su SKU; la fila simulada lleva nombre y sku. Cambian solo tres referencias de inventario: inventarios-exportacion.csv (sin la columna id), inventarios-simulacion-roundtrip.json e inventarios-simulacion-cambios.json (cada fila con nombre y sku; en la segunda, la planilla de entrada ya no lleva id, las altas reciben clave generada y la fila sin SKU falla por «es obligatorio cuando la fila no trae id»). NO cambian precios, caja, recibos, catálogo del asistente, sitio ni tenant, ni los importes, el stock, el orden o los resúmenes de la simulación; una planilla vieja con id se sigue aceptando y se comprueba aparte en inventarios-csv.test.ts.

## Regeneración b48b7a52b4fa

Sello: b48b7a52b4fa3bb82fec8dfd214e6e499d88145533e89ce7d115118ffe7306a0
Motivo: Misma decisión del dueño del producto del 16/11/2026 (clave interna oculta, exportación sin id, reconocimiento por SKU), tras la revisión del módulo. Cambia una sola referencia, inventarios-simulacion-cambios.json, y solo el texto del error de la fila sin SKU: pasa de «es obligatorio cuando la fila no trae id» a «Falta el SKU: cada producto se reconoce por su SKU». No cambia ninguna otra referencia, ni importes, acciones, resúmenes ni advertencias, y no se agregó ninguna advertencia nueva a las filas de la batería.

## Regeneración 98661c34c65a

Sello: 98661c34c65a42d407563c2d48c7f492ff750eab5d03ffba5d66d05df9c272b2
Motivo: Cambio de comportamiento deliberado, bloque S7-1 «precio vivo» (decisiones del dueño D-5 y DS-4: al desactivar un producto, sale del sitio en minutos). El escenario entrega a la consola el evento `producto.cambiado` de la desactivación de `p-inactivo`, como hace producción, y la consola retira la copia publicada de ese producto. Cambian solo dos referencias: sitio-contenido.json y sitio-seo.json dejan de incluir «Producto retirado». No cambia nada de precios, cotizaciones, inventario, caja, recibos ni del catálogo del asistente. Regenerado sobre las referencias vigentes de main (sello b48b7a52b4fa), sin pisarlas.

## Series de prueba con formato válido (SN-A, SN-B, SN-C) a9c43b72e55c

Sello: a9c43b72e55cdba6858fb466dd77e185cbe6487d0e14f22aa7a24a4f7d13cea0
Motivo: 20/11/2026. Regla nueva de formato de series (3 a 60 caracteres, solo al ingresar; decisión D2 de Andres del 20/11/2026): las series de prueba «A», «B» y «C» del celular del escenario pasan a «SN-A», «SN-B» y «SN-C» (la serie «A» de los recibos no cambia). Regeneración autorizada por Andres el 20/11/2026 (botón «Sí, regenerar»). Cambia solo el texto de esas series en caja-eventos-venta.json, caja-existencias-tras-ventas.json, caja-ventas.json, recibos-documentos.json y recibo-A-000001-BOB.html; ningún monto, id, orden, cantidad ni evento.

## Regeneración cf3740a15f23

Sello: cf3740a15f2323a74ae98417e60fb464ddb45c0127391f6a06308f403bbaa484
Motivo: Cambio de comportamiento deliberado, autorizado por el dueño del producto el 24/11/2026 («Sí, PR y fusionar»), a pedido de NovuChat para su catálogo de WhatsApp. Cada ítem del catálogo agrega `areaClave` (clave estable de la categoría) y `ordenArea` (orden fijado por el administrador, o null). `area` pasa a ser el nombre visible de la categoría según publicado/negocio; si la categoría no tiene nombre propio, sigue siendo la clave, y por eso queda igual en el tenant de referencia. `descripcion` se entrega en una línea y con un máximo de 300 caracteres; las del tenant de referencia ya cumplían y no cambian. Cambian solo las tres referencias del catálogo de NovuChat: dos campos nuevos por ítem y el ETag, que se calcula sobre el cuerpo. No cambian precios, stock, el orden de los ítems ni el resto de las referencias.
