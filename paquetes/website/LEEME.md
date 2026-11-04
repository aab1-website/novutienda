# @plataforma/website — sitio público

Sitio estático (Astro + Preact) con sus APIs dinámicas como funciones puras. Especificación: `docs/modulos/website.md`.

## Comandos (desde `paquetes/website/`)

| Acción | Comando |
|---|---|
| Compilar | `pnpm build` (salida en `dist/website/`, con `_cabeceras.json` sellado) |
| Humo + accesibilidad | `pnpm humo` (necesita Chrome; `PLAYWRIGHT_CHANNEL` cambia el navegador) |
| Contenido real | `SITIO_CONTENIDO=ruta/publicado.json pnpm build` (sin la variable usa el ejemplo) |

## Qué entrega

- `src/contenido/`: modelo tipado, validación en el borde y **fuente de ejemplo** (`ejemplo.ts`, todo ficticio).
- `src/plantillas/`: 5 plantillas (`cielo`, `bosque`, `ambar`, `grafito`, `ciruela`) con tokens claro/oscuro y prueba de contraste AA.
- `src/api/`: `manejarDisponibilidad`, `manejarContacto`, `manejarCotizacionSitio` (núcleo) y `despacharApi`.
  Puertos a cablear: `LectorDisponibilidad`, `VerificadorRecaptcha`, `VerificadorAppCheck`, `LimiteTasa`, `GuardarContacto`,
  y el `AlmacenCotizaciones` del núcleo para `lectorCotizacion`.
- `src/medicion/`: Google (Consent Mode v2), Meta y TikTok solo con consentimiento por categoría.
- `src/seguridad/`: CSP estricta y sellado por hash del `dist/` (`_cabeceras.json`, formato de `firebase.json`).

## Reglas

- Nada de tasas ni precios en el código: el precio sale de `precioFinal` (núcleo) con `/api/cotizacion`.
- Las afirmaciones sin confirmar (`confirmada: false`) no se publican; el build las lista como `CONFIRMAR`.
- Sin estilos ni scripts en línea (salvo los arranques de islas de Astro, autorizados por hash).
