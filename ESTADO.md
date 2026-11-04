# Estado del proyecto

Última actualización: 04/11/2026.

- Fase 0 (estándar DevSecOps, CLAUDE.md): hecha.
- Ola 1a (andamiaje y registro de módulos): hecha y en el trunk del núcleo.
  - Monorepo pnpm (`paquetes/*`, `tenants/*`), TypeScript estricto, ESLint, Vitest con cobertura.
  - `@novutienda/nucleo` (nombre provisional): tipos `Rol` y `ManifiestoModulo`, registro con orden topológico y rutas únicas, claim y sobre de eventos congelados.
  - Prueba de fronteras entre paquetes.
- Ola 1b (identidad, límites, auditoría, eventos, tipo de cambio, generador de reglas con matriz): integrada en el trunk del núcleo.
- Ola 1c (infraestructura, rama `feat/nucleo-c-infra`, en curso):
  - `test:rules` reutiliza el emulador si `FIRESTORE_EMULATOR_HOST` está definido (CI).
  - Generador de reglas: rechaza `limite` con escritura distinta de `servidor`; `tieneRol` exige `email_verified`; matriz con negativas de correo no verificado.
  - Registro de la plataforma movido a `plataforma/registro.ts` (fuera del núcleo).
  - CI: un tag `v*` sin `GCP_PROJECT_ID_STAGING` falla (ver `docs/produccion/primer-tag.md`).
- Pendiente: `minimumReleaseAge` y `trustPolicy` de pnpm no se aplican aún; el lockfile actual viola ambas (ver bitácora). Quitar `registroPlataforma` del índice del núcleo al integrar.
- Pendiente de decisión: D2 a D5 del plan único (proyectos Firebase, ubicación de Firestore, segundo aprobador, nombre de la plataforma).
