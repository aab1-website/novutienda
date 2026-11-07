# Estado del proyecto

Última actualización: 06/11/2026 (L1 cerrada, L2 planificada).

**El estado vivo de la arquitectura no se escribe aquí: lo imprime `pnpm zonas`** (pieza → zona, archivos
sin zona, cruces de importación y qué deuda queda). Lo que sigue son hitos y pendientes que no se
derivan del código; las cifras caducan y por eso no se copian.

## Hecho

- Fase 0: estándar DevSecOps v2 (modo A), `CLAUDE.md`.
- Ola 1 (núcleo): registro de módulos, identidad, límites, auditoría, eventos, tipo de cambio, generador de reglas con matriz, infraestructura de pruebas.
- Ola 2 (módulos): Inventarios, Recibos, POS, Consola y catálogo, integración entre módulos y correcciones.
- Ola 3 (bordes): sitio público (Astro), panel (Vite + Preact), Cloud Functions v2 en `us-east1` (callables, API HTTP, bus de eventos,
  programadas, disparador de Storage), contrato de reconstrucción del sitio y alerta de cotización documentados. Renombre a NovuTienda (`@novutienda/*`).
- CI del estándar en verde en `main`; build raíz que entrega `dist/website`, `dist/panel` y `dist/firebase.json`.
- Arquitectura por zonas, hito H0: plano aprobado con observaciones (`docs/arquitectura/01-arquitectura-por-zonas.md`).
- Arquitectura por zonas, tanda T0 (rama `metodo/t0-zonas`): zona por archivo y deuda que solo baja (`pruebas/fronteras/`),
  medición `pnpm zonas`, agentes por zona con gancho de zona de escritura, `docs/arquitectura/{zonas,coordinador,zona-de-escritura}.md`,
  `CLAUDE.md` con la regla de zonas, `CODEOWNERS` por carpetas reales, frontera en el pre-commit. Sin mover ni cambiar lógica.
- Arquitectura por zonas, tandas T1 a T4 fusionadas (H2, PR 18 a 22) y L1 cerrada (PR 23 a 27: T5, L1-0, L1-a, L1-b, L1-c): colecciones con dueño y `storage.rules` generado; hito H3 aprobado el 06/11/2026.

## Bloqueos registrados el 04/11/2026 (confirmar si siguen; el CI de `main` ya está en verde)

- `plataforma/funciones/scripts/empaquetar.mjs` no incorpora los parámetros de despliegue (`FUNCIONES_PARAMETROS` → `dist/funciones/.env`);
  el CI falla a propósito antes de desplegar con `SITIO_URL` vacío. Contrato en `docs/arquitectura/decisiones.md`.
- El panel no inicializa App Check: `APP_CHECK_EXIGIDO` debe quedar en `false` hasta que lo haga (producción lo exige por defecto).

## Pendiente

- L2 (encendido por tenant y manifiesto completo): planificada, bloques L2-0 a L2-9. Plan: `NOVUTIENDA_plan-L2-encendido-por-tenant_2026-11-06.md`
  (en `~/CLAUDE_DESCARGAS/`); decisiones D1 a D5 y alcance en el plano §6.7; filas en §7. L3 (HTTP, bus, disparador) queda para antes del tercer tenant.
- Pase a staging (`docs/produccion/pase-a-staging.md`): proyecto, facturación, Firestore/Storage, Hosting, WIF, secretos, App Check,
  variables y Environments de GitHub, rulesets, alerta de Monitoring.
- Decisiones de Andres: D2 a D5 del plan único (proyectos Firebase, ubicación de Firestore —se propone `us-east1`—, segundo aprobador,
  nombre); cuenta de servicio de ejecución dedicada para Functions; video (ffmpeg en Functions o fuera); `minimumReleaseAge` y
  `trustPolicy` de pnpm (ver bitácora).
