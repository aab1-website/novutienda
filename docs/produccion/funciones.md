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
- **`details.codigo`:** TODO `HttpsError` lleva `details.codigo`, el código del módulo en kebab-case (`sin-turno`, `stock-insuficiente`,
  `serie-no-disponible`, `recibo-no-encontrado`, `limite-del-plan`, `ultimo-adm`…). Los errores que nacen en el borde (marco,
  sesión, acción desconocida, datos inválidos) llevan un código genérico por tipo: `solicitud-invalida`, `no-autenticado`,
  `acceso-denegado`, `recurso-inexistente`, `precondicion-fallida`, `ya-existe`, `limite-alcanzado`, `error-interno`, `no-disponible`,
  `tiempo-agotado`. El panel mapea el mensaje por ese código; si no tiene mensaje propio para él (los del borde), usa el `message`
  del servidor, que es apto para el usuario.
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
| `aprobarAnulacion` | SUP | `{ ventaId, motivo }` (motivo del aprobador; `autoaprobacion` si vendió o solicitó) | `{ ventaId, reembolsos[], turnoIdReembolso }` |
| `registrarMovimientoCaja` | TODOS | `{ requestId, movimiento: { tipo: 'ingreso'\|'egreso', moneda, monto, motivo, comprobante? } }` | `{ movimiento, repetido }` |
| `cobrarCredito` | TODOS | `{ requestId, ventaId, cobro: { medio, monto, referencia? } }` | `{ cobro, repetido }` |
| `leerConfig` / `guardarConfig` | TODOS / ADM | `{}` / `{ config }` | `{ config }` |
| `miTurno` | TODOS | `{}` | `{ turno \| null, cajaOcupada, proyeccion? }` (el vendedor ve solo el suyo) |
| `misVentas` | TODOS | `{ turnoId?, desde?, hasta?, limite?, soloMias? }` (ms Unix) | `{ ventas[] }` (el vendedor, solo las suyas) |
| `venta` | TODOS (el vendedor, solo las suyas) | `{ ventaId }` | `{ venta }` |
| `aprobaciones` / `aprobacion` | TODOS (el vendedor, solo las que él solicitó) | `{ estado?, limite? }` / `{ aprobacionId }` | `{ aprobaciones[] }` / `{ aprobacion }` |
| `movimientosCaja` | TODOS (el vendedor, solo su turno) | `{ turnoId, limite? }` | `{ movimientos[] }` |
| `creditos` | TODOS (el vendedor, solo los créditos de SUS ventas: el crédito guarda `cajeroUid` y se consulta por él, sin tope de ventas; los créditos creados antes de este campo no aparecen para el vendedor) | `{ estado?: pendiente\|cobrado\|anulado, limite? }` | `{ creditos[] }` |
| `cotizaciones` | TODOS | `{}` | `{ cotizaciones: { BO, AR }, redondeo }`: cada mercado es `{ cotizacionId, par, valor, fecha, fuente, estado }` o `null` si no hay una utilizable; `redondeo` es la política de `tenants/{t}/config/redondeo` (por defecto BOB dos decimales, ARS múltiplo de 100 más cercano). El panel calcula con ese redondeo. |
| `turnos`, `supervision` | SUP | `{ limite? }` / `{}` | listas; `supervision`: `{ turno, proyeccion, ultimasVentas[] }` |
| `exportarVentasCsv` / `exportarMovimientosCajaCsv` | SUP | `{ desde, hasta }` / `{ turnoId }` | `{ csv, truncado }` (celdas con `= + - @` neutralizadas; máximo 5000 filas: si hay más, `truncado: true` y el panel avisa) |

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
| `ubicaciones`, `buscarSerie`, `conteos` | TODOS | `{}` / `{ serie, productoId? }` / `{ estado?, limite? }` | listas |
| `series` | TODOS | `{ productoId, ubicacionId?, soloDisponibles?, limite? }` | `{ unidades[] }` (`productoId, serie, estado, ubicacionId, ventaRef?` como id de venta, `garantiaHasta?`); sin costos |
| `conteo` | TODOS | `{ conteoId }` | `{ conteo, lineas[] }`; **conteo ciego:** nunca trae teóricos mientras está abierto ni al vendedor. Con el conteo **cerrado**, `sup`/`adm` reciben además `resultado: [{ productoId, teorico, contado, diferencia }]` |
| `movimientos` | SUP | `{ productoId?, desde?, hasta?, tipo?, uid?, limite? }` | `{ movimientos[] }`; `costoUSDUnit` solo lo ve ADM. `tipo` y `uid` (autor) se filtran sobre los últimos 1000 movimientos del resto de los filtros, para no exigir índices compuestos nuevos |
| `mermas`, `exportarCsv` | SUP | `{ estado?, limite? }` / `{ conCostos? }` (costos solo ADM) | listas; `{ csv }` |
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
| `auditoria` | SUP | `{ desde?, hasta?, accion?, uid?, limite? }` (ms Unix, rango de hasta 366 días) | `{ entradas[] }` de `tenants/{t}/auditoria`, de la más reciente a la más antigua: `{ id, fecha, uid, rol, accion, ruta, motivo? }` (sin los resúmenes antes/después). `accion` y `uid` se filtran sobre las últimas 1000 entradas del rango (sin índice compuesto nuevo) |
| `fichas` / `secciones` / `carruseles` / `configSitio` | SUP | `{}` | `{ fichas: [{ productoId, ficha }] }` / `{ secciones[] }` (en el orden del índice del sitio) / `{ carruseles[] }` / `{ config }` (o `null`); solo lectura |
| `buscarUsuarioPorCorreo` | ADM / propietario | `{ correo }` | `{ uid, correoVerificado, conContrasena }`. **Privacidad:** responde solo si la cuenta ya es miembro de ESTE negocio o no tiene ningún negocio en su claim; en cualquier otro caso responde `not-found` exactamente igual que si no existiera, para que no revele qué correos usa otro negocio |
| `asignarRol` / `quitarRol` | ADM / propietario | `{ uid, rol }` / `{ uid }` | `{ claim }` (solo el propietario toca a un `adm`; el último `adm` no se quita) |

`asignarRol` **no crea la cuenta**: solo asigna el rol a un `uid` existente. El panel **no** puede crear cuentas de Firebase Auth: el personal debe existir (correo y contraseña, correo verificado) antes de `asignarRol`.

### `medios`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `reservarSubida` | SUP | `{ subidaId (8–40: A-Z a-z 0-9 _ -), productoId, tipo: 'foto'\|'video', bytes }` | `{ subidaId, rutaOriginal, venceEn }` |
| `finalizarSubida` | SUP | `{ subidaId }` | `{ medio }` (idempotente; normalmente ya la hizo el disparador) |
| `estadoSubida` | SUP | `{ subidaId }` | `{ estado: 'reservada'\|'procesada'\|'borrando'\|'rechazada', medio?, motivo? }` (`medio` solo si `procesada`; `motivo` si la subida se rechazó; `not-found` si no existe). El panel la sondea tras subir el original, sin forzar el procesamiento |
| `borrarMedio` | SUP | `{ medioId }` | `{ ok }` |
| `listarMedios` | SUP | `{ productoId, limite? }` | `{ medios[] }` |

Flujo de subida: `reservarSubida` → el navegador sube a `rutaOriginal` con el SDK de Storage (`contentType` de foto: jpeg/png/webp/heic; video:
mp4/quicktime/webm) → el disparador procesa → el panel espera `subidas/{id}.estado` (`procesada` o `rechazada`) o llama `finalizarSubida`.

Carrera entre el disparador y `finalizarSubida`: si dos ejecuciones procesan el mismo original, gana la que confirma primero; la otra borra sus
temporales y las versiones publicadas que el ganador no usa, y devuelve el medio ganador (la acción sigue siendo idempotente). El panel espera con
reintentos y retroceso (hasta ~2 minutos si la llamada se corta por tiempo o por red) y muestra el tiempo transcurrido.
**Pendiente (no es de esta ola):** `estadoSubida` (consulta sin procesar, exportada por `@novutienda/consola`) aún no tiene acción en el callable
`medios`; al agregarla (rol SUP, `{ subidaId }` → `{ estado, medio?, motivo? }`) el panel debe pasar a consultar el estado en vez de llamar
`finalizarSubida`, que evita el trabajo duplicado.

### `recibos`
| Acción | Roles | `datos` | Devuelve |
|---|---|---|---|
| `leerPlantilla` / `guardarPlantilla` | TODOS / SUP | `{}` / `{ plantilla }` | `{ plantilla }` / `{ ok }` |
| `buscarComprobantes` | TODOS (el vendedor, solo los de sus ventas; el filtro se aplica antes del límite) | `{ numero?, desde?, hasta?, cliente?, limite? }` (fechas `aaaa-mm-dd`; `numero` sin distinguir mayúsculas: con serie `A-0001` es prefijo indexado, sin serie `123`/`000123` busca `{serie}-000123` en cada serie del tenant) | `{ recibos[] }` |
| `leerRecibo`, `htmlRecibo`, `pdfRecibo` | TODOS (el vendedor, solo los suyos) | `{ reciboId }` (el id del comprobante de una venta es `recibo-<ventaId>`) | `{ recibo }` / `{ html }` / `{ pdfBase64 }` |
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
`TENANT_ID` (**sin valor por defecto**: el despliegue lo exige), `APP_CHECK_EXIGIDO` (`false`; **`true` en producción**, el despliegue lo exige), `APP_CHECK_MODO` (`real`),
`RECAPTCHA_MODO` (`real`), `RECAPTCHA_CLAVE_SITIO`, `SITIO_URL`, `MEDIOS_BASE_URL` (**obligatoria**, https, origen público aparte; sin valor por defecto al bucket por defecto),
`FUNCIONES_SERVICE_ACCOUNT` (vacío = cuenta por defecto; en producción, una dedicada), `PROXY_SALTOS` (`2`), `FFMPEG_PATH`, `FFPROBE_PATH`, `CONTACTO_MAXIMO` (`5`),
`CONTACTO_VENTANA_SEG` (`600`), `NOVUCHAT_MAXIMO_POR_MINUTO` (`120`), `DISPONIBILIDAD_MAXIMO_POR_MINUTO` (`60`). Fuera del emulador y de las pruebas, `LIMITE_TASA_SAL` y
`MEDIOS_BASE_URL` faltantes hacen fallar la API (`ConfiguracionIncompleta`). Los modos `simulado` solo funcionan en el emulador (`FUNCTIONS_EMULATOR`) o con `PLATAFORMA_PRUEBAS=1`: en la nube lanzan al arrancar.

Una instalación atiende **un** tenant en las rutas sin token de usuario (`TENANT_ID`: sitio, contacto y pedido firmado). El catálogo y el inventario toman el tenant del token.

Construcción: `node plataforma/funciones/scripts/empaquetar.mjs` genera `dist/funciones/` (un `index.js` empaquetado con esbuild y un `package.json` con las
dependencias de ejecución de versión exacta y su `package-lock.json`, que Cloud Build usa con `npm ci` y el CI analiza con osv-scanner). `firebase.json` lo declara como `source` y lo ejecuta como `predeploy`.

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
| `movimientos` por `tipo`, `fecha` desc | `movimientos (tipo, fecha desc)` (nuevo) |
| `movimientos` por `por` (usuario), `fecha` desc | `movimientos (por, fecha desc)` (nuevo) |
| `auditoria` por `accion`, `en` desc | `auditoria (accion, en desc)` (nuevo) |
| `auditoria` por `uid`, `en` desc | `auditoria (uid, en desc)` (nuevo) |
| `auditoria` y `movimientos` solo por rango de fecha (`en` / `fecha`) | campo único (automático) |
| `ventas` del vendedor / del turno | `ventas (cajeroUid, creadoEnMs desc)`, `(turnoId, creadoEnMs desc)`, `(cajeroUid, turnoId, creadoEnMs desc)` |
| `pos.exportarVentasCsv` (rango de `creadoEnMs`, orden ascendente) | campo único (automático): filtro de rango y orden sobre el mismo campo |
| `aprobaciones_descuento` por estado / por solicitante | `(estado, solicitadoEnMs desc)`, `(solicitadoPor, estado, solicitadoEnMs desc)` |
| `movimientos_caja` de un turno | `(turnoId, creadoEnMs desc)` y `(turnoId, creadoEnMs asc)` |
| `creditos` por estado | `(estado, creadoEnMs desc)` |
| `creditos` del vendedor | `(cajeroUid, creadoEnMs desc)` y `(cajeroUid, estado, creadoEnMs desc)` |
| `inventarios.series` (`productoId` + `ubicacionId` + `estado`) y `buscarSerie` (`serie` + `productoId`) | ninguno: solo igualdades, que Firestore resuelve combinando los índices de campo único; el orden por serie se hace en memoria |
| `reconstrucciones` por estado | `(estado, solicitadaEnMs asc)` |
| `recibos` por número (prefijo) o por fecha | campo único (automático) |
| TTL de `limitesTasa.expiraEn` | `fieldOverrides` con `ttl: true` |

Los cuatro índices nuevos (`movimientos` por `tipo` y por `por`; `auditoria` por `accion` y por `uid`, todos con orden descendente por fecha)
respaldan filtros que hoy el servidor aplica **en memoria** sobre las últimas 1000 filas (`inventarios.movimientos` con `tipo`/`uid`;
`consola.auditoria` con `accion`/`uid`). Con ellos esas consultas pueden pasar a consulta exacta (`where` + `orderBy` + `limit`) sin recorrer
el tope de 1000; ese cambio es del dueño de `plataforma/funciones/servidor` y no se hizo aquí (la nota de §3 sobre «sin índice compuesto
nuevo» deja de ser cierta cuando se haga). Con `accion` y `uid` a la vez, Firestore combina ambos índices. Los índices se despliegan con
`firebase deploy --only firestore:indexes` (el CI ya incluye `firestore` en `FIREBASE_DEPLOY_ONLY`) y tardan en construirse: despliéguelos
antes de activar la consulta exacta.

Pruebas contra el emulador: `pnpm test:funciones` (puertos de `firebase.json`; proyecto `demo-pruebas`; los secretos de la prueba se generan al vuelo). Corre con `APP_CHECK_EXIGIDO=true` (las ayudas envían un token del emulador) e incluye `pruebas/panel/emulador.test.ts` y `paquetes/panel/src/appcheck/appcheck.emulador.test.ts`; con `PRUEBAS_FUNCIONES_EXIGIR=1` ninguna se omite en silencio.

## 10. Decisiones, límites y hallazgos para el coordinador

- **Colección fuera de las reglas generadas:** el servidor (Admin SDK) escribe además `novuchatTokens` (raíz), `limitesTasa` (raíz), `tenants/{t}/alertas` y
  `tenants/{t}/reconstrucciones`. No están en ningún manifiesto, así que las reglas de Firestore las niegan al navegador (correcto). Si el panel debe **leerlas
  directo** (alertas), hace falta declararlas en un manifiesto; mientras tanto se leen por `consola.alertas`.
- **Contrato del catálogo:** «`precio` (unidades) y `precioCentavos` (mismo entero)» es ambiguo; se implementó `precio` = monto decimal y `precioCentavos` = ese monto × 100.
- **Enlace del PDF:** `enviarRecibo` guarda el PDF en una ruta privada y firma una URL v4 de hasta 7 días; el enlace de WhatsApp caduca a los 7 días. La cuenta de servicio de
  las funciones necesita el rol «Creador de tokens de cuenta de servicio» sobre sí misma para firmar.
- **Excel:** no hay lector de `.xlsx` (puerto `LectorHojas` sin implementación); solo CSV.
- **Catálogo de NovuChat y productos sin control de stock:** un producto activo que no controla stock sale con `stock: null` y `disponible: true` (antes `stock: 0`, que el
  asistente leía como agotado). Todos los ítems llevan `disponible` (regla única de Inventarios). Cambio de contrato a confirmar con la sesión de NovuChat.
- **Sitio y redondeo:** `GET /api/sitio/v1/publicado` entrega además `redondeo` (de `tenants/{t}/config/redondeo`); ver `reconstruccion-sitio.md`.
- **Eventos fuera de contrato:** el bus valida el contrato completo (`validarEvento`); un evento inválido se registra y se descarta sin relanzar.
- **Origen del límite de tasa:** último salto confiable de `X-Forwarded-For` (`PROXY_SALTOS`, 2 detrás de Hosting + GFE); jamás `Fastly-Client-IP` ni el primer elemento. Además hay un límite en
  memoria por instancia antes de autenticar (NovuChat y `/api/disponibilidad`) y App Check va antes del límite de `/api/contacto`, con token de un solo uso (`consume: true`; el
  sitio debe pedir un token nuevo por envío: `getLimitedUseToken`).
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
