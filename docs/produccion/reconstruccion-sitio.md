# Reconstrucción del sitio: contrato entre las funciones y el CI

Estado: la plataforma **encola y expone**; la reconstrucción real (compilar Astro con el contenido publicado y desplegar a Hosting) es de otra ola y corre en GitHub Actions.

## Cómo se encola

- `consola.publicarSitio` copia el contenido a `tenants/{t}/publicado/*` y, según `decidirReconstruccion`, agenda (`programar`) o reconstruye (`reconstruir`) usando el `DisparadorSitio`
  real, que escribe documentos en `tenants/{t}/reconstrucciones/{id}`:
  - `prog-{para}`: `{ estado: 'programada', para }` (una reconstrucción agrupada 10 minutos después del primer cambio; id idempotente por tenant y hora).
  - `rec-{motivo}-v{version}-{aaaammddhhmm}`: `{ estado: 'pendiente', version, motivo: 'publicacion' | 'diaria', solicitadaEnMs }`.
- `temporizadorSitio` (cada 5 minutos) llama `ejecutarReconstruccion(temporizador)`: cuando llega la hora agendada, pasa a `reconstruir` y escribe el trabajo `pendiente`.
- A las 07:00 de La Paz, tras actualizar la cotización, se encola la reconstrucción `diaria` (si hay algo publicado).

Estados de un trabajo: `pendiente → en_curso → completada | fallida`. No retroceden.

## Endpoints firmados (los llama o los lee GitHub Actions)

Base: la URL del sitio (`/api/sitio/v1/…`, reescrita por Hosting a la función `api`). Todo va firmado:

- Cabeceras: `X-Marca-Tiempo` = milisegundos Unix (13 dígitos) y `X-Firma` = HMAC-SHA256 hexadecimal de
  `"{X-Marca-Tiempo}.{MÉTODO}\n{ruta con consulta}\n{cuerpo exacto}"` con el secreto `SITIO_RECONSTRUCCION_SECRETO`
  (el mismo valor se guarda como secreto del repositorio en GitHub; nunca en el código). Ventana de 5 minutos.
- Ejemplo de texto firmado para un GET: `1793810706128.GET\n/api/sitio/v1/reconstrucciones?tenantId=casa-bermejo\n` (cuerpo vacío).

| Petición | Respuesta |
|---|---|
| `GET /api/sitio/v1/reconstrucciones?tenantId=T[&estado=pendiente]` | `200 { trabajos: [{ id, estado, version, motivo, solicitadaEnMs }] }` (hasta 20, el más antiguo primero) |
| `POST /api/sitio/v1/reconstrucciones/{id}/estado` con `{ "tenantId": "T", "estado": "en_curso" \| "completada" \| "fallida" }` | `200 { id, estado }`; repetir el mismo estado → `200 { repetido: true }`; transición no permitida → `409`; trabajo inexistente → `404` |
| `GET /api/sitio/v1/publicado?tenantId=T` | `200 { documentos: { "producto__<id>": {…}, "sitio": {…}, "estado": {…}, … }, redondeo: { BOB: Regla, ARS: Regla } }`: la copia publicada que lee la compilación y la política de redondeo de `tenants/T/config/redondeo` (sin documento rige BOB 2 decimales y ARS múltiplo de 100; un documento inválido responde `500`: no se adivina) |

Errores: `401 firma_invalida`, `400 tenant_invalido | estado_invalido | entrada_invalida`, `503 no_configurado` (falta el secreto).

## Flujo previsto para el CI (otra ola)

1. Un `schedule` corto (o `workflow_dispatch`) firma y llama `GET …/reconstrucciones?tenantId=T`.
2. Si hay un trabajo `pendiente`: `POST …/estado` con `en_curso` (si responde `409`, otro corredor lo tomó).
3. Descarga `GET …/publicado?tenantId=T`, lo transforma al formato que lee el build (`SITIO_CONTENIDO=ruta/publicado.json pnpm build`; el mapeo
   `Publicado` → contenido del sitio también es de esa ola) y despliega el sitio. **Obligaciones del mapeo**: copiar `redondeo` de la respuesta a
   `config.redondeo` del contenido (el sitio redondea con la política del negocio, nunca con la del ejemplo) y poner `config.esEjemplo: false`.
4. Cierra con `POST …/estado` `completada` o `fallida`.

El formato del contenido de `publicado/` es el de `construirPublicado` de `@novutienda/consola`.

## El build de producción no admite el contenido de ejemplo

`cargarContenido` (`paquetes/website/src/contenido/cargar.ts`) lanza un error si `APP_ENV=production` y `config.esEjemplo` es `true`: sin `SITIO_CONTENIDO`,
o con un archivo marcado como ejemplo, `pnpm build -- --mode production` falla. En el CI, `construir` compila `production` solo en tags y en
`workflow_dispatch`, con `SITIO_CONTENIDO` tomado de la variable de repositorio del mismo nombre (ruta al JSON ya generado por la reconstrucción, que
debe existir en el checkout o haberse descargado en un paso previo). Mientras la reconstrucción real (otra ola) no produzca ese archivo, un tag `v*` falla
en `construir` por diseño: es mejor que publicar el sitio de ejemplo.
