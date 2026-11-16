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
