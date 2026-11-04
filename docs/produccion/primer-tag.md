# Primer tag de producción: DAST sobre staging

El primer tag `vX.Y.Z` exige que el análisis dinámico (DAST, OWASP ZAP) haya
corrido contra un staging real. Requisitos antes de crearlo:

1. La variable de repositorio `GCP_PROJECT_ID_STAGING` (y `STAGING_URL`) debe
   estar definida. Con ella vacía, `dast-y-humo` se omite.
2. El job `exigir-dast-staging` de `.github/workflows/ci-node-firebase.yml`
   falla en cualquier push de tag `v*` si `GCP_PROJECT_ID_STAGING` está vacía:
   emite un `::error::` y escribe «DAST NO CORRIÓ» en el resumen del job.
   `desplegar-produccion` depende de ese job, así que no se despliega sin DAST.
3. Un merge a `main` previo debe haber desplegado a staging y pasado
   `dast-y-humo` en verde; el tag se crea sobre ese commit.

No se relaja la exigencia vaciando la variable ni quitando el job: configurar
staging es parte del pase a producción (ver `/pase-a-produccion`).
