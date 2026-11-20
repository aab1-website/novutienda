# Consola (catálogo y sitio): notas de comportamiento

## Borrar una foto que está en un carrusel guardado (humo2, 20/11/2026)

- `borrarMedio` ya no rechaza una foto por estar en un carrusel guardado: en la misma transacción reescribe cada `carruseles/{plantilla}` sin ese ítem (un carrusel puede quedar con 0 ítems) y audita un `carrusel.guardar` por carrusel cambiado, con `motivo: 'medio.borrar'`, y la cantidad de ítems antes y después.
- Una foto usada en una **sección** sigue dando `conflicto`: hay que quitarla de ahí y guardar antes de borrarla.
- Solo `adm` borra una foto que está en un carrusel guardado; `sup` recibe `conflicto` («Esta foto está en el carrusel de la portada; pídale al administrador que la quite»).
- El original privado y la cuota se liberan en el acto. Con el sitio ya publicado (existe `publicado/estado.version`), las rutas públicas de **toda** foto o video borrado (`tenants/{t}/publico/…`) quedan en `rutasDiferidas` de la subida (estado `borrando`) con `borrarTrasVersion` = esa versión y `borrarTopeEn` = ahora + 30 días. Sin nada publicado se borra todo en el acto.
- `limpiarSubidas` borra la copia pública cuando `sitio/ultimaReconstruccion` es `completada` con una `version` mayor que `borrarTrasVersion` **y** ninguna copia `publicado/*` (productos, carruseles, secciones, sitio, negocio) nombra ya las rutas del medio (el precio vivo y el logo vivo suben la versión sin volver a publicar las fotos). Si no, reprograma (`venceEn` + `esperaBorradoLogoMs`). Pasado `borrarTopeEn` se borra igual.
- Límite conocido: la cuota se libera en el acto, aunque la copia pública puede durar hasta 30 días en Storage.

## Vistas previas de las plantillas

Las clases `.vp-<plantilla>-<tema>` viven en `paquetes/panel/src/pantallas/consola/apariencia.css`, con los colores copiados de `paquetes/website/src/plantillas/plantillas.ts`. Si cambia una paleta, se actualiza ahí a mano.
