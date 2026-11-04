# Decisiones de arquitectura

- 04/11/2026: opción A (monorepo, un proyecto Firebase de plataforma, datos bajo `tenants/{tenantId}`), con la puerta abierta a un proyecto por tenant.
- 04/11/2026: repositorio público, modo A del estándar DevSecOps. Los documentos comerciales y los datos del cliente no entran al historial (`.gitignore`).
- 04/11/2026: alcance = propuesta comercial firmada y su Anexo A; lo demás no se construye en esta entrega.
- Desviación del CI: `desplegar-staging` y `dast-y-humo` solo corren si `GCP_PROJECT_ID_STAGING` tiene valor. Sin esa condición `main` queda en rojo hasta federar el proyecto. Revisa el agente `seguridad`.
