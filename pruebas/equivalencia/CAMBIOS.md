# Registro de cambios de las referencias de equivalencia

Cada vez que cambian las referencias de `referencias/` (porque cambió el comportamiento del tenant de referencia) se agrega una
entrada que explica **qué cambió y por qué es intencional**. `registro.test.ts` falla si el sello de las referencias no
tiene su entrada, o si el motivo sigue en «PENDIENTE». Entradas en orden cronológico; la última es la vigente.
Formato de cada entrada: un título `## …`, una línea `Sello: <sha256>` y una línea `Motivo: <texto>`.
Cómo regenerar: `pnpm equivalencia:actualizar` (nunca en CI); ver `README.md`.

## Línea base

Sello: 4e289d42ea6d0d6dc13c7dddb3a47d20715da799790f16c2b2752a3b4bb2e2c3
Motivo: Línea base. Fotografía del comportamiento del tenant de referencia en el estado en que se creó la batería, antes de tocar el modelo de mercados y monedas.

## Regeneración f6ad2eca5e57

Sello: f6ad2eca5e570a8fed54feef7c04f7aa5d87b8cc96c5c2c7465ed214c21ea637
Motivo: S7-1 «precio vivo». El escenario ahora entrega a la consola el evento `producto.cambiado` de la desactivación de `p-inactivo`, como hace producción, y la consola retira la copia `publicado/producto__p-inactivo` y lo quita de `publicado/estado.productos`. Por eso `sitio-contenido.json` y `sitio-seo.json` ya no incluyen «Producto retirado» (catálogo, medios y JSON-LD). Es intencional: decisión del propietario D-5 «precio vivo» y DS-4 «al desactivar, el producto sale del sitio en minutos». Las referencias anteriores conservaban el producto porque la batería nunca entregaba la bandeja y no representaba a producción. No cambian precios, cotizaciones, redondeo, CSV, recibos, caja, catálogo ni inventario de NovuChat.
