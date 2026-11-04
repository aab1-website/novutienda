# Estado del proyecto

Última actualización: 04/11/2026.

## Hecho (integrado en el trunk local; nada publicado en GitHub ni desplegado)

- Fase 0: estándar DevSecOps v2 (modo A), `CLAUDE.md`.
- Ola 1 (núcleo): registro de módulos, identidad, límites, auditoría, eventos, tipo de cambio, generador de reglas con matriz, infraestructura de pruebas.
- Ola 2 (módulos): Inventarios, Recibos, POS, Consola y catálogo, integración entre módulos y correcciones.
- Ola 3 (bordes): sitio público (Astro), panel (Vite + Preact), Cloud Functions v2 en `us-east1` (callables, API HTTP, bus de eventos,
  programadas, disparador de Storage), contrato de reconstrucción del sitio y alerta de cotización documentados. Renombre a NovuTienda (`@novutienda/*`).
- Rama `feat/ci` (sin push): build raíz que entrega `dist/website`, `dist/panel` y `dist/firebase.json` con la CSP sellada; CI con
  `test:funciones` en `calidad`, despliegue multi-sitio por WIF con Functions, humo del panel y rollback de los dos sitios; guion de pase a
  staging y de renombre del repositorio.

## Pendiente: pase a staging (`docs/produccion/pase-a-staging.md`)

Nada de lo siguiente está creado: proyecto de staging, facturación, Firestore/Storage, sitios de Hosting, federación WIF, secretos de
Secret Manager, App Check y reCAPTCHA Enterprise, variables y Environments de GitHub, rulesets, alerta de Monitoring, renombre del repositorio.

## Bloqueos (impiden el verde del CI o un despliegue correcto)

1. `pruebas/funciones/programadas.test.ts` siembra la plantilla `marfil`, retirada en a7f7418: `pnpm test:funciones` falla (1 de 86) y,
   con él, `calidad` y `compuerta-pr`. Corrección de una línea en `pruebas/` (otro dueño).
2. `plataforma/funciones/scripts/empaquetar.mjs` no incorpora los parámetros de despliegue (`FUNCIONES_PARAMETROS` → `dist/funciones/.env`);
   el CI falla a propósito antes de desplegar con `SITIO_URL` vacío. Contrato en `docs/arquitectura/decisiones.md`.
3. El panel no inicializa App Check: `APP_CHECK_EXIGIDO` debe quedar en `false` hasta que lo haga (producción lo exige por defecto).

## Pendiente de decisión

- D2 a D5 del plan único (proyectos Firebase, ubicación de Firestore —se propone `us-east1`—, segundo aprobador, nombre).
- Cuenta de servicio de ejecución dedicada para Functions (hoy la de Compute por defecto).
- Video: binario de ffmpeg en Functions o procesamiento fuera.
- `minimumReleaseAge` y `trustPolicy` de pnpm sin aplicar (el lockfile viola ambas; ver bitácora).
