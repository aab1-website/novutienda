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

4. **Alta de cada tenant en producción**, antes del tag (ficha: `docs/produccion/alta-de-tenant.md`): `--verificar`, mostrar el diff,
   `--aplicar` con el «sí» de Andres y volver a `--verificar` hasta que diga que el documento coincide. Sin el documento `tenants/{t}`
   todas las acciones de módulo quedan rechazadas y las programadas no tienen a quién correr.

5. **Medios públicos en producción** (`docs/produccion/pase-a-staging.md` 9.5), antes del tag: crear `<proyecto>-medios` en `us-east1`, con acceso
   uniforme y sin versionado; lectura de `allUsers` solo con `roles/storage.legacyObjectReader` (nunca `objectViewer`: permite listar); `roles/storage.objectUser`
   de la cuenta de las funciones sobre ese bucket; cargar `MEDIOS_BASE_URL` y `MEDIOS_BUCKET_PUBLICO` en el Environment `production`. Sin ellas el despliegue falla a propósito.

No se relaja la exigencia vaciando la variable ni quitando el job: configurar
staging es parte del pase a producción (ver `/pase-a-produccion`).
