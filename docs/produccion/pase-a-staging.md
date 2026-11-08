# Pase a staging — procedimiento completo

Estado: **no se ejecutó nada**. Este documento es el guion que Claude ejecuta, paso por paso, con el «sí» de Andres en el chat. Andres
no corre comandos: solo hace lo que el sistema exige a una persona (marcado **[Andres]**). Cada paso que escribe en GCP, Firebase o GitHub
se pide como autorización antes de ejecutarlo y se informa con su resultado real.

Reglas que valen en todo el guion:

- **Región `us-east1` siempre** (Functions, Firestore, Storage, Artifact Registry, Secret Manager).
- **Ningún identificador en el repositorio.** Los comandos usan variables de shell que Claude carga de `CONFIGURACION.local.md`
  (ignorado por git) al empezar la sesión: `P` (proyecto de staging), `NUM` (número del proyecto), `SITIO_ID`, `PANEL_ID`, `OWNER`
  (dueño del repositorio en GitHub), `REPO` (`novutienda` tras el renombre), `CORREO_ALERTAS`. Nada de eso se pega en el chat ni en
  archivos versionados.
- **Ningún valor de secreto se muestra.** Se generan y se entregan por tubería; nunca pasan por la pantalla, el chat ni un archivo.
- Leyenda de costo: **[gratis]** dentro del plan gratuito según la documentación al 04/11/2026; **[$]** puede generar cargos (requiere
  plan Blaze; verificar el precio vigente en la documentación oficial, con fecha, antes de autorizar). Ningún paso se ejecuta si
  Andres no aprobó antes el costo.
- Antes de cada bloque, Claude verifica el estado en modo lectura (`describe`, `list`) y solo crea lo que falta (los pasos son repetibles).

## 0. Decisiones previas (Andres)

1. **D2 — Proyecto de staging**: nombre del proyecto Firebase de staging y si se crea nuevo o se reutiliza uno. Sin esto no empieza nada.
2. **Plan Blaze en staging** [$]: Cloud Functions v2, Secret Manager, Cloud Scheduler y Artifact Registry lo exigen. Vincular la cuenta de
   facturación es una pantalla de Google Cloud con medio de pago: **[Andres]** (enlace: `https://console.cloud.google.com/billing/linkedaccount?project=<P>`).
   Recomendado: presupuesto con alerta por correo (paso 13).
3. **Cuenta de servicio de ejecución de las Functions**: el código ya toma `serviceAccount` del parámetro `FUNCIONES_SERVICE_ACCOUNT`
   (`setGlobalOptions`). Vacío = la cuenta por defecto de Compute (`<NUM>-compute@developer.gserviceaccount.com`). **Producción: una SA dedicada**
   con roles mínimos (paso 6.1), cargada en la variable `FUNCIONES_SERVICE_ACCOUNT` del Environment. Para staging se puede aceptar la de Compute
   **si no tiene el rol Editor** (paso 6.3 lo verifica).
4. **Aprobador**: `segurolotengopy` revisa los PR (ruleset) y aprueba el Environment `production`. Debe ser colaborador con permiso de
   escritura y aceptar la invitación: **[segurolotengopy]**.
5. **Renombre del repositorio** a `novutienda` **antes** de la federación (paso 1): el binding de WIF se ata a `OWNER/REPO`.

## 1. Renombre del repositorio [gratis]

Procedimiento en `docs/produccion/renombre-repositorio.md`. Va primero porque la federación (paso 5) autoriza a `OWNER/novutienda`; si se
renombra después, hay que volver a correr `setup-oidc-gcp.sh` y el despliegue falla con `unauthorized_client` hasta entonces.

## 2. Proyecto y APIs

2.1 Crear el proyecto (si D2 dice «nuevo») [gratis] — Claude:

```bash
gcloud projects create "$P" --name="NovuTienda staging"
firebase projects:addfirebase "$P"
NUM=$(gcloud projects describe "$P" --format='value(projectNumber)')   # se anota en CONFIGURACION.local.md
```

2.2 Facturación: **[Andres]** (decisión 0.2). Claude verifica: `gcloud billing projects describe "$P" --format='value(billingEnabled)'` → `True`.

2.3 Habilitar las APIs [gratis; habilitarlas no cobra] — Claude:

```bash
gcloud services enable --project "$P" \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  firestore.googleapis.com firebasestorage.googleapis.com storage.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com \
  identitytoolkit.googleapis.com iamcredentials.googleapis.com sts.googleapis.com monitoring.googleapis.com logging.googleapis.com \
  cloudbilling.googleapis.com firebaseextensions.googleapis.com
```

`gcloud services enable` admite 20 servicios por llamada: partir en dos. `cloudbilling` y `firebaseextensions` las exige `firebase deploy`
(comprueba el plan Blaze y lista extensiones) y la SA de despliegue no puede habilitarlas (primer despliegue, 05/11/2026).

## 3. Datos: Firestore, Storage y Auth

3.1 Base de Firestore en `us-east1` (la ubicación **no se puede cambiar** después; D2–D5) [gratis hasta la cuota diaria]:

```bash
gcloud firestore databases create --project "$P" --location=us-east1 --type=firestore-native
```

3.2 Bucket por defecto de Firebase Storage en `us-east1` [$, almacenamiento y salida]: consola de Firebase → Storage → «Comenzar» →
ubicación `us-east1`, reglas en modo producción (las reales llegan con el despliegue). Es una pantalla: la hace Claude si el navegador
está disponible; si no, **[Andres]** con el enlace `https://console.firebase.google.com/project/<P>/storage`. Claude verifica:
`gcloud storage buckets list --project "$P" --format='value(name,location)'`.

3.3 Auth [gratis hasta el límite de usuarios activos del plan]: habilitar «Correo y contraseña» (personal) y «Google» (propietario de la
plataforma) en `https://console.firebase.google.com/project/<P>/authentication/providers`, y agregar `<SITIO_ID>.web.app` y
`<PANEL_ID>.web.app` a los dominios autorizados. Pantalla de Google: **[Andres]** si pide confirmar la pantalla de consentimiento OAuth.

## 4. Sitios de Hosting [gratis]

```bash
firebase hosting:sites:create "$SITIO_ID" --project "$P"
firebase hosting:sites:create "$PANEL_ID" --project "$P"
firebase hosting:sites:list --project "$P"
```

El CI aplica los targets en cada despliegue (`firebase target:apply hosting sitio|panel`); no se versiona `.firebaserc`.

Lección (04/11/2026): un ID de sitio borrado queda **reservado por el proyecto que lo tuvo**, aun después de `hosting:sites:delete`;
no se puede reutilizar en otro proyecto. Si hay que recrear el staging, los sitios llevan IDs nuevos (p. ej. `<plataforma>-sitio-stg`),
y se actualizan `FIREBASE_SITE_SITIO|PANEL` y los dominios autorizados de Auth.

## 5. Federación GitHub → GCP (WIF) [gratis]

5.1 Claude corre el script del estándar (solo lectura sobre SeguridadGeneral; escribe en GCP):

```bash
/home/andres-alberdi/SeguridadGeneral/03-scripts/setup-oidc-gcp.sh \
  --project "$P" --owner "$OWNER" --repo "$REPO" --ambiente staging
```

Responde «no» a la oferta de cargar secretos en GitHub (se cargan en el paso 9, con autorización aparte). Crea el pool y el proveedor
`github` con la condición `assertion.repository_owner == OWNER`, la SA `deploy-staging` con los roles base del estándar y el binding
`workloadIdentityUser` solo para `OWNER/REPO`. Imprime `GCP_WIF_PROVIDER` y `GCP_SA_DEPLOY_STAGING`: **no son secretos de alto riesgo
pero se guardan como secretos** (estándar, §6.3).

5.2 Roles adicionales de `deploy-staging` que el script no da y este despliegue necesita (Functions, índices, programadas):

```bash
SA_DEPLOY="deploy-staging@${P}.iam.gserviceaccount.com"
for rol in roles/cloudfunctions.developer roles/cloudscheduler.admin roles/datastore.indexAdmin \
           roles/secretmanager.viewer roles/serviceusage.serviceUsageViewer roles/firebasestorage.viewer; do
  gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:${SA_DEPLOY}" --role "$rol" --condition=None --quiet >/dev/null
done
```

Agregado tras el primer despliegue (05/11/2026): un **rol personalizado mínimo** para publicar funciones HTTPS invocables (la CLI
exige `cloudfunctions.functions.setIamPolicy` para `api`; «Cloud Functions Admin» sería mucho más amplio):

```bash
gcloud iam roles create despliegueFuncionesIam --project "$P" --title "NovuTienda: IAM de Functions en despliegue" \
  --permissions cloudfunctions.functions.getIamPolicy,cloudfunctions.functions.setIamPolicy --stage GA
gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:${SA_DEPLOY}" \
  --role "projects/${P}/roles/despliegueFuncionesIam" --condition=None --quiet
```

Agregado tras el primer despliegue (05/11/2026): **`roles/firebase.viewer`**. Sin él, `firebase deploy --only storage` consulta
`firebasestorage.googleapis.com/v1alpha/projects/<P>/defaultBucket` como la SA, recibe 404 y la CLI lo traduce a «Firebase Storage has
not been set up» aunque el bucket exista y esté vinculado. Es solo lectura del proyecto Firebase.

Porqué de cada uno: `cloudfunctions.developer` crea y actualiza las Functions v2; `cloudscheduler.admin`, los tres trabajos programados;
`datastore.indexAdmin`, índices compuestos y la política TTL de `firestore.indexes.json`; `secretmanager.viewer`, firebase-tools comprueba
que los secretos de `defineSecret` existen y quién los puede leer; `serviceusage.serviceUsageViewer`, firebase-tools consulta las APIs
habilitadas (lección de PRETSO: 403 en `serviceusage.services.get`); `firebasestorage.viewer`, localizar el bucket al publicar
`storage.rules`. **Confirmar con el primer despliegue**: si falta un permiso, el registro de `firebase deploy` lo nombra; se agrega ese
rol y se anota aquí (nunca `roles/editor` ni `roles/owner`).

Nota: el clasificador de Claude Code bloqueó en PRETSO otorgar roles IAM aun con autorización en el chat. Si ocurre, Claude no lo esquiva:
entrega a Andres el enlace exacto de IAM y lo verifica después en modo lectura.

## 6. Cuenta de ejecución de las Functions y agentes de servicio [gratis]

6.1 Variable: `SA_FN="${NUM}-compute@developer.gserviceaccount.com"` o la dedicada (producción). Crear la dedicada con roles mínimos y publicarla en la variable
`FUNCIONES_SERVICE_ACCOUNT` del Environment (nombre corto o correo); la SA de despliegue necesita `roles/iam.serviceAccountUser` **sobre esa SA**, no sobre el proyecto:

```bash
SA_FN="novutienda-funciones@${P}.iam.gserviceaccount.com"
gcloud iam service-accounts create novutienda-funciones --project "$P" --display-name="NovuTienda Functions"
for rol in roles/datastore.user roles/firebaseauth.admin roles/logging.logWriter roles/eventarc.eventReceiver; do
  gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:${SA_FN}" --role "$rol" --condition=None --quiet >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://<BUCKET>" --member "serviceAccount:${SA_FN}" --role roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding "$SA_FN" --project "$P" \
  --member "serviceAccount:deploy-staging@${P}.iam.gserviceaccount.com" --role roles/iam.serviceAccountUser
```

6.2 Firmar URLs v4 del PDF de recibos (`enviarRecibo`): «Creador de tokens de cuenta de servicio» de la SA **sobre sí misma**, no sobre el proyecto:

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA_FN" --project "$P" \
  --member "serviceAccount:${SA_FN}" --role roles/iam.serviceAccountTokenCreator
```

6.3 Verificar que la SA de ejecución no tenga Editor (modo lectura):

```bash
gcloud projects get-iam-policy "$P" --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:${SA_FN}" --format='value(bindings.role)'
```

Si aparece `roles/editor`, se informa a Andres: quitarlo exige darle antes los roles mínimos (`roles/datastore.user`,
`roles/storage.objectAdmin` sobre el bucket, `roles/firebaseauth.admin`, `roles/logging.logWriter`, `roles/eventarc.eventReceiver`,
`roles/iam.serviceAccountTokenCreator` del paso 6.2). Es una decisión aparte; en staging puede quedar con nota.

6.4 Agentes de servicio que los disparadores necesitan (firebase-tools intenta darlos solo, pero la SA de despliegue no puede cambiar la
política IAM del proyecto, y no debe poder):

```bash
# El agente de Cloud Storage no existe hasta aprovisionarlo (si no, «Service account … does not exist»):
AG_GCS=$(gcloud storage service-agent --project "$P" | tr -d '[:space:]')
# Disparador de Storage (subidaFinalizada): el agente de Cloud Storage publica en Pub/Sub.
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet --member "serviceAccount:${AG_GCS}" --role roles/pubsub.publisher
# El agente de Pub/Sub firma los tokens de entrega.
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet \
  --member "serviceAccount:service-${NUM}@gcp-sa-pubsub.iam.gserviceaccount.com" --role roles/iam.serviceAccountTokenCreator
# firebase-tools verifica estos dos sobre la cuenta de cómputo por defecto aunque las funciones corran con la dedicada:
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet \
  --member "serviceAccount:${NUM}-compute@developer.gserviceaccount.com" --role roles/run.invoker
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet \
  --member "serviceAccount:${NUM}-compute@developer.gserviceaccount.com" --role roles/eventarc.eventReceiver
# Disparadores de Eventarc (eventos, subidaFinalizada): la SA de ejecución recibe los eventos e invoca el servicio.
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet --member "serviceAccount:${SA_FN}" --role roles/eventarc.eventReceiver
gcloud projects add-iam-policy-binding "$P" --condition=None --quiet --member "serviceAccount:${SA_FN}" --role roles/run.invoker
```

Verificado en el primer despliegue (05/11/2026): sin los cuatro primeros, `firebase deploy` se detiene con «Failed to verify the project has
the correct IAM bindings» y los nombra. Uno por comando: el clasificador de Claude Code bloquea los bucles de concesión.

## 7. Secretos de las Functions (Secret Manager) [gratis hasta 6 versiones activas; son 3]

Los valores se generan en la máquina, van por tubería a Secret Manager y no se muestran ni se guardan. Réplica gestionada por el usuario en `us-east1`.

```bash
for s in NOVUCHAT_PEDIDOS_SECRETO SITIO_RECONSTRUCCION_SECRETO LIMITE_TASA_SAL; do
  if ! gcloud secrets describe "$s" --project "$P" >/dev/null 2>&1; then
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets create "$s" --project "$P" \
      --replication-policy=user-managed --locations=us-east1 --data-file=-
  fi
  # Acceso de lectura solo a la SA de ejecución y solo a ese secreto (no a nivel de proyecto).
  gcloud secrets add-iam-policy-binding "$s" --project "$P" \
    --member "serviceAccount:${SA_FN}" --role roles/secretmanager.secretAccessor >/dev/null
done
gcloud secrets list --project "$P" --format='value(name,createTime)'   # verificación: nombres, nunca valores
```

Los dos secretos compartidos se entregan a su destino sin mostrarlos, cuando ese destino exista (autorización aparte):
`SITIO_RECONSTRUCCION_SECRETO` → secreto del repositorio en GitHub, para el flujo de reconstrucción (otra ola):
`gcloud secrets versions access latest --secret SITIO_RECONSTRUCCION_SECRETO --project "$P" | gh secret set SITIO_RECONSTRUCCION_SECRETO --repo "$OWNER/$REPO"`;
`NOVUCHAT_PEDIDOS_SECRETO` → credencial de n8n (NovuChat), por su propio procedimiento.

## 8. App Check y reCAPTCHA Enterprise [gratis hasta el umbral mensual de evaluaciones; verificar]

8.1 Apps web de Firebase (una por sitio) y la configuración web del panel:

```bash
firebase apps:create web "NovuTienda panel" --project "$P"     # anota el appId en CONFIGURACION.local.md
firebase apps:create web "NovuTienda sitio" --project "$P"
firebase apps:sdkconfig web <APP_ID_PANEL> --project "$P"      # de aquí sale la apiKey pública → VITE_FIREBASE_API_KEY_STAGING
```

8.2 Clave de reCAPTCHA Enterprise para los dos dominios:

```bash
gcloud recaptcha keys create --project "$P" --web --integration-type=score \
  --domains="${SITIO_ID}.web.app,${PANEL_ID}.web.app" --display-name="NovuTienda staging"
```

La clave de sitio (pública) va a `RECAPTCHA_CLAVE_SITIO` (variable del Environment) y al registro de App Check de cada app: consola de
Firebase → App Check → Apps → reCAPTCHA Enterprise (`https://console.firebase.google.com/project/<P>/appcheck`). Lo hace Claude.

8.3 App Check «Enforced» en Firestore y Storage (producción; paso del pase): consola de Firebase → App Check → Firestore y Storage → «Enforce», **después** de que el panel
envíe el token. Las lecturas de recibos, inventarios y consola son solo por callables (`decisiones.md`, «Lectura solo por callables»); sin la exigencia, las APIs directas de
Firestore y Storage seguirían abiertas a quien tenga un token de usuario.

8.4 **No activar la exigencia** (`APP_CHECK_EXIGIDO=false` en staging, ni «Enforce» en la consola) hasta que el panel envíe el token:
hoy `paquetes/panel` no inicializa App Check, así que con la exigencia activa todas sus llamadas responderían `unauthenticated`.

8.4 App Check del SITIO (formulario de contacto, token de un solo uso): registrar la app web del sitio en App Check con su propia clave de
reCAPTCHA Enterprise (distinta de la del panel) y cargar en el contenido publicado el bloque `config.appCheck {claveSitio, apiKey, appId,
projectId}` (contrato en `paquetes/website/src/contenido/tipos.ts`). Sin ese bloque el formulario avisa «no está disponible». La CSP del sitio y
del panel permiten `content-firebaseappcheck.googleapis.com`, que es el host que usa el SDK 13.x para canjear el token.

## 9. GitHub: variables, secretos, Environments y rulesets [gratis]

Todo con `gh`, por Claude, tras el «sí». Ningún valor en archivos versionados.

9.1 Environments (`03-ambientes-modos-y-aprobaciones.md` §6.4):

```bash
gh api --method PUT "repos/$OWNER/$REPO/environments/staging" --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api --method POST "repos/$OWNER/$REPO/environments/staging/deployment-branch-policies" -f name=main -f type=branch

ID_APROBADOR=$(gh api users/segurolotengopy --jq .id)
gh api --method PUT "repos/$OWNER/$REPO/environments/production" --input - <<JSON
{ "wait_timer": 0, "prevent_self_review": true,
  "reviewers": [ { "type": "User", "id": ${ID_APROBADOR} } ],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api --method POST "repos/$OWNER/$REPO/environments/production/deployment-branch-policies" \
  -f name='v[0-9]*.[0-9]*.[0-9]*' -f type=tag
```

9.2 Secretos (solo nombres; los valores salen del paso 5 por tubería, sin mostrarse):

| Nombre | Dónde | Origen |
|---|---|---|
| `GCP_WIF_PROVIDER` | repositorio | salida de `setup-oidc-gcp.sh` |
| `GCP_SA_DEPLOY_STAGING` | Environment `staging` | salida de `setup-oidc-gcp.sh` |
| `GCP_SA_DEPLOY_PROD` | Environment `production` | al federar producción (otro pase) |

9.3 Variables:

| Nombre | Dónde | Valor |
|---|---|---|
| `GCP_PROJECT_ID_STAGING` | repositorio | `<P>` — **al cargarla se activa el despliegue a staging en cada merge a `main`** (cargarla al final) |
| `STAGING_URL` | repositorio | `https://<SITIO_ID>.web.app` |
| `HEALTH_PATH` | repositorio | `/api/salud` (**no** `/healthz`: el frontend de Google lo intercepta en Cloud Run y devuelve 404 sin llegar a la función; `docs/arquitectura/decisiones.md`, 05/11/2026) |
| `FIREBASE_DEPLOY_ONLY` | repositorio | `hosting,functions,firestore,storage` |
| `TENANT_ID` | repositorio | `casa-bermejo` (**obligatoria**: sin valor por defecto en el código ni en el CI) |
| `VITE_FIREBASE_API_KEY_STAGING` | repositorio | apiKey pública de la app web del panel (8.1) |
| `MODO` | repositorio | `A` |
| `APROBADORES_PROD` | repositorio | `segurolotengopy` (y el propietario, si Andres lo decide) |
| `FIREBASE_SITE_SITIO` | Environment `staging` | `<SITIO_ID>` |
| `FIREBASE_SITE_PANEL` | Environment `staging` | `<PANEL_ID>` |
| `PANEL_URL` | Environment `staging` | `https://<PANEL_ID>.web.app` |
| `APP_CHECK_EXIGIDO` | Environment `staging` | `false` (8.4) |
| `RECAPTCHA_CLAVE_SITIO` | Environment `staging` | clave de sitio de 8.2 |
| `MEDIOS_BASE_URL` | Environment `staging` | **obligatoria** (https): ver 9.5; el despliegue falla si falta |
| `FUNCIONES_SERVICE_ACCOUNT` | Environment `staging` | vacío (cuenta por defecto, si no tiene Editor) o la dedicada del paso 6.1 (obligatoria en la práctica en producción) |
| `FIREBASE_DEPLOY_FORCE` | Environment `staging` (y `production`) | cualquier valor no vacío → `firebase deploy --force`. **Obligatoria**: la función `eventos` declara `retry: true` y firebase-tools exige `--force` para una política de fallo en modo no interactivo (3.er intento del primer despliegue, 05/11/2026). Aviso en el run: `--force` también borra Functions que ya no estén en el código |
| `PROXY_SALTOS` | repositorio (opcional) | `2` por defecto: proxies que anteponen su IP en `X-Forwarded-For` (Hosting/Fastly + GFE). **Verificar en staging** con una petición real |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY_STAGING` / `_PROD` | repositorio | clave de sitio de reCAPTCHA Enterprise (8.2) para el App Check del panel |
| `VITE_FIREBASE_STORAGE_BUCKET_STAGING` / `_PROD` | repositorio | nombre del bucket de Storage del proyecto (`gcloud storage buckets list`) |
| `VITE_FIREBASE_APP_ID_STAGING` / `_PROD` | repositorio | `appId` de la app web del panel (8.1): App Check lo usa en `…/apps/{appId}:exchange…` |
| `SITIO_CONTENIDO` | repositorio | solo `production`: ruta al JSON de contenido publicado; sin él, el build de producción falla (`reconstruccion-sitio.md`) |

`construir` FALLA si, con el proyecto del ambiente configurado, falta alguna de `VITE_FIREBASE_API_KEY_*`, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY_*`, `VITE_FIREBASE_STORAGE_BUCKET_*` o
`VITE_FIREBASE_APP_ID_*`. En `production`, `APP_CHECK_EXIGIDO` debe ser `true` o el despliegue se detiene.

9.5 **Medios públicos (`MEDIOS_BASE_URL`).** La API de NovuChat y el panel arman las URL de las fotos con esa base. Opciones válidas: (a) un **bucket público aparte** que solo
reciba `tenants/*/publico/medios/**` (copiado por la función de medios o con otra regla de publicación), o (b) servir `publico/` por Hosting/CDN. **Prohibido** abrir con `allUsers` el
bucket por defecto de Firebase Storage: contiene originales y PDF de recibos (`privado/`); las reglas de `storage.rules` no protegen contra una política IAM pública. No existe
valor por defecto a `storage.googleapis.com/<bucket>`: sin `MEDIOS_BASE_URL` el despliegue y la API fallan.

Comandos: `gh variable set <NOMBRE> --repo "$OWNER/$REPO" [--env staging] --body "<valor>"` y
`… | gh secret set <NOMBRE> --repo "$OWNER/$REPO" [--env staging]` (valor por stdin, nunca en `--body`).

9.4 Rulesets (`SeguridadGeneral/02-pipelines/config/rulesets/`): primero se listan los existentes (`gh api repos/$OWNER/$REPO/rulesets`);
si ya hay uno de `main`, se actualiza con `PUT …/rulesets/<ID>` en vez de crear otro.

```bash
gh api --method POST "repos/$OWNER/$REPO/rulesets" \
  --input /home/andres-alberdi/SeguridadGeneral/02-pipelines/config/rulesets/main.json
gh api --method POST "repos/$OWNER/$REPO/rulesets" \
  --input /home/andres-alberdi/SeguridadGeneral/02-pipelines/config/rulesets/tags.json
```

`main.json` exige PR, **un único status check `compuerta-pr`**, historial lineal, squash y **1 aprobación**: GitHub no cuenta la
aprobación del autor del PR, así que el revisor es siempre otra persona (`segurolotengopy`). Sin bypass para nadie.

## 10. Política de limpieza de imágenes de Functions [$ reduce el costo]

`firebase deploy` no interactivo falla si la región no tiene política de limpieza en Artifact Registry. Se fija una vez:

```bash
firebase functions:artifacts:setpolicy --location us-east1 --days 1 --project "$P" --force
```

## 11. Primer despliegue

1. Andres autoriza cargar `GCP_PROJECT_ID_STAGING` (9.3, última).
2. El PR de `feat/ci` (y los pendientes del bloque «Bloqueos» de abajo) se fusiona a `main` con la aprobación de **[segurolotengopy]**.
3. El CI corre `desplegar-staging` → humo (sitio `/healthz`, sitio `/` y panel con CSP y HSTS) → `dast-y-humo` (ZAP baseline sobre el sitio).
   [$: Cloud Build y Artifact Registry por cada despliegue de Functions.]
4. Claude lee el run (`gh run view --log-failed` si falla), lo informa con su resultado real y corrige lo mínimo sin debilitar controles.
5. **Fallos de «primera vez» esperables** (05/11/2026): Cloud Build de las primeras funciones puede fallar con `Repository "gcf-artifacts" not
   found` (la misma pasada lo crea) y los disparadores de Eventarc con «Permission denied while using the Eventarc Service Agent … may take
   a few minutes»: se relanza el job fallido (`gh run rerun <id> --failed`) sin tocar nada. Con el repositorio ya creado se fija la política
   de limpieza (paso 10). La función `api` declara `invoker: 'public'` en el código: sin eso, Hosting devuelve 403 en `/api/**` y 404 en
   `/healthz` aunque todo esté desplegado, y el humo falla.

Lección del primer despliegue (05/11/2026): firebase-tools 15.x en modo no interactivo exige en el dotenv un valor para **todo**
parámetro `defineString/defineBoolean`, aunque tenga `default` en `config.ts`. `preparar-despliegue-firebase.sh` escribe los valores por
defecto de los que no llegan por variable; si se agrega un parámetro en `config.ts`, hay que agregarlo también allí.

Antes del primer despliegue: cargar las variables de 9.3 (incluidas las `VITE_*` nuevas, `MEDIOS_BASE_URL` y `TENANT_ID`); sin ellas `construir` o el paso de configuración
del despliegue fallan a propósito. Verificar en staging el origen del límite de tasa (`PROXY_SALTOS`) con una petición real a `/api/contacto`.

## 12. Después del primer despliegue

0. **Alta del tenant** (lección del 05/11/2026: sin el documento `tenants/{t}` las programadas no tienen a quién correr, `listarTenants`
   devuelve vacío y la API responde `503 sin_cotizacion` aunque todo esté desplegado). Se crea con el Admin SDK (autenticado como el
   operador, `GOOGLE_CLOUD_PROJECT=<P>`): `tenants/<t>` = `{ plan: 'base', zonaHoraria: 'America/La_Paz', monedas: ['BOB','USD','ARS'],
   modulos: { nucleo|inventarios|pos|recibos|consola|website: { version: '1.0.0', submodulos: [] } } }` (forma de `validarTenant`). La
   configuración de redondeo rige por defecto sin documento (`redondeo.ts`). Hoy se hace con `scripts/alta-tenant.mjs` a partir de
   `tenants/<t>/config.json`: ficha del operador en `docs/produccion/alta-de-tenant.md`.
1. Usuarios: crear las cuentas del personal en Auth (correo y contraseña, correo verificado) y asignar roles con `consola.asignarRol` —
   el propietario de la plataforma entra con Google y el claim `p` (procedimiento del núcleo).
2. Token de NovuChat: `node plataforma/funciones/scripts/token-novuchat.mjs registrar` contra staging y entrega a n8n sin mostrarlo.
3. Alerta de cotización y latido: `docs/produccion/alertas.md` (canal de correo `CORREO_ALERTAS`, política por registro y ausencia de datos de 26 h).
4. Verificar la política TTL de `limitesTasa.expiraEn`: `gcloud firestore fields ttls list --project "$P"`.

## 13. Costos (verificar precios con fecha antes de autorizar)

| Paso | Costo |
|---|---|
| 1, 4, 5, 6, 9 | gratis |
| 0.2 Blaze | sin cargo fijo; habilita cobros por uso |
| 3 Firestore, Storage, Auth | gratis dentro de las cuotas; Storage cobra almacenamiento y salida fuera de ellas |
| 7 Secret Manager | 3 secretos con 1 versión: dentro del nivel gratuito |
| Cloud Scheduler | 3 trabajos; el nivel gratuito es **por cuenta de facturación**: con producción en la misma cuenta serían 6 → cobro por trabajo extra |
| 8 reCAPTCHA Enterprise / App Check | gratis hasta el umbral mensual de evaluaciones |
| 10–11 Cloud Build, Artifact Registry, Cloud Run | por uso; la política de limpieza mantiene el almacenamiento bajo |
| 12.3 Alerta de Monitoring | verificar el precio vigente de las alertas basadas en registros |
| Presupuesto con alerta | gratis; recomendado (`gcloud billing budgets create`, umbral que Andres decida) |

## 14. Qué hace solo Andres (o la persona indicada)

- Vincular la facturación (0.2) y fijar el presupuesto.
- Pantallas de Google que pidan consentimiento OAuth o verificación de identidad (3.3).
- `segurolotengopy`: aceptar la invitación de colaborador y aprobar los PR.
- Aprobar el Environment `production` (otro pase, no este).
