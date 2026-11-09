# Datos de demostración (staging)

Ficha del operador. Carga datos **ficticios** en un tenant de staging para una beta: personal de prueba, almacenes, catálogo,
series, fichas, fotos, configuración del sitio, plantilla de recibo y tres ventas. Todo pasa por las mismas callables del panel,
sin escrituras directas en Firestore. La lógica pura vive en `plataforma/operador/personal.ts` y `plataforma/operador/demo.ts`;
los fixtures, en `scripts/demo/` (todos ficticios).

## Qué crea

- Tres cuentas de Auth con correo y contraseña, con dominio `@example.com`: administrador (`adm`), supervisor (`sup`) y cajero (`caj`).
- Tres almacenes.
- Unos veinte productos espejo del ejemplo del sitio, más accesorios que solo se venden en el POS.
- Series, fichas de producto y fotos.
- Configuración del sitio (`sitio/config`) y plantilla de recibo.
- Tres ventas de demostración.

## Qué no hace

- No toca producción, reglas de Firestore ni IAM.
- No borra nada: Inventarios no borra productos, se desactivan.
- No imprime identificadores, correos, contraseñas ni tokens.

**Nunca se ejecuta `--aplicar` contra producción.** Esta carga es solo para staging.

## Requisitos previos

1. Alta del tenant aplicada con `scripts/alta-tenant.mjs` (`docs/produccion/alta-de-tenant.md`).
2. Firebase Auth con proveedor de correo y contraseña habilitado.
3. Cotización vigente (las ventas la necesitan).
4. `GOOGLE_CLOUD_PROJECT` definido con el proyecto de staging (por el operador, en su shell; no se escribe en el repositorio).
5. Archivos locales **fuera del repositorio**, en `CLIENTES/CASA_BERMEJO/staging/`:
   - `personal.json` (o se usa `scripts/demo/personal.json`, genérico): `{ "cuentas": [{ "correo", "rol": "adm|sup|caj", "nombre"? }] }`.
   - `credenciales.json`: lo crea `personal-tenant.mjs` con permisos 0600 y contraseñas aleatorias; ambos scripts rechazan una ruta dentro del repositorio.
   - `web.json`: configuración web del proyecto (`apiKey`, `projectId`, `storageBucket`).

## Orden de uso

Siempre `--verificar` (solo lectura) antes de `--aplicar`.

1. Personal:
   `node scripts/personal-tenant.mjs <tenant> --entrada <personal.json> --verificar`, luego el mismo comando con `--aplicar`.
2. Datos:
   `node scripts/demo-tenant.mjs <tenant> --credenciales <credenciales.json> --web <web.json> --verificar`, luego con `--aplicar`.
   Opciones: `--sin-fotos` omite la subida de fotos; `--sin-ventas` omite las tres ventas.
3. Revisar el panel con las cuentas demo. Las contraseñas están solo en `credenciales.json`.

Si el plan muestra `BLOQUEO`, `--aplicar` no escribe nada: se corrige la causa y se repite `--verificar`.

## Fixtures propios (`--fixtures`)

Por defecto el script carga `scripts/demo/` (ficticio). `--fixtures <carpeta>` carga otra carpeta con `catalogo.csv`, `demo.json`
(misma forma que el de fábrica) y `fotos/`. Esa carpeta puede traer datos reales, así que **debe estar fuera del repositorio o
ignorada por git** (la misma guardia que las credenciales); si no, el script se detiene antes de leer nada. Los datos reales no
se versionan nunca.

- Los nombres de foto no pueden contener `/`, `\` ni `..`. Se admiten `.jpg`, `.png`, `.webp` y `.heic` (el tipo se toma de la
  extensión) y hasta 15 MB por foto (tope de la regla de Storage). La espera del procesamiento crece con el tamaño de la foto, con tope.
- La importación de Inventarios admite hasta 50 filas por llamada: un catálogo mayor se parte en lotes de 50 con
  `operacionId` deterministas (`demo-v1-catalogo`, `demo-v1-catalogo-2`, …). Cada lote es todo o nada; un lote ya cargado se omite y uno
  parcial bloquea. El plan del sitio admite hasta 200 productos en total.
- Con fixtures propios, todos los identificadores de operación, subidas, turno y ventas llevan el prefijo `demo-x<hash8>` (primeros 8 hex del SHA-256 de `catalogo.csv`, `demo.json` y los nombres de foto) en lugar de `demo-v1`: no chocan con cargas anteriores y un fixture cambiado produce operaciones nuevas. Plantilla y configuración del sitio que ya coinciden se omiten; el turno de una carga anterior no se reutiliza.
- Fotos: tras subir el original el script solo espera a que el disparador de Storage la procese (sondea el estado; `finalizarSubida`
  queda de respaldo si a los ~45 s la reserva sigue pendiente), porque llamar a ambos a la vez hace que uno rechace la subida. Una
  subida rechazada se reintenta con un identificador nuevo (`<id>-r2`, `-r3`; hasta 3 intentos por foto) y tras 3 fallos el plan da
  `BLOQUEO`. Las reservas rechazadas liberan su cupo de 5 fotos por producto.
- La segunda pasada sigue en cero pasos con fixtures propios.

## Retirar lo que no está en el fixture (`--retirar-fuera-del-fixture`)

Con esta opción, `--aplicar` desactiva y despublica (`activo=false`, `publicado=false`; nunca borra) los productos del tenant cuyo
id no figura en el `catalogo.csv` del fixture, con la acción `editarProducto` de la consola (la misma del panel). `--verificar`
los lista como «por retirar: N». Es idempotente: los ya retirados no vuelven a aparecer. Se republica el sitio al final. Sirve,
por ejemplo, para quitar de staging los productos de una demostración anterior.

## Idempotencia

Los identificadores de operación son deterministas (`demo-v1-…`). Una segunda pasada de `--verificar` informa «pasos pendientes 0» y
`--aplicar` no escribe nada.

## Límite del plan base

El plan base admite 3 usuarios: las tres cuentas demo **llenan el cupo**. Antes de dar de alta personal real:

1. Agregar primero el administrador real.
2. Quitar después las cuentas demo.
3. Dar de alta el resto del personal.

Los productos, ventas y movimientos demo no se borran: los productos se desactivan desde Inventarios.
