# Reconstrucción del sitio: contrato entre las funciones y el CI

Estado: la plataforma **encola y expone**, y la reconstrucción real (compilar Astro con el contenido publicado y desplegar a Hosting) corre en GitHub Actions con `.github/workflows/reconstruir-sitio.yml`, solo en staging (DC3). Hay **un sitio de Hosting por tenant** en el mismo proyecto.

## Cómo se encola

- `consola.publicarSitio` copia el contenido a `tenants/{t}/publicado/*` y, según `decidirReconstruccion`, agenda (`programar`) la reconstrucción con el `DisparadorSitio`
  real, que escribe documentos en `tenants/{t}/reconstrucciones/{id}`. Publicar nunca reconstruye por sí mismo: si la hora agendada ya venció, la toma el temporizador.
- **Precio vivo.** El consumidor de la consola del evento `producto.cambiado` (lo publica Inventarios en la misma transacción del cambio) también agenda: si el producto tiene copia publicada y su precio cambió, actualiza solo el precio de la copia; si quedó inactivo o se borró, retira la copia. En ambos casos sube la versión publicada en 1 (sin cambiar `publicadoEn`), guarda `precioVivoEn` y agenda con la misma ventana. Nombre, marca y categoría siguen esperando «Publicar» (cuentan como cambio sin publicar). Un producto retirado que se reactiva no vuelve solo al sitio: hay que publicar. Si el retiro deja el sitio sin productos o sin fotos, el sitio se reconstruye igual (catálogo vacío o portada sin carrusel) y `sitio/estado.avisoSitio` lo registra para el tablero.
- Documentos que escribe el disparador:
  - `prog-{para}`: `{ estado: 'programada', para }` (una reconstrucción agrupada 10 minutos después del primer cambio; id idempotente por tenant y hora).
  - `rec-{motivo}-v{version}-{aaaammddhhmm}`: `{ estado: 'pendiente', version, motivo: 'publicacion' | 'diaria', solicitadaEnMs }`.
- `temporizadorSitio` (cada 5 minutos) llama `ejecutarReconstruccion(temporizador)`: cuando llega la hora agendada, pasa a `reconstruir` y escribe el trabajo `pendiente`. Es el único camino que reconstruye tras una publicación o un cambio de precio. Si el disparo falla, la hora vencida se conserva y el siguiente tic lo reintenta.
- A las 07:00 de La Paz, tras actualizar la cotización, se encola la reconstrucción `diaria` (si hay algo publicado).

Estados de un trabajo: `pendiente → en_curso → completada | fallida`. No retroceden.

## Endpoints firmados (los llama o los lee GitHub Actions)

Base: la URL del sitio (`/api/sitio/v1/…`, reescrita por Hosting a la función `api`). Todo va firmado:

- Cabeceras: `X-Marca-Tiempo` = milisegundos Unix (13 dígitos) y `X-Firma` = HMAC-SHA256 hexadecimal de
  `"{X-Marca-Tiempo}.{MÉTODO}\n{ruta con consulta}\n{cuerpo exacto}"` con el secreto `SITIO_RECONSTRUCCION_SECRETO`
  (el mismo valor se guarda como secreto del Environment `staging` en GitHub; nunca en el código). Ventana de 5 minutos.
- **Parámetros ordenados.** Firebase Hosting entrega la consulta a la función ordenada alfabéticamente por clave. Toda ruta firmada debe enviar sus parámetros ya ordenados por clave, o la firma calculada por el cliente no coincide con la que verifica la función (#68).
- Ejemplo de texto firmado para un GET: `1793810706128.GET\n/api/sitio/v1/reconstrucciones?tenantId=t1\n` (cuerpo vacío).

| Petición | Respuesta |
|---|---|
| `GET /api/sitio/v1/reconstrucciones?tenantId=T[&estado=pendiente]` | `200 { trabajos: [{ id, estado, version, motivo, solicitadaEnMs }] }` (hasta 20, el más antiguo primero) |
| `POST /api/sitio/v1/reconstrucciones/{id}/estado` con `{ "tenantId": "T", "estado": "en_curso" \| "completada" \| "fallida" }` | `200 { id, estado }`; repetir el mismo estado → `200 { repetido: true }`; transición no permitida → `409`; trabajo inexistente → `404` |
| `GET /api/sitio/v1/publicado?tenantId=T` | `200 { documentos: { "producto__<id>": {…}, "sitio": {…}, "estado": {…}, … }, redondeo: { BOB: Regla, ARS: Regla } }`: la copia publicada que lee la compilación y la política de redondeo de `tenants/T/config/redondeo` (sin documento rige BOB 2 decimales y ARS múltiplo de 100; un documento inválido responde `500`: no se adivina) |

Errores: `401 firma_invalida`, `400 tenant_invalido | estado_invalido | entrada_invalida`, `503 no_configurado` (falta el secreto).

## Flujo real del CI (`reconstruir-sitio.yml`)

Solo staging. El CI principal (`ci-node-firebase.yml`) ya no despliega el sitio público en staging (su guardia lo impide); este workflow es el único que despliega los sitios de tenant.

**Disparadores.** `schedule` cada 15 minutos (DC2): reconstruye solo los sitios con un trabajo `pendiente`. `workflow_dispatch` (entrada `clave`, vacía = todos): reconstruye aunque no haya trabajo en la cola; con el prefijo `certificar:` solo certifica, sin desplegar (sección «Certificación»). `workflow_run`: el CI terminó en éxito un push a `main` y el código nuevo del sitio llega a staging con el contenido real. El checkout usa siempre el HEAD de `main`, nunca el `head_sha` del evento `workflow_run`. `schedule` y `workflow_dispatch` exigen `main`. GitHub atrasa los `schedule` en horas de carga y los apaga tras 60 días sin actividad en el repositorio: si el sondeo deja de correr, se revisa eso primero.

**Job `sondear`** (sin `pnpm install`): lee `SITIOS_TENANT`, arma la matriz con `scripts/sitios-tenant.mjs matriz` y, en `schedule`, consulta la cola firmada de cada sitio (`scripts/contenido-sitio.mjs pendiente`) y deja solo los que tienen trabajo. Un sitio que no responde no detiene a los demás: se reconstruyen igual y el run queda en rojo. Con `SITIOS_TENANT` sin configurar, el sondeo programado termina sin hacer nada.

**Matriz con solo la `clave`.** El tenant, el id del sitio y la URL son identificadores del cliente y los logs de Actions son públicos. `sondear` los enmascara, y el runner **descarta toda salida de job que contenga un valor enmascarado**; por eso la salida `matriz` lleva únicamente `{"include":[{"clave":…}]}`. Cada job de `reconstruir` resuelve tenant, sitio y URL desde el secreto `SITIOS_TENANT` por su clave, los enmascara antes de escribirlos en `GITHUB_ENV` y falla cerrado si la clave no existe o está repetida. Ningún identificador va en un `env:` de YAML. Consecuencias que `sondear` verifica y rechaza sin imprimir el valor: el tenant, el sitio y la URL deben tener **al menos 4 caracteres** (uno más corto enmascararía texto común y vaciaría las salidas), y la clave no puede contener ninguno de ellos.

**Job `reconstruir`** (uno por sitio; `max-parallel: 4`, `fail-fast: false`, grupo de concurrencia por sitio y sin cancelar):

1. Resolver y enmascarar el sitio de la clave.
2. Tomar el trabajo: `POST …/estado` `en_curso`. Un `409` significa que otro corredor lo tomó y este termina sin desplegar. Sin trabajo en la cola, un dispatch o un `workflow_run` reconstruye igual.
3. `pnpm install`, `contenido-sitio.mjs generar` (descarga `publicado`, disponibilidad pública, mapeo con `contenidoDesdePublicado`, `config.redondeo` copiado y `esEjemplo: false`) y `scripts/build.mjs --mode staging --solo sitio --sitio <sitio>`.
4. Prueba del sitio compilado con contenido real (`pruebas/website/dist-real.test.ts`, con `EXIGIR_DIST=1`: si falta `dist/website` falla, no se omite).
5. `preparar-sitio-tenant.sh`: exige que `dist/firebase.json` declare solo `hosting`, con una entrada, sin `target` y con el `site` esperado; rechaza el sitio del panel (`FIREBASE_SITE_PANEL`, variable del Environment, obligatoria).
6. Autenticación por WIF, copia del sitio vivo al canal `previa`, `firebase deploy --only hosting` (se revisa el registro además del código de salida) y humo de `/`, `/productos` (comprueba `cleanUrls`) y `/api/cotizacion?mercado=BO`. La entrada del sitio en `firebase.json` lleva `cleanUrls` (#72).
7. Certificación del sitio desplegado contra el contenido del build (`scripts/certificar-sitio.mjs --contenido`, sin secretos de la cola ni del negocio; ver «Certificación»). Si falla, el trabajo no se cierra `completada`.
8. Cierre: `completada`, o `fallida` si algo falló (incluida la certificación) o el run se canceló (un trabajo no queda `en_curso` para siempre). `estado` reintenta ante `502`, `503`, `504` y errores de red (4 intentos, con esperas de 2, 5 y 10 s); si aun así falla el cierre `completada`, no se marca `fallida` (el sitio ya está desplegado y probado) y el run queda en rojo.
9. Rezagados: tras un despliegue, humo y certificación correctos, haya o no trabajo propio, `contenido-sitio.mjs rezagados` marca `completada` los trabajos que quedaron `en_curso` en corridas anteriores (el grupo de concurrencia por sitio garantiza que no hay otro corredor y el sitio ya contiene lo publicado). Solo imprime el conteo; un `409` o `404` no es error, cualquier otro fallo pone el run en rojo.

**Secretos del Environment `staging`** (valores por stdin, nunca en el repositorio): `SITIOS_TENANT`, `SITIO_NEGOCIO_<CLAVE>` (una por sitio, con la clave en mayúsculas) y `SITIO_RECONSTRUCCION_SECRETO`. Además `GCP_WIF_PROVIDER` y `GCP_SA_DEPLOY_STAGING`.

- `SITIOS_TENANT`: JSON `[{ "clave", "tenant", "sitio", "url" }]`. `clave` `^[a-z0-9]{1,12}$` y única (es lo único que se imprime); `tenant` id del núcleo; `sitio` `^[a-z0-9-]{6,30}$` y único; `url` https sin ruta. Ejemplo: `[{"clave":"t1","tenant":"<tenant>","sitio":"<sitio>","url":"https://<sitio>.web.app"}]`.
- `SITIO_NEGOCIO_<CLAVE>`: JSON con los textos del negocio de ese sitio. Sin él, el paso `generar` falla.
- Medios: `MEDIOS_BASE_URL` puede llevar ruta (bucket, p. ej. `https://<host>/<bucket>`). El sitio separa `origenMedios` (solo el origen; sirve para la CSP y la validación) de `baseMedios` (la URL completa de las fotos) (#69, #70). El host de medios se declara en `hostsPermitidos` del build (#71).
- Icono del sitio: es el logo del negocio; sin logo no hay icono (#71). El logo de `t1` aún no está cargado.
- `SITIO_RECONSTRUCCION_SECRETO`: el mismo valor que lee la función `api`; compartido entre tenants hasta el PR D (derivación por tenant).

**Rollback por sitio.** Antes de cada despliegue, el job clona `<sitio>:live` al canal `previa` (30 días). Deshacer es clonar `<sitio>:previa` a `<sitio>:live` con `firebase hosting:clone`, solo de ese sitio. En el primer despliegue de un sitio no hay copia y se avisa con una advertencia.

**Límite de Hosting.** Firebase admite 36 sitios por proyecto, contando el del panel y el sitio por defecto: unos 33 tenants. Se verifica contra la documentación oficial antes de acercarse al tope.

**Crear el sitio de un tenant** (`firebase hosting:sites:create`), mapear sus hosts (`dominios-de-tenant.md`) y agregar su fila a `SITIOS_TENANT` y su `SITIO_NEGOCIO_<CLAVE>` son pasos del alta, aparte de este workflow. Si el sitio no existe, el despliegue falla con ese motivo.

**Estado en staging (10/11/2026).** Los secretos y la variable del Environment `staging` ya están cargados y la primera reconstrucción real se hizo (PR #66, #68 a #72).

**Pendientes.** (a) Decisión de Andres: el despliegue usa `GCP_SA_DEPLOY_STAGING`, que tiene permisos de todo el pase. Se propone una cuenta de servicio propia de la reconstrucción con solo `roles/firebasehosting.admin`, para que un fallo del flujo no alcance Functions ni reglas. (b) Cargar el logo de `t1`. (c) Borrar la variable de repositorio `TENANT_ID` tras el pase de producción.

## Certificación

**Qué compara.** `scripts/certificar-sitio.mjs` contrasta lo que sirve el sitio con un contenido de referencia: `/version-contenido.json` (versión, fecha de publicación, conteos de productos y secciones y `huellaSinDisponibilidad`), el índice de productos, cada ficha (nombre, código, precios y JSON-LD), la portada, las secciones, la disponibilidad y la cotización. Una huella distinta solo por disponibilidad es un aviso, no un error.

**Referencia según el modo.** Tras un despliegue, el paso «Certificar el sitio desplegado contra el contenido del build» pasa con `--contenido` el mismo archivo con el que se compiló el sitio: una publicación hecha entre el build y la certificación no da una falsa alarma. Ese paso no recibe `SITIO_RECONSTRUCCION_SECRETO` ni `SITIO_NEGOCIO_<CLAVE>` y no exige `VITE_*` ni `MEDIOS_BASE_URL`. A pedido, el paso «Certificar a pedido (sin desplegar)» regenera el contenido publicado con el mismo código y entorno que `contenido-sitio.mjs generar` y por eso es el único que recibe esos secretos y comprueba los faltantes. En este modo, si hay una publicación aún sin reconstruir, la certificación falla en `huella`: es el resultado correcto, porque el sitio no está al día con lo publicado.

**Alcance real.** Lo que no se compara campo a campo:

- Las secciones solo se comprueban por respuesta `200`, no por su contenido.
- La portada se comprueba por plantilla y configuración, no por cada bloque.
- El índice de productos no compara marca ni categoría.
- Las páginas de categoría no se visitan.

Todo lo demás del contenido lo cubre `huellaSinDisponibilidad`, que declara el propio sitio compilado en `/version-contenido.json`: una diferencia de contenido fuera de lo comparado campo a campo aparece como huella distinta.

**Códigos de salida.** Todo código distinto de 0 pone el run en rojo; sin `continue-on-error`.

- `0`: coincide (puede haber avisos). Tras un despliegue, el trabajo se cierra `completada`.
- `1`: diferencias firmes. El paso se repite **una vez** tras 20 s, porque la purga del CDN de Hosting tras un release puede tardar unos segundos en llegar a todos los bordes y el script no reintenta ante una versión vieja; una diferencia real persiste y sigue fallando («el sitio NO coincide con lo publicado»).
- `2`: uso inválido del script. No se reintenta.
- `3`: error de operación: no se pudo comparar (sitio caído, falta un secreto, fallo al regenerar). No se reintenta y el mensaje dice «no se pudo certificar (error de operación)», no que el sitio no coincide.

Tras un despliegue, cualquier fallo de la certificación cierra el trabajo `fallida`. A pedido no hay trabajo y no se toca la cola.

**Cómo se lee.** El log solo muestra conteos y nombres de comprobación: nunca identificadores, nombres ni URL (un producto se nombra por su posición, «producto #k»). La tabla por comprobación está en el resumen del job, bajo «Certificación del sitio `<clave>` (intento n/2)». Si el paso terminó antes de comparar, el resumen lo dice con el código de salida.

**A pedido, sin desplegar.** Se lanza con `workflow_dispatch` desde `main`, con la entrada `clave` igual a `certificar:<clave>` (un sitio) o `certificar:` (todos). El job resuelve el sitio, hace checkout, prepara Node, instala dependencias y certifica. No toma trabajos de la cola, no compila, no despliega, no cierra trabajos y no toca los rezagados. El job `reconstruir` declara `environment: staging` para leer sus secretos, así que este modo también deja un registro de despliegue en GitHub aunque no despliegue nada; es cosmético y no se cambia (`deployment: false`, que usa `sondear`, no se aplica aquí porque no está verificado que admita una expresión condicional solo para este modo sin afectar al despliegue real). Se reutiliza la entrada `clave` con un prefijo reservado (el `:` no es válido en una clave) en vez de declarar otra entrada. Motivo: Checkov CKV_GHA_7 marca toda entrada de `workflow_dispatch`, y este workflow ya la tiene por `clave`.

Pendiente de decisión del propietario: la omisión de Checkov `CKV_GHA_7` se aplica a todo el componente, aunque la excepción de `.devsecops.yml` se justificó solo para `release.yml`.

## El build de producción no admite el contenido de ejemplo

`cargarContenido` (`paquetes/website/src/contenido/cargar.ts`) lanza un error si `APP_ENV=production` y `config.esEjemplo` es `true`: sin `SITIO_CONTENIDO`,
o con un archivo marcado como ejemplo, `pnpm build -- --mode production` falla. En el CI, `construir` compila `production` solo en tags y en
`workflow_dispatch`, con `SITIO_CONTENIDO` tomado de la variable de repositorio del mismo nombre (ruta al JSON ya generado por la reconstrucción, que
debe existir en el checkout o haberse descargado en un paso previo). Mientras producción no tenga su propio flujo de reconstrucción (DC3: queda fuera del PR C) y no produzca ese archivo, un tag `v*` falla
en `construir` por diseño: es mejor que publicar el sitio de ejemplo.
