# Registro de cambios de las referencias de equivalencia

Cada vez que cambian las referencias de `referencias/` (porque cambió el comportamiento del tenant de referencia) se agrega una
entrada que explica **qué cambió y por qué es intencional**. `registro.test.ts` falla si el sello de las referencias no
tiene su entrada, o si el motivo sigue en «PENDIENTE». Entradas en orden cronológico; la última es la vigente.
Formato de cada entrada: un título `## …`, una línea `Sello: <sha256>` y una línea `Motivo: <texto>`.
Cómo regenerar: `pnpm equivalencia:actualizar` (nunca en CI); ver `README.md`.

## Línea base

Sello: 4e289d42ea6d0d6dc13c7dddb3a47d20715da799790f16c2b2752a3b4bb2e2c3
Motivo: Línea base. Fotografía del comportamiento del tenant de referencia en el estado en que se creó la batería, antes de tocar el modelo de mercados y monedas.
