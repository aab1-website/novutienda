# Estado del proyecto

Última actualización: 11/11/2026 (sitio real en staging con fotos; sigue el pase a producción).

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
- Arquitectura por zonas, L2 cerrada (bloques L2-0 a L2-9 fusionados): encendido por tenant en ejecución, manifiestos completos, alta de tenant (`scripts/alta-tenant.mjs`); hito H4 aprobado el 07/11/2026. El alta de Casa Bermejo ya se aplicó en staging.
- Sitio de Hosting por tenant (PR C): scripts (#65) y reconstrucción con matriz en staging (#66, fusionado; ajustes #68 a #72 tras la primera reconstrucción real), documentados en `docs/produccion/reconstruccion-sitio.md`; decisiones DC1 a DC4 en `docs/arquitectura/decisiones.md`.
- 11/11/2026: sitio real publicado en staging con fotos. En staging hay hoy una copia única de los medios hecha ese día y la lectura sin listado ya está aplicada. **Pendiente de despliegue:** que los medios públicos se escriban en un bucket público aparte (`MEDIOS_BUCKET_PUBLICO`); decisión en `docs/arquitectura/decisiones.md` y operación en `docs/produccion/pase-a-staging.md` 9.5.
- Arquitectura por zonas, L3 (PR 42 a 46): encendido por tenant también en la API HTTP (`docs/produccion/funciones.md` §4), disparador de medios con consola apagada y limpieza para todos los tenants; sin cambio de contrato con NovuChat.

## Bloqueos registrados el 04/11/2026 (confirmar si siguen; el CI de `main` ya está en verde)

- `plataforma/funciones/scripts/empaquetar.mjs` no incorpora los parámetros de despliegue (`FUNCIONES_PARAMETROS` → `dist/funciones/.env`);
  el CI falla a propósito antes de desplegar con `SITIO_URL` vacío. Contrato en `docs/arquitectura/decisiones.md`.
- El panel no inicializa App Check: `APP_CHECK_EXIGIDO` debe quedar en `false` hasta que lo haga (producción lo exige por defecto).

## Pendiente

- Sitio por tenant: decisión de Andres sobre una cuenta de servicio propia con solo `roles/firebasehosting.admin`; cargar el logo de `t1`; borrar la variable de repositorio `TENANT_ID` tras el pase de producción. Secretos y variable de staging ya cargados (10/11/2026).

- L3 (HTTP, bus de eventos, disparador) cerrada el 09/11/2026 (plano §6.8 y §7): L3-0 a L3-5 fusionados (PR 42 a 47), L3-6 es este cierre. El encendido por tenant rige también para la API HTTP; ver `docs/produccion/funciones.md`.
- Pase a producción: alta de Casa Bermejo en producción antes del tag (`docs/produccion/primer-tag.md`); está pendiente. Sin el documento del tenant, la API HTTP responde como módulo apagado.
- Datos de demostración en staging: código fusionado (scripts `personal-tenant.mjs` y `demo-tenant.mjs`, ficha en `docs/produccion/datos-de-demostracion.md`); aplicarlos en staging es un paso aparte con el visto bueno de Andres.
- Pase a staging (`docs/produccion/pase-a-staging.md`): proyecto, facturación, Firestore/Storage, Hosting, WIF, secretos, App Check,
  variables y Environments de GitHub, rulesets, alerta de Monitoring.
- Decisiones de Andres: D2 a D5 del plan único (proyectos Firebase, ubicación de Firestore —se propone `us-east1`—, segundo aprobador,
  nombre); cuenta de servicio de ejecución dedicada para Functions; video (ffmpeg en Functions o fuera); `minimumReleaseAge` y
  `trustPolicy` de pnpm (ver bitácora).
