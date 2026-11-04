# Estado del proyecto

Última actualización: 04/11/2026.

- Fase 0 (estándar DevSecOps, CLAUDE.md): hecha.
- Ola 1a (andamiaje y registro de módulos): implementada en la rama `feat/nucleo-registro`, pendiente de revisión.
  - Monorepo pnpm (`paquetes/*`, `tenants/*`), TypeScript estricto, ESLint, Vitest con cobertura.
  - `@plataforma/nucleo` (nombre provisional): tipos `Rol` y `ManifiestoModulo`, registro con orden topológico y rutas únicas, claim y sobre de eventos congelados.
  - Prueba de fronteras entre paquetes.
  - Firebase: reglas de Firestore y Storage que niegan todo; hosting con cabeceras de seguridad y `/healthz`.
- Siguiente: ola 1b (identidad y límites, generador de reglas con matriz negativa, auditoría y eventos, tipo de cambio).
- Pendiente de decisión: D2 a D5 del plan único (proyectos Firebase, ubicación de Firestore, segundo aprobador, nombre de la plataforma).
