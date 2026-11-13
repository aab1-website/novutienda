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
