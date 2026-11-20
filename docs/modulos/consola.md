# Consola (catálogo y sitio): notas de comportamiento

## Borrar una foto que está en un carrusel guardado (humo2, 20/11/2026)

- `borrarMedio` ya no rechaza una foto por estar en un carrusel guardado: en la misma transacción reescribe cada `carruseles/{plantilla}` sin ese ítem (un carrusel puede quedar con 0 ítems) y audita un `carrusel.guardar` por carrusel cambiado, con `motivo: 'medio.borrar'`, y la cantidad de ítems antes y después.
- Una foto usada en una **sección** sigue dando `conflicto`: hay que quitarla de ahí y guardar antes de borrarla.
- El original privado y la cuota se liberan en el acto. Las rutas públicas (`tenants/{t}/publico/…`) quedan en `rutasDiferidas` de la subida (estado `borrando`) con `borrarTrasPublicacionDe` = hora del borrado. `limpiarSubidas` las borra solo cuando `publicado/estado.publicadoEn` es posterior; si no, reprograma `venceEn` con `esperaBorradoLogoMs`. Sin una nueva publicación la copia pública sigue en Storage (no cuenta en la cuota).
- Una foto que no estaba en ningún carrusel se borra entera en el acto, como antes.

## Vistas previas de las plantillas

Las clases `.vp-<plantilla>-<tema>` viven en `paquetes/panel/src/pantallas/consola/apariencia.css`, con los colores copiados de `paquetes/website/src/plantillas/plantillas.ts`. Si cambia una paleta, se actualiza ahí a mano.
