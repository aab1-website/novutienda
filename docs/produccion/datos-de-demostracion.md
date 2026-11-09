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

## Idempotencia

Los identificadores de operación son deterministas (`demo-v1-…`). Una segunda pasada de `--verificar` informa «pasos pendientes 0» y
`--aplicar` no escribe nada.

## Límite del plan base

El plan base admite 3 usuarios: las tres cuentas demo **llenan el cupo**. Antes de dar de alta personal real:

1. Agregar primero el administrador real.
2. Quitar después las cuentas demo.
3. Dar de alta el resto del personal.

Los productos, ventas y movimientos demo no se borran: los productos se desactivan desde Inventarios.
