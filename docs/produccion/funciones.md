# Funciones del servidor (Cloud Functions v2, us-east1, Node 22)

Paquete `@novutienda/funciones` (`plataforma/funciones/`). Adaptadores reales en `plataforma/adaptadores/firebase/`.
Todo lo que escribe ventas, stock, movimientos, cotizaciones o auditoría pasa por estas funciones; el navegador solo lee,
según las reglas de Firestore. Región `us-east1` en todo. No hay identificadores del proyecto ni secretos en el repositorio.

## 1. Qué se despliega

| Función | Tipo | Para qué |
|---|---|---|
| `pos`, `inventarios`, `consola`, `recibos` | callable | Una por módulo; despacha por `accion` (ver §3). 512 MiB. |
| `medios` | callable | Reserva, finalización y borrado de medios. 2 GiB, 540 s. |
| `api` | HTTP | Rutas `/api/**` y `/healthz` de Hosting (ver §4). |
| `eventos` | Firestore `tenants/{t}/eventos/{id}` | Bus de eventos hacia Recibos e Inventarios (§5). |
| `subidaFinalizada` | Storage | Finaliza una subida al terminar de llegar el original (§6). 2 GiB, 540 s. |
| `cotizacion` | programada | 07:00, 13:00 y 19:00 de La Paz: BO y AR por tenant (§7). |
| `limpiezaSubidas` | programada | Cada hora: libera reservas vencidas y reintenta borrados. |
| `temporizadorSitio` | programada | Cada 5 minutos: encola la reconstrucción del sitio agendada. |

Cloud Scheduler: 3 trabajos (el plan gratuito incluye 3 por cuenta; verificar el límite vigente en la documentación oficial al desplegar).
`maxInstances` 10 por función (3 en las de medios): tope de costo.

## 2. Llamar a un callable (contrato común para el panel)

```ts
const llamar = httpsCallable(functions, 'pos');            // 'pos' | 'inventarios' | 'consola' | 'recibos' | 'medios'
const { data } = await llamar({ accion: 'abrirTurno', tenantId: 'casa-bermejo', datos: { turnoId, apertura: { BOB: 10000 } } });
```

- Sobre estricto: `{ accion: string, tenantId: string, datos?: objeto }`. Claves de más → `invalid-argument`.
- Sesión: ID token vigente, **no revocado** (`checkRevoked`), con **correo verificado**, proveedor `password` (personal) y un rol en
  **ese** tenant en el claim `pl`. El rol nunca viaja en `datos`. El propietario de la plataforma (sesión con Google y claim `p`) solo
  puede `buscarUsuarioPorCorreo`, `asignarRol` y `quitarRol`.
- App Check: se exige cuando `APP_CHECK_EXIGIDO=true` (producción). El SDK del panel debe enviar el token (`getToken` de App Check).
- Errores (`HttpsError`): `unauthenticated` (sin sesión, sesión revocada o correo sin verificar; HTTP 401), `permission-denied` (rol
  insuficiente u otro tenant; 403), `invalid-argument` (datos inválidos; `details.campos` lista rutas, nunca valores),
  `not-found`, `already-exists` (mismo `requestId`/`operacionId` con otro contenido), `failed-precondition` (regla de negocio:
  stock insuficiente con `details.faltantes`, turno ya abierto, aprobación vencida, etc.), `resource-exhausted` (límite del plan,
  cuota; `details.{clave,tope}`), `aborted` (reintentar), `unavailable`, `internal` (mensaje genérico; el detalle va al registro).
- Idempotencia: cada operación de escritura lleva un identificador del cliente (`requestId`, `turnoId`, `operacionId`…). Reintentar
  la misma petición devuelve el resultado original sin repetir efectos. Montos en **centavos enteros**; precios base en **USD decimales**
  en `consola` y en **centavos de USD** en `inventarios` (convención de cada módulo).
- Salida: JSON plano (las marcas de tiempo de Firestore salen como texto ISO 8601).

## 3. Acciones por callable

`TODOS` = `caj`, `sup`, `adm`; `SUP` = `sup`, `adm`; `ADM` = `adm`. Todas validan además lo suyo en el módulo dueño.

### `pos`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `abrirTurno` | TODOS | `{ turnoId (UUID), apertura: { BOB?, USD?, ARS? } }` | turno |
| `cerrarTurno` | TODOS (el dueño del turno) | `{ turnoId, contado: {…} }` | `{ turno, arqueo }` |
| `cerrarTurnoForzado` | ADM | `{ turnoId, contado, motivo }` | `{ turno, arqueo }` |
| `confirmarVenta` | TODOS | `{ requestId (UUID), carrito, pagos[], aprobacionId?, aprobacionCreditoId? }` | `{ venta, repetida }` |
| `solicitarAprobacion` | TODOS | `{ aprobacionId (UUID), solicitud: { tipo: 'descuento'\|'credito', moneda, monto, motivo, deudor? } }` | aprobación |
| `resolverAprobacion` | SUP | `{ aprobacionId, decision: 'aprobar'\|'rechazar' }` | aprobación |
| `solicitarAnulacion` | TODOS (el vendedor, solo sus ventas) | `{ ventaId, motivo }` | venta |
| `aprobarAnulacion` | SUP | `{ ventaId }` | `{ ventaId, reembolsos[], turnoIdReembolso }` |
| `registrarMovimientoCaja` | TODOS | `{ requestId, movimiento: { tipo: 'ingreso'\|'egreso', moneda, monto, motivo, comprobante? } }` | `{ movimiento, repetido }` |
| `cobrarCredito` | TODOS | `{ requestId, ventaId, cobro: { medio, monto, referencia? } }` | `{ cobro, repetido }` |
| `leerConfig` / `guardarConfig` | TODOS / ADM | `{}` / `{ config }` | `{ config }` |
| `miTurno` | TODOS | `{}` | `{ turno \| null, cajaOcupada, proyeccion? }` (el vendedor ve solo el suyo) |
| `misVentas` | TODOS | `{ turnoId?, desde?, hasta?, limite?, soloMias? }` (ms Unix) | `{ ventas[] }` (el vendedor, solo las suyas) |
| `venta` | TODOS (el vendedor, solo las suyas) | `{ ventaId }` | `{ venta }` |
| `aprobaciones` / `aprobacion` | TODOS (el vendedor, solo las que él solicitó) | `{ estado?, limite? }` / `{ aprobacionId }` | `{ aprobaciones[] }` / `{ aprobacion }` |
| `movimientosCaja` | TODOS (el vendedor, solo su turno) | `{ turnoId, limite? }` | `{ movimientos[] }` |
| `creditos`, `turnos`, `supervision` | SUP | `{ estado?, limite? }` / `{ limite? }` / `{}` | listas; `supervision`: `{ turno, proyeccion, ultimasVentas[] }` |
| `exportarVentasCsv` / `exportarMovimientosCajaCsv` | SUP | `{ desde, hasta }` / `{ turnoId }` | `{ csv }` (celdas con `= + - @` neutralizadas) |

Reglas del POS (descuento de 5 % sin permiso, aprobaciones de un solo uso, anulación con reembolso por los medios originales, arqueo sin tope en cero)
las aplica el módulo; el redondeo del precio sale de `tenants/{t}/config/redondeo` (§8).

### `inventarios`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `ingresar` | SUP | `{ operacionId, ubicacionId, lineas: [{ productoId, cantidad, series? }] }` | `{ resultado, repetida }` |
| `traspasar` | SUP | `{ operacionId, origenId, destinoId, lineas[] }` | idem |
| `ajustar` | ADM | `{ operacionId, motivo, lineas: [{ productoId, ubicacionId, delta }] }` | idem |
| `solicitarMerma` | TODOS | `{ operacionId, productoId, ubicacionId, cantidad, series?, motivo }` | idem (`mermaId` = `operacionId`) |
| `resolverMerma` | SUP (distinto de quien la solicitó) | `{ operacionId, mermaId, decision: 'aprobada'\|'rechazada', motivo? }` | idem |
| `abrirConteo` / `cerrarConteo` | SUP | `{ operacionId, conteoId, ubicacionId }` / `{ operacionId, conteoId }` | idem |
| `registrarLineaConteo` | TODOS | `{ operacionId, conteoId, productoId, contado?, series? }` | `{ resultado, repetida }` (sin el teórico: conteo ciego) |
| `crearUbicacion` | ADM | `{ operacionId, ubicacionId, nombre }` | idem |
| `fijarCosto` | ADM | `{ operacionId, productoId, costoUSD }` | idem |
| `importarProductosCsv` | ADM | `{ operacionId, csv, cargaInicial? }` (hasta 50 filas) | idem |
| `listarProductos` | TODOS | `{ soloBajoMinimo? }` | `{ productos[] }` con `existencias` por almacén, `disponible`, `bajoMinimo`; sin costos |
| `ubicaciones`, `buscarSerie`, `conteo`, `conteos` | TODOS | `{}` / `{ serie, productoId? }` / `{ conteoId }` / `{ estado?, limite? }` | listas |
| `movimientos`, `mermas`, `exportarCsv` | SUP | `{ productoId?, desde?, hasta?, limite? }` / `{ estado?, limite? }` / `{ conCostos? }` (costos solo ADM) | listas; `{ csv }` |
| `costos` | ADM | `{}` | `{ costos[] }` |

### `consola`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `crearProducto` | ADM | `{ productoId, datos, precioUSD: { bo, ar } }` | `{ productoId }` (tope de 200 productos → `resource-exhausted`) |
| `editarProducto` | ADM | `{ productoId, cambios }` | idem |
| `cambiarPrecioUSD` | ADM | `{ productoId, precioUSD: { bo, ar } }` | idem |
| `catalogo` | SUP | `{}` | `{ productos[] }` con `disponible` |
| `preciosDelDia` | SUP | `{ precioUSD: { bo, ar } }` | `{ BO, AR }` (`precioFinal` con el redondeo del tenant) |
| `guardarFicha` / `leerFicha` | SUP | `{ productoId, ficha }` / `{ productoId }` | `{ productoId }` / `{ ficha }` |
| `guardarSeccion`, `eliminarSeccion`, `ordenarSecciones`, `guardarCarrusel`, `guardarConfigSitio` | ADM | `{ seccion }` / `{ seccionId }` / `{ orden[] }` / `{ carrusel }` / `{ config }` | `{ ok }` |
| `simularImportacion` / `importarProductos` | ADM | `{ archivo (base64, hasta 2 MB) [, omitirErrores] }` | simulación / resultado (solo CSV; `.xlsx` → `unavailable`) |
| `exportarProductosCsv` | SUP | `{}` | `{ csv }` |
| `publicarSitio` | ADM | `{}` | `{ version, productos, decision, advertencias[] }` |
| `tablero` | SUP | `{}` | tablero (cotizaciones, cambios sin publicar, uso frente a topes) |
| `alertas` | SUP | `{ limite? }` | `{ alertas[] }` (cotización: fuentes caídas o valor viejo) |
| `listarUsuarios` | SUP | `{}` | `{ usuarios: [{ uid, rol, correo, correoVerificado, deshabilitado }] }` |
| `buscarUsuarioPorCorreo` | ADM / propietario | `{ correo }` | `{ uid, correoVerificado, conContrasena }` |
| `asignarRol` / `quitarRol` | ADM / propietario | `{ uid, rol }` / `{ uid }` | `{ claim }` (solo el propietario toca a un `adm`; el último `adm` no se quita) |

El panel **no** puede crear cuentas de Firebase Auth: el personal debe existir (correo y contraseña, correo verificado) antes de `asignarRol`.

### `medios`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `reservarSubida` | SUP | `{ subidaId (8–40: A-Z a-z 0-9 _ -), productoId, tipo: 'foto'\|'video', bytes }` | `{ subidaId, rutaOriginal, venceEn }` |
| `finalizarSubida` | SUP | `{ subidaId }` | `{ medio }` (idempotente; normalmente ya la hizo el disparador) |
| `borrarMedio` | SUP | `{ medioId }` | `{ ok }` |
| `listarMedios` | SUP | `{ productoId, limite? }` | `{ medios[] }` |

Flujo de subida: `reservarSubida` → el navegador sube a `rutaOriginal` con el SDK de Storage (`contentType` de foto: jpeg/png/webp/heic; video:
mp4/quicktime/webm) → el disparador procesa → el panel espera `subidas/{id}.estado` (`procesada` o `rechazada`) o llama `finalizarSubida`.

### `recibos`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `leerPlantilla` / `guardarPlantilla` | TODOS / SUP | `{}` / `{ plantilla }` | `{ plantilla }` / `{ ok }` |
| `buscarComprobantes` | TODOS (el vendedor, solo los de sus ventas) | `{ numero?, desde?, hasta?, cliente?, limite? }` (fechas `aaaa-mm-dd`) | `{ recibos[] }` |
| `leerRecibo`, `htmlRecibo`, `pdfRecibo` | TODOS (el vendedor, solo los suyos) | `{ reciboId }` | `{ recibo }` / `{ html }` / `{ pdfBase64 }` |
| `referenciarFacturaSuma` | SUP | `{ reciboId, facturaSuma }` | `{ ok }` |
| `enviarRecibo` | TODOS (el vendedor, solo los suyos) | `{ reciboId, codigoPais? }` (por defecto `591`) | `{ estado, enlace? }`: `enlace` es el `wa.me` que la persona abre y envía |

## 4. API HTTP (`/api/**`, función `api`)

Hosting reescribe `/api/**` y `/healthz` a la función `api` (región `us-east1`). Todas las respuestas JSON llevan `Cache-Control` y `nosniff`.

| Ruta | Autenticación | Contrato |
|---|---|---|
| `GET /healthz` | ninguna | `200 ok` (texto) |
| `GET /api/cotizacion[?mercado=BO\|AR]` | pública | handler del núcleo; `Cache-Control: public, max-age=60, s-maxage=300` |
| `GET /api/disponibilidad?ids=a,b` | pública | `{ disponibilidad: { id: 'disponible'\|'agotado' } }`, nunca cantidades |
| `POST /api/contacto` | App Check (`X-Firebase-AppCheck`) + reCAPTCHA Enterprise + límite de tasa por origen | `200 { ok, repetido }`; `401 app_check`; `403 recaptcha`; `429` con `Retry-After`; idempotente por `envioId` |
| `GET /api/novuchat/v1/catalogo?mercado=BO\|AR` | `Authorization: Bearer <token>` (SHA-256 en `novuchatTokens/{hash}`) | Contrato de `docs/integracion-novuchat.md` §1; `ETag` y `Cache-Control: private, max-age=60`; `304` con `If-None-Match`; `401 sin_credencial\|credencial_invalida`, `400 mercado_invalido`, `429 limite`, `503 sin_cotizacion` |
| `GET /api/novuchat/v1/inventario` | idem | `{ version, generadoEn, items: [{ id, nombre, sku, activo, conSerie, stockTotal, stockPorAlmacen, minimo, bajoMinimo }] }`, sin costos; `ETag` |
| `POST /api/novuchat/v1/pedidos/confirmar` | HMAC-SHA256 de `"{X-Marca-Tiempo}.{cuerpo exacto}"` en `X-Firma`, ventana de 5 min | `confirmarPedidoFirmado` del módulo: `200` (aplicado o ya aplicado), `400`, `401`, `409` (`faltantes`) |
| `GET/POST /api/sitio/v1/…` | HMAC (ver `reconstruccion-sitio.md`) | Cola de reconstrucción del sitio |

Notas del catálogo: solo productos activos y publicados con copia en `publicado/` y precio en ese mercado (máx. 200). `precio` es el monto
decimal en la moneda del mercado; `precioCentavos` el mismo monto en centavos (el contrato original dice «mismo entero»: ver §10).
`stock` es la existencia del almacén `tienda`. `foto`/`fotos` salen de las versiones WebP publicadas (960 px de preferencia).

## 5. Bus de eventos

Los módulos publican `tenants/{t}/eventos/{id}` dentro de su transacción. `eventos` (Firestore `onDocumentCreated`, `retry: true`) entrega
`venta.confirmada` y `venta.anulada` a Recibos, `venta.anulada` y `pedido.confirmado` a Inventarios. `consumir` (núcleo) es idempotente por id y por
clave de idempotencia; tras 5 intentos fallidos por consumidor y evento queda «descartado» (`procesados/{consumidor}~descartado~{id}`) y
Functions deja de reintentar. Hay que vigilar `procesados/*~fallo~*` y `*~descartado~*`.

## 6. Medios

Reglas de Storage (`storage.rules`): crear en `tenants/{t}/privado/originales/{producto}/{subida}` solo con correo+contraseña verificado, rol `sup`/`adm`
**en ese tenant**, reserva vigente en Firestore (mismo producto y misma persona), ≤ 15 MB foto / ≤ 200 MB video y tipo permitido; no se reemplaza
ni se borra desde el navegador. Lectura pública solo de `tenants/{t}/publico/**`. Todo lo demás, negado.

Procesamiento (sharp): AVIF y WebP a 480, 960, 1600 y 2400 px (sin ampliar), orientación aplicada, **sin EXIF/GPS/XMP/IPTC**, tope de 100 megapíxeles.
Las versiones se publican con el hash del contenido en el nombre y `Cache-Control: public, max-age=31536000, immutable`.

**Video: no está garantizado en Cloud Functions.** El runtime no trae ffmpeg/ffprobe. El procesador de video (ffmpeg: 720p/1080p H.264 sin
metadatos y póster WebP, probado con el binario local) solo se activa si el despliegue define `FFMPEG_PATH` y `FFPROBE_PATH`; sin ellos, un video se
**rechaza** con un error claro y no se publica nada (no hay versión simulada en producción). Para habilitarlo hay que empaquetar un binario
estático dentro del despliegue (decisión pendiente; ver §9) y subir memoria/tiempo de `subidaFinalizada` y `medios`. Tampoco se procesa HEIC (el sharp
precompilado no lo decodifica): el navegador debe convertir a JPEG antes de subir.

## 7. Cotización y alertas

`cotizacion` llama `actualizarMercado` para BO (BCB) y AR (BNA con control del BCRA) por cada tenant, con el `Notificador` real: documento
`tenants/{t}/alertas/{tipo}-{mercado}-{aaaa-mm-dd-hh}` y un registro estructurado de severidad ERROR con `jsonPayload.alerta="cotizacion"`.
Cómo crear la alerta por correo (no se creó): `docs/produccion/alertas.md`. A las 07:00 de La Paz la misma corrida dispara la reconstrucción diaria del sitio.

## 8. Redondeo

`DepsPos.redondeo` y los precios del catálogo salen de `tenants/{t}/config/redondeo` (caché de 60 s). Sin documento rige la decisión vigente:
BOB dos decimales; ARS al múltiplo de 100 más cercano. Documento válido de ejemplo:
`{ "BOB": { "tipo": "decimales", "decimales": 2, "modo": "cercano" }, "ARS": { "tipo": "multiplo", "multiplo": 100, "modo": "cercano" } }`.
Un documento inválido **no se adivina**: las operaciones que lo necesitan fallan con `failed-precondition`.

## 9. Variables, secretos y despliegue (solo nombres)

Secretos (Secret Manager, `defineSecret`): `NOVUCHAT_PEDIDOS_SECRETO`, `SITIO_RECONSTRUCCION_SECRETO`, `LIMITE_TASA_SAL`.

Parámetros (`.env.<alias>` en el origen de las funciones o variables de despliegue; valores por defecto entre paréntesis):
`TENANT_ID` (`casa-bermejo`), `APP_CHECK_EXIGIDO` (`false`; **`true` en producción**), `APP_CHECK_MODO` (`real`), `RECAPTCHA_MODO` (`real`),
`RECAPTCHA_CLAVE_SITIO`, `SITIO_URL`, `MEDIOS_BASE_URL`, `FFMPEG_PATH`, `FFPROBE_PATH`, `CONTACTO_MAXIMO` (`5`), `CONTACTO_VENTANA_SEG` (`600`),
`NOVUCHAT_MAXIMO_POR_MINUTO` (`120`). Los modos `simulado` solo funcionan en el emulador (`FUNCTIONS_EMULATOR`) o con `PLATAFORMA_PRUEBAS=1`: en la nube lanzan al arrancar.

Una instalación atiende **un** tenant en las rutas sin token de usuario (`TENANT_ID`: sitio, contacto y pedido firmado). El catálogo y el inventario toman el tenant del token.

Construcción: `node plataforma/funciones/scripts/empaquetar.mjs` genera `dist/funciones/` (un `index.js` empaquetado con esbuild y un `package.json` con las
dependencias de ejecución de versión exacta). `firebase.json` lo declara como `source` y lo ejecuta como `predeploy`.

Hosting: dos sitios con **targets** (`sitio` → `dist/website`, `panel` → `dist/panel`); el CI hace `firebase target:apply hosting sitio|panel`
con los ids de las variables de Environment `FIREBASE_SITE_SITIO` y `FIREBASE_SITE_PANEL` (nunca en el repositorio). La CSP del sitio se sella en
cada build (`dist/website/_cabeceras.json`) y `pnpm build` la compone con `componer-hosting.mjs` en `dist/firebase.json`, que el CI usa al
desplegar (sin sello, rige la CSP base estricta). Parámetros en el despliegue: el CI los escribe desde variables y los pasa por
`FUNCIONES_PARAMETROS` (contrato pendiente en `empaquetar.mjs`; ver `docs/arquitectura/decisiones.md`). Procedimiento completo: `pase-a-staging.md`.
`FIREBASE_DEPLOY_ONLY` coherente con este `firebase.json`: `hosting,functions,firestore,storage`.

Índices (`firestore.indexes.json`; **el emulador no exige índices compuestos, así que una consulta sin índice solo falla en la nube**):

| Consulta | Índice |
|---|---|
| `subidas` por `estado` + `venceEn` | `subidas (estado, venceEn)` |
| `movimientos` por `productoId`, `fecha` desc | `movimientos (productoId, fecha desc)` |
| `ventas` del vendedor / del turno | `ventas (cajeroUid, creadoEnMs desc)`, `(turnoId, creadoEnMs desc)`, `(cajeroUid, turnoId, creadoEnMs desc)` |
| `aprobaciones_descuento` por estado / por solicitante | `(estado, solicitadoEnMs desc)`, `(solicitadoPor, estado, solicitadoEnMs desc)` |
| `movimientos_caja` de un turno | `(turnoId, creadoEnMs desc)` y `(turnoId, creadoEnMs asc)` |
| `creditos` por estado | `(estado, creadoEnMs desc)` |
| `reconstrucciones` por estado | `(estado, solicitadaEnMs asc)` |
| `recibos` por número (prefijo) o por fecha | campo único (automático) |
| TTL de `limitesTasa.expiraEn` | `fieldOverrides` con `ttl: true` |

Pruebas contra el emulador: `pnpm test:funciones` (puertos de `firebase.json`; proyecto `demo-pruebas`; los secretos de la prueba se generan al vuelo).

## 10. Decisiones, límites y hallazgos para el coordinador

- **Colección fuera de las reglas generadas:** el servidor (Admin SDK) escribe además `novuchatTokens` (raíz), `limitesTasa` (raíz), `tenants/{t}/alertas` y
  `tenants/{t}/reconstrucciones`. No están en ningún manifiesto, así que las reglas de Firestore las niegan al navegador (correcto). Si el panel debe **leerlas
  directo** (alertas), hace falta declararlas en un manifiesto; mientras tanto se leen por `consola.alertas`.
- **Contrato del catálogo:** «`precio` (unidades) y `precioCentavos` (mismo entero)» es ambiguo; se implementó `precio` = monto decimal y `precioCentavos` = ese monto × 100.
- **Plantillas del sitio:** unificadas en a7f7418 (`cielo, bosque, ambar, grafito, ciruela`). `pruebas/funciones/programadas.test.ts` todavía siembra `marfil` y falla en `test:funciones` (04/11/2026).
- **Adaptador de Recibos en memoria:** `ejecutorRecibosDesde` (en `plataforma/adaptadores/`) exige leer antes de `actualizar`, y `enviarRecibo` actualiza en una transacción nueva
  sin leer: falla. Las funciones usan `crearEjecutorRecibos` (Firestore, `update` nativo). Conviene corregirlo o retirarlo en la próxima integración.
- **Enlace del PDF:** `enviarRecibo` guarda el PDF en una ruta privada y firma una URL v4 de hasta 7 días; el enlace de WhatsApp caduca a los 7 días. La cuenta de servicio de
  las funciones necesita el rol «Creador de tokens de cuenta de servicio» sobre sí misma para firmar.
- **Excel:** no hay lector de `.xlsx` (puerto `LectorHojas` sin implementación); solo CSV.
- **Configuración en la nube pendiente:** App Check, reCAPTCHA Enterprise, IAM y secretos no se crearon (§11).

## 11. Qué debe autorizar Andres (lo ejecuta Claude con su «sí»)

Guion paso a paso con los comandos exactos: `pase-a-staging.md`.

1. Crear los tres secretos en Secret Manager del proyecto de staging y dar acceso a la cuenta de servicio de las funciones.
2. Primer despliegue a staging de `functions`, `hosting`, `firestore` (reglas e índices) y `storage` (reglas), y la variable `FIREBASE_DEPLOY_ONLY`.
3. Crear en staging los dos sitios de Hosting y aplicar los targets.
4. Registrar App Check (reCAPTCHA Enterprise) y la clave de sitio; fijar `APP_CHECK_EXIGIDO=true` y `RECAPTCHA_CLAVE_SITIO`.
5. Registrar el token de NovuChat (`token-novuchat.mjs registrar`) y entregárselo a n8n sin mostrarlo.
6. Crear la alerta de Cloud Monitoring y su canal de correo (`alertas.md`).
7. Activar la política TTL de `limitesTasa.expiraEn` (viene en `firestore.indexes.json`).
8. Decidir el video: empaquetar un binario de ffmpeg o procesar el video fuera de Functions.
